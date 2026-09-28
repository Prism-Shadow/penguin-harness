/**
 * The ssh kind: what it hands the host, and its own port forwards. Its behaviour moved out of
 * the main tree unchanged, so the assertions are the ones that stood there — the argv of the
 * session, of a one-shot command and of a copy; the SOCKS dial; the reading of a refused login —
 * against stub `ssh` / `scp` binaries on PATH and a SOCKS server of this test's own. The
 * forwards are driven through a stand-in for the host's session, which is all a kind is
 * handed.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachineSession } from "@prismshadow/penguin-server/plugin";
import {
  SshMachine,
  dialThroughSocks,
  forwardControlArgs,
  forwardFlag,
  forwardKey,
  scpArgs,
  sessionArgs,
  sshArgs,
  useControlSockets,
} from "../src/index.js";

const target = { alias: "build-box", user: "deploy" };

describe("the argv", () => {
  it("never lets ssh prompt: a GUI has no terminal to type a password into", () => {
    const args = sshArgs(target, "uname -a");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ConnectTimeout=10");
    expect(scpArgs(target, ["/tmp/a"], "/tmp/dir")).toContain("BatchMode=yes");
  });

  it("selects the account on the command line, never by writing the ssh config", () => {
    expect(sshArgs(target, "true")).toContain("User=deploy");
    expect(sshArgs({ alias: "build-box", user: "" }, "true").join(" ")).not.toContain("User=");
  });

  it("holds ONE session per machine: no tty, a SOCKS listener on loopback, keepalives, sh", () => {
    const args = sessionArgs(target, 49152).join(" ");
    expect(args).toContain("-T");
    expect(args).toContain("-D 127.0.0.1:49152");
    expect(args).toContain("ExitOnForwardFailure=yes");
    expect(args).toContain("ServerAliveInterval=15");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("User=deploy");
    expect(args.endsWith("build-box sh")).toBe(true);
    // Nothing is forwarded by name: any port on the machine is a channel through -D.
    expect(args).not.toContain("-L ");
  });

  it("refuses a SOCKS port that is not one; masters a control socket; carries forwards when it has none", () => {
    expect(() => sessionArgs(target, 0)).toThrow(/bad port/);
    expect(() => sessionArgs(target, 70000)).toThrow(/bad port/);
    const mastered = sessionArgs(target, 49152, "/tmp/penguin-x.sock").join(" ");
    expect(mastered).toContain("-M -S /tmp/penguin-x.sock");
    expect(sessionArgs(target, 49152).join(" ")).not.toContain("-M");
    const carried = sessionArgs(target, 49152, null, [
      { direction: "in", localPort: 3000, remotePort: 3001 },
      { direction: "out", localPort: 5432, remotePort: 5433 },
    ]).join(" ");
    expect(carried).toContain("ExitOnForwardFailure=no");
    expect(carried).toContain(
      "-L 127.0.0.1:3000:127.0.0.1:3001 -R 127.0.0.1:5433:127.0.0.1:5432 -D",
    );
  });

  it("spells a forward as ssh wants it, and asks the master for it over the control socket", () => {
    expect(forwardFlag({ direction: "in", localPort: 3000, remotePort: 3001 })).toEqual([
      "-L",
      "127.0.0.1:3000:127.0.0.1:3001",
    ]);
    expect(forwardFlag({ direction: "out", localPort: 5432, remotePort: 5433 })).toEqual([
      "-R",
      "127.0.0.1:5433:127.0.0.1:5432",
    ]);
    expect(() => forwardFlag({ direction: "in", localPort: 0, remotePort: 1 })).toThrow(/bad port/);
    const args = forwardControlArgs({ alias: "nas", user: "" }, "/tmp/p.sock", "forward", {
      direction: "in",
      localPort: 3000,
      remotePort: 3001,
    }).join(" ");
    expect(args).toContain("-S /tmp/p.sock -O forward -L 127.0.0.1:3000:127.0.0.1:3001 nas");
    expect(args).not.toContain(" sh");
  });

  it("leaves the scp destination unquoted — modern scp transfers over SFTP, taking it literally", () => {
    const args = scpArgs(target, ["/local/image.pack"], "/tmp/penguin-abc123");
    expect(args.at(-1)).toBe("build-box:/tmp/penguin-abc123");
  });
});

/**
 * A stand-in for the host's session, as the kind is handed it: it launches through the kind,
 * counts as a child per launch, and keeps the memo and the stderr the kind reads.
 */
function standIn(machine: SshMachine) {
  let carry: Record<string, unknown> | null = null;
  let pid = 0;
  const memo = new Map<string, unknown>();
  const state = { said: "", reopens: 0, launches: [] as string[][] };
  const session = {
    carry: () => carry,
    session: () => (carry === null ? null : { pid }),
    said: () => state.said,
    memo: () => memo,
    reopen: async () => {
      state.reopens += 1;
      if (carry !== null) await start();
    },
  } as unknown as MachineSession;
  const start = async () => {
    const launch = await machine.launch(session);
    state.launches.push(launch.args);
    carry = launch.carry ?? null;
    pid += 1;
    await machine.up(session);
  };
  const stop = () => {
    carry = null;
  };
  return { session, start, stop, state };
}

describe("launch, oneShot, copyTo and diagnose", () => {
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ssh-kind-"));
    logFile = path.join(stubBin, "calls.log");
    for (const name of ["ssh", "scp"]) {
      fs.writeFileSync(
        path.join(stubBin, name),
        `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(logFile)}\nexit 0\n`,
      );
      fs.chmodSync(path.join(stubBin, name), 0o755);
    }
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const calls = () => fs.readFileSync(logFile, "utf8").trim().split("\n");

  it("launches the session argv, carrying the SOCKS port it chose", async () => {
    const machine = new SshMachine({ alias: "nas", user: "" });
    const { session } = standIn(machine);
    const launch = await machine.launch(session);
    expect(launch.program).toBe("ssh");
    const carry = launch.carry as { socksPort: number; controlPath: string | null };
    expect(Number.isInteger(carry.socksPort)).toBe(true);
    expect(launch.args).toEqual(
      sessionArgs({ alias: "nas", user: "" }, carry.socksPort, carry.controlPath, []),
    );
  });

  it("runs a one-shot command and a copy as ssh and scp with the same argv as before", async () => {
    const machine = new SshMachine(target);
    expect((await machine.oneShot("ver", { timeoutMs: 5_000 })).code).toBe(0);
    expect((await machine.oneShot("tar -xzf -", { input: Buffer.from("x") })).code).toBe(0);
    expect((await machine.copyTo(["/tmp/a.ps1"], ".")).code).toBe(0);
    expect(calls()).toEqual([
      `ssh ${sshArgs(target, "ver").join(" ")}`,
      `ssh ${sshArgs(target, "tar -xzf -").join(" ")}`,
      `scp ${scpArgs(target, ["/tmp/a.ps1"], ".").join(" ")}`,
    ]);
  });

  it("reads a refused login as the BatchMode wall, and anything else as nothing to add", () => {
    const machine = new SshMachine(target);
    const refused = { code: 255, stdout: "", timedOut: false };
    expect(
      machine.diagnose({ ...refused, stderr: "deploy@build-box: Permission denied (publickey)." }),
    ).toContain("BatchMode");
    expect(machine.diagnose({ ...refused, stderr: "Host key verification failed." })).toContain(
      "BatchMode",
    );
    expect(machine.diagnose({ ...refused, stderr: "Connection timed out" })).toBeNull();
  });
});

/** Just enough SOCKS5 to answer a CONNECT: greet, connect, pipe. */
function socksServer(): Promise<{ port: number; close: () => void; requests: number[] }> {
  const requests: number[] = [];
  const server = net.createServer((client) => {
    let stage = 0;
    // Each stage waits for its whole frame: a `data` event is a piece of a stream.
    let buffer = Buffer.alloc(0);
    client.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0) {
        if (buffer.length < 2) return;
        const greeting = 2 + buffer[1]!;
        if (buffer.length < greeting) return;
        buffer = buffer.subarray(greeting);
        stage = 1;
        client.write(Buffer.from([5, 0]));
      }
      if (stage === 1) {
        if (buffer.length < 10) return;
        stage = 2;
        const port = buffer.readUInt16BE(8);
        buffer = buffer.subarray(10);
        requests.push(port);
        const upstream = net.connect({ host: "127.0.0.1", port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (buffer.length > 0) upstream.write(buffer);
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => {
          client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0]));
        });
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => server.close(),
        requests,
      }),
    ),
  );
}

/** A loopback port nothing listens on: taken from the kernel and released. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as net.AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });

describe("the dial", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it("reaches a port through the session's SOCKS port and carries HTTP over it", async () => {
    const web = http.createServer((_req, res) => res.end("ok from behind"));
    await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => web.close());
    const webPort = (web.address() as net.AddressInfo).port;
    const socks = await socksServer();
    cleanups.push(socks.close);

    // The session's carry names the SOCKS port the kind chose; the dial goes through it.
    const machine = new SshMachine({ alias: "nas", user: "" });
    const session = {
      carry: () => ({ socksPort: socks.port, controlPath: null, forwards: [] }),
    } as unknown as MachineSession;
    const socket = await machine.dial(webPort, { session, node: "node" });
    const answer = await new Promise<string>((resolve) => {
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += String(chunk)));
      socket.on("end", () => resolve(text));
      socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    expect(answer).toContain("ok from behind");
    expect(socks.requests).toEqual([webPort]);
  });

  it("fails in the SOCKS server's words when the port behind it refuses", async () => {
    const socks = await socksServer();
    cleanups.push(socks.close);
    await expect(dialThroughSocks(socks.port, "127.0.0.1", await freePort())).rejects.toThrow(
      /refused .*SOCKS reply 5/,
    );
  });

  it("fails when there is no SOCKS listener at all", async () => {
    await expect(dialThroughSocks(await freePort(), "127.0.0.1", 7364)).rejects.toThrow(
      /did not answer/,
    );
  });
});

describe("port forwards", () => {
  let stubBin: string;
  let logFile: string;
  let originalPath: string | undefined;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-ssh-forwards-"));
    logFile = path.join(stubBin, "calls.log");
    // The master answering a control request: port 65001 will not bind, every other one does.
    fs.writeFileSync(
      path.join(stubBin, "ssh"),
      `#!/bin/sh
echo "$*" >> ${JSON.stringify(logFile)}
case "$*" in *" -O "*:65001:*) echo "Port forwarding failed: bind: Address already in use" >&2; exit 255 ;; esac
exit 0
`,
    );
    fs.chmodSync(path.join(stubBin, "ssh"), 0o755);
    originalPath = process.env.PATH;
    process.env.PATH = `${stubBin}:${process.env.PATH ?? ""}`;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const controls = (op: string) =>
    fs.existsSync(logFile)
      ? fs
          .readFileSync(logFile, "utf8")
          .trim()
          .split("\n")
          .filter((line) => line.includes(`-O ${op}`))
      : [];
  const factOf = (session: MachineSession, machine: SshMachine, spec: object) =>
    machine
      .forwards()
      .facts(session)
      .find((f) => forwardKey(f.spec) === forwardKey(spec as never))?.fact;

  const posixOnly = process.platform === "win32" ? it.skip : it;

  posixOnly(
    "masters a control socket, and asks it for each wanted forward once the session is up",
    async () => {
      const machine = new SshMachine({ alias: "nas", user: "deploy" });
      const { session, start, state } = standIn(machine);
      const good = { direction: "in" as const, localPort: 3000, remotePort: 3001 };
      const bad = { direction: "out" as const, localPort: 5432, remotePort: 65001 };
      // Wanted before the session exists: recorded, nothing asked yet.
      await machine.forwards().set(session, [good]);
      expect(controls("forward")).toEqual([]);
      await start();
      expect(state.launches[0]!.join(" ")).toMatch(/ -M -S \S+penguin-ssh-\S+\.sock /);
      expect(controls("forward")).toEqual([
        expect.stringContaining("-O forward -L 127.0.0.1:3000:127.0.0.1:3001 nas"),
      ]);
      expect(factOf(session, machine, good)).toEqual({ ok: true });

      // Added live: asked at once; ssh's refusal is the fact, in its words.
      await machine.forwards().set(session, [good, bad]);
      expect(controls("forward")).toHaveLength(2);
      expect(factOf(session, machine, bad)).toEqual({
        ok: false,
        detail: "Port forwarding failed: bind: Address already in use",
      });
      // Dropped live: cancelled, and its fact goes with it.
      await machine.forwards().set(session, [bad]);
      expect(controls("cancel")).toEqual([
        expect.stringContaining("-O cancel -L 127.0.0.1:3000:127.0.0.1:3001 nas"),
      ]);
      expect(factOf(session, machine, good)).toBeUndefined();
      // No reopen on this path: the master takes changes live.
      expect(state.reopens).toBe(0);
    },
  );

  it("without a control socket carries the forwards in its arguments, reopening on a change, and reads ssh's warnings", async () => {
    useControlSockets(false);
    try {
      const machine = new SshMachine({ alias: "nas", user: "deploy" });
      const { session, start, state } = standIn(machine);
      const good = { direction: "in" as const, localPort: 3000, remotePort: 3001 };
      const bad = { direction: "out" as const, localPort: 5432, remotePort: 65001 };
      await machine.forwards().set(session, [good]);
      await start();
      expect(state.launches).toHaveLength(1);
      expect(state.launches[0]!.join(" ")).toContain("-o ExitOnForwardFailure=no");
      expect(state.launches[0]!.join(" ")).toContain("-L 127.0.0.1:3000:127.0.0.1:3001 -D");
      expect(state.launches[0]!.join(" ")).not.toContain(" -M ");
      expect(factOf(session, machine, good)).toEqual({ ok: true });

      // A changed set: the live session is reopened with the new arguments, at once — and what
      // ssh said while connecting is the fact for the one it could not bind.
      state.said = "Warning: remote port forwarding failed for listen port 65001\n";
      await machine.forwards().set(session, [good, bad]);
      expect(state.reopens).toBe(1);
      expect(state.launches[1]!.join(" ")).toContain("-R 127.0.0.1:65001:127.0.0.1:5432");
      expect(factOf(session, machine, good)).toEqual({ ok: true });
      expect(factOf(session, machine, bad)).toEqual({
        ok: false,
        detail: "Warning: remote port forwarding failed for listen port 65001",
      });
      // The same set again — in any order — is no reopen.
      await machine.forwards().set(session, [bad, good]);
      expect(state.reopens).toBe(1);
      // Nothing was asked of a control socket there is none of.
      expect(controls("forward")).toEqual([]);
    } finally {
      useControlSockets(true);
    }
  });

  it("keeps what it knows in the session's memo: a fresh handle — the next generation's — finds it", async () => {
    useControlSockets(false);
    try {
      const first = new SshMachine({ alias: "nas", user: "" });
      const { session, start, state } = standIn(first);
      const good = { direction: "in" as const, localPort: 3000, remotePort: 3001 };
      await first.forwards().set(session, [good]);
      await start();
      // The same set handed again through a new handle (a hot push's successor) is no reopen,
      // and the facts are still there: they live with the session, not in the plugin's module.
      const second = new SshMachine({ alias: "nas", user: "" });
      await second.forwards().set(session, [good]);
      expect(state.reopens).toBe(0);
      expect(factOf(session, second, good)).toEqual({ ok: true });
    } finally {
      useControlSockets(true);
    }
  });
});
