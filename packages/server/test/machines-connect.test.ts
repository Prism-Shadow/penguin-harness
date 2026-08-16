/**
 * The connect half of the machines capability: the ssh commands a connect runs (tunnel,
 * server start/stop/state) and the parsing of the far side's answers as pure functions;
 * the server-control orchestration for real against a stub `ssh` on PATH whose "remote
 * server" is a state file — real processes, fake far side, so the poll loops and the argv
 * are exercised rather than described. POSIX-only where stubs are involved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readServerStateCommand,
  SERVER_ALIVE_MARK,
  serverLogTailCommand,
  startServerCommand,
  stopServerCommand,
  tunnelArgs,
} from "../src/platform/machines/commands.js";
import {
  parseRemoteServerState,
  remoteServerState,
  startRemoteServer,
  stopRemoteServer,
} from "../src/platform/machines/server-control.js";
import {
  parseMachinesState,
  pickTunnelPort,
  withMachineState,
} from "../src/platform/machines/state.js";

describe("tunnelArgs", () => {
  it("forwards the SAME port on both ends, batch-mode, with forward failure fatal", () => {
    const args = tunnelArgs({ alias: "build-box", user: "deploy" }, 7377);
    expect(args).toContain("-N");
    expect(args[args.indexOf("-L") + 1]).toBe("7377:127.0.0.1:7377");
    expect(args[args.length - 1]).toBe("build-box");
    expect(args.join(" ")).toContain("BatchMode=yes");
    expect(args.join(" ")).toContain("ExitOnForwardFailure=yes");
    expect(args.join(" ")).toContain("User=deploy");
  });

  it("refuses a port that is not a real port", () => {
    expect(() => tunnelArgs({ alias: "a", user: "" }, 0)).toThrow();
    expect(() => tunnelArgs({ alias: "a", user: "" }, 1.5)).toThrow();
  });
});

describe("server-control commands", () => {
  it("starts detached via nohup on absolute paths, logging into the data root", () => {
    const cmd = startServerCommand(7377);
    expect(cmd).toContain("PORT=7377");
    expect(cmd).toContain("HOST=127.0.0.1");
    expect(cmd).toContain("nohup");
    expect(cmd).toContain("${XDG_DATA_HOME:-$HOME/.local/share}/penguin/bin/penguin");
    expect(cmd).toContain("server.log");
    expect(cmd).toContain("</dev/null");
    expect(cmd.trimEnd().endsWith("&")).toBe(true);
  });

  it("refuses a port or pid that is not a positive integer", () => {
    expect(() => startServerCommand(-1)).toThrow();
    expect(() => stopServerCommand(0)).toThrow();
  });

  it("reads the lock and reports pid liveness in one round trip", () => {
    const cmd = readServerStateCommand();
    expect(cmd).toContain("server.lock");
    expect(cmd).toContain("kill -0");
    expect(cmd).toContain(SERVER_ALIVE_MARK);
  });

  it("tails the log without failing when there is none", () => {
    expect(serverLogTailCommand()).toContain("server.log");
    expect(serverLogTailCommand()).toContain("|| true");
  });
});

describe("parseRemoteServerState", () => {
  const lock = JSON.stringify({ pid: 4242, port: 7377, startedAt: "2026-08-16" });

  it("reads a live lock", () => {
    expect(parseRemoteServerState(`${lock}\n${SERVER_ALIVE_MARK}\n`)).toEqual({
      lock: { pid: 4242, port: 7377 },
      alive: true,
    });
  });

  it("a lock without the alive marker is a dead server", () => {
    expect(parseRemoteServerState(`${lock}\n`)).toEqual({
      lock: { pid: 4242, port: 7377 },
      alive: false,
    });
  });

  it("no output, or damage, reads as no server", () => {
    expect(parseRemoteServerState("")).toEqual({ lock: null, alive: false });
    expect(parseRemoteServerState("not json")).toEqual({ lock: null, alive: false });
    expect(parseRemoteServerState(`{"pid":"x"}\n${SERVER_ALIVE_MARK}`)).toEqual({
      lock: null,
      alive: false,
    });
  });
});

describe("machines state", () => {
  it("round-trips ports and tunnel pids, dropping damage", () => {
    const text = withMachineState(null, "deploy@build-box", { port: 7377, tunnelPid: 4242 });
    expect(parseMachinesState(text)).toEqual({
      "deploy@build-box": { port: 7377, tunnelPid: 4242 },
    });
    const updated = withMachineState(text, "root@gpu-1", { port: 7378 });
    expect(parseMachinesState(updated)["root@gpu-1"]).toEqual({ port: 7378 });
    expect(parseMachinesState(withMachineState(updated, "root@gpu-1", null))["root@gpu-1"]).toBe(
      undefined,
    );
    expect(parseMachinesState("not json")).toEqual({});
    expect(parseMachinesState('{"a": {"port": 70000}, "b": {"port": 7380}}')).toEqual({
      b: { port: 7380 },
    });
  });

  it("pickTunnelPort tries the remembered port first, then shifts past busy ones", async () => {
    const busySet = new Set([7376, 7377]);
    const busy = (port: number) => Promise.resolve(busySet.has(port));
    await expect(pickTunnelPort({ remembered: 7390, busy })).resolves.toBe(7390);
    await expect(pickTunnelPort({ remembered: 7376, busy })).resolves.toBe(7378);
    await expect(pickTunnelPort({ remembered: undefined, busy })).resolves.toBe(7378);
    await expect(
      pickTunnelPort({ remembered: undefined, busy: () => Promise.resolve(true) }),
    ).resolves.toBeNull();
  });
});

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("remote server control (stub ssh)", () => {
  let work: string;
  let stubBin: string;
  let stateFile: string;
  let logFile: string;
  let originalPath: string | undefined;

  const target = { alias: "build-box", user: "deploy" };

  /**
   * The stub answers the three command shapes server-control sends. The "remote server" is
   * alive when the state file holds a port: the state probe then prints a lock plus the
   * alive marker, a start writes the file, a kill removes it.
   */
  const writeStub = (opts: { startWorks?: boolean } = {}) => {
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      [
        "#!/bin/sh",
        `printf 'ssh %s\\n' "$*" >> ${JSON.stringify(logFile)}`,
        // The remote command is the last argument. NOT the `eval echo` idiom: these
        // commands carry `;`-joined mkdir/nohup, which eval would EXECUTE on the test
        // machine instead of merely naming.
        'for a in "$@"; do last=$a; done',
        'case "$last" in',
        `  *server.lock*) if [ -s ${JSON.stringify(stateFile)} ]; then port=$(cat ${JSON.stringify(stateFile)}); printf '{"pid":4242,"port":%s,"startedAt":"now"}\\n%s\\n' "$port" ${JSON.stringify(SERVER_ALIVE_MARK)}; fi ;;`,
        opts.startWorks === false
          ? `  *nohup*) echo "sh: penguin: not found" 1>&2; exit 127 ;;`
          : `  *nohup*) port=$(echo "$last" | sed -n 's/.*PORT=\\([0-9]*\\).*/\\1/p'); echo "$port" > ${JSON.stringify(stateFile)} ;;`,
        `  *kill\\ 4242*) rm -f ${JSON.stringify(stateFile)} ;;`,
        "  *tail*) echo 'the log says why' ;;",
        "esac",
        "exit 0",
      ].join("\n"),
      { mode: 0o755 },
    );
  };

  beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-server-control-"));
    stubBin = path.join(work, "bin");
    fs.mkdirSync(stubBin);
    stateFile = path.join(work, "remote-state");
    logFile = path.join(work, "log");
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}${path.delimiter}${originalPath ?? ""}`;
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("reads no server, starts one on the asked port, then stops it", async () => {
    writeStub();
    await expect(remoteServerState(target)).resolves.toEqual({ lock: null, alive: false });

    await expect(startRemoteServer(target, 7377)).resolves.toEqual({ ok: true });
    await expect(remoteServerState(target)).resolves.toEqual({
      lock: { pid: 4242, port: 7377 },
      alive: true,
    });
    // Every connection carries BatchMode and the account override.
    const log = fs.readFileSync(logFile, "utf8");
    for (const line of log.trim().split("\n")) {
      expect(line).toContain("BatchMode=yes");
      expect(line).toContain("User=deploy");
    }

    await expect(stopRemoteServer(target, 4242)).resolves.toBe(true);
    await expect(remoteServerState(target)).resolves.toEqual({ lock: null, alive: false });
  }, 30_000);

  it("a start the far side refuses fails with the far side's own words", async () => {
    writeStub({ startWorks: false });
    const result = await startRemoteServer(target, 7377);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("not found");
  });
});
