/**
 * The WSL kind against a stub `wsl.exe` on PATH — a shell script that answers `--list --quiet`
 * from a fixture and runs whatever follows `--exec` locally, so the distro is this machine's own
 * loopback. What is checked is this plugin's reading of wsl.exe and the argv it hands it, not
 * wsl.exe itself: nothing here ran on a real Windows.
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachineSession } from "@prismshadow/penguin-server/plugin";
import { WslKind, WslMachine, isMachineDistro, parseDistros } from "../src/index.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

describe("the distro listing", () => {
  const listing = [
    "Ubuntu-24.04",
    "docker-desktop",
    "docker-desktop-data",
    "penguin-sandbox",
    "Debian",
    "",
  ].join("\r\n");

  it("reads UTF-16LE with a BOM, without one, and UTF-8 alike", () => {
    const want = ["Ubuntu-24.04", "Debian"];
    const utf16 = Buffer.from(listing, "utf16le");
    expect(parseDistros(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16]))).toEqual(want);
    expect(parseDistros(utf16)).toEqual(want);
    expect(parseDistros(Buffer.from(listing, "utf8"))).toEqual(want);
  });

  it("leaves out Docker Desktop's distros, and this harness's own — the sandbox distro is not a machine", () => {
    expect(isMachineDistro("docker-desktop")).toBe(false);
    expect(isMachineDistro("docker-desktop-data")).toBe(false);
    // sandbox-wsl's default distro: interop off, there to confine this server's own Agents.
    expect(isMachineDistro("penguin-sandbox")).toBe(false);
    expect(isMachineDistro("Ubuntu")).toBe(true);
    expect(parseDistros(Buffer.from("penguin-sandbox\nUbuntu\n"))).toEqual(["Ubuntu"]);
  });

  it("answers nothing off Windows, without asking wsl.exe", async () => {
    const kind = new WslKind({ platform: "linux", wsl: "/nonexistent/wsl.exe" });
    await kind.refresh();
    expect(kind.discover()).toEqual([]);
  });
});

posixOnly("against a stub wsl.exe", () => {
  let stubBin: string;
  let logFile: string;
  let wsl: string;
  beforeEach(() => {
    stubBin = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-wsl-"));
    logFile = path.join(stubBin, "calls.log");
    fs.writeFileSync(
      path.join(stubBin, "list.txt"),
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("Ubuntu\r\npenguin-sandbox\r\ndocker-desktop\r\n", "utf16le"),
      ]),
    );
    wsl = path.join(stubBin, "wsl.exe");
    fs.writeFileSync(
      wsl,
      `#!/bin/sh
echo "WSL_UTF8=$WSL_UTF8 $*" >> ${JSON.stringify(logFile)}
if [ "$1" = "--list" ]; then cat ${JSON.stringify(path.join(stubBin, "list.txt"))}; exit 0; fi
while [ $# -gt 0 ] && [ "$1" != "--exec" ]; do shift; done
shift
exec "$@"
`,
    );
    fs.chmodSync(wsl, 0o755);
  });
  afterEach(() => {
    fs.rmSync(stubBin, { recursive: true, force: true });
  });
  const calls = () => fs.readFileSync(logFile, "utf8").trim().split("\n");

  it("discovers the machine distros through wsl.exe, in UTF-8 mode, off the list's own path", async () => {
    const kind = new WslKind({ platform: "win32", wsl });
    // The first read answers what is cached (nothing yet) and starts the refresh in the background.
    expect(kind.discover()).toEqual([]);
    await kind.refresh();
    expect(kind.discover()).toEqual(["Ubuntu"]);
    expect(calls()[0]).toBe("WSL_UTF8=1 --list --quiet");
  });

  it("launches `-d <distro> [-u <user>] --exec sh` with WSL_UTF8=1, and is always ready", async () => {
    const machine = new WslMachine("Ubuntu", wsl);
    expect(await machine.launch()).toEqual({
      program: wsl,
      args: ["-d", "Ubuntu", "--exec", "sh"],
      env: { WSL_UTF8: "1" },
    });
    expect((await new WslMachine("Ubuntu", wsl, "dev").launch()).args).toEqual([
      "-d",
      "Ubuntu",
      "-u",
      "dev",
      "--exec",
      "sh",
    ]);
    expect(await machine.ready()).toEqual({ ok: true });
    expect(machine.forwards()).toBeNull();
    expect(new WslKind({ platform: "win32", wsl }).form()).toBeNull();
  });

  it("dials the distro's own loopback through a bridge run by the machine's Node, and carries HTTP", async () => {
    const web = http.createServer((_req, res) => res.end("ok from the distro"));
    await new Promise<void>((resolve) => web.listen(0, "127.0.0.1", resolve));
    try {
      const port = (web.address() as net.AddressInfo).port;
      const machine = new WslMachine("Ubuntu", wsl);
      const socket = await machine.dial(port, {
        session: {} as MachineSession,
        node: JSON.stringify(process.execPath),
      });
      const answer = await new Promise<string>((resolve) => {
        let text = "";
        socket.on("data", (chunk: Buffer) => (text += String(chunk)));
        socket.on("end", () => resolve(text));
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      });
      expect(answer).toContain("ok from the distro");
      expect(calls().some((line) => line.startsWith("WSL_UTF8=1 -d Ubuntu --exec sh -c"))).toBe(
        true,
      );
    } finally {
      web.close();
    }
  });

  it("refuses a port nothing listens on, in the words from the wsl.exe side", async () => {
    const probe = net.createServer();
    const free = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => {
        const port = (probe.address() as net.AddressInfo).port;
        probe.close(() => resolve(port));
      }),
    );
    const machine = new WslMachine("Ubuntu", wsl);
    await expect(
      machine.dial(free, { session: {} as MachineSession, node: JSON.stringify(process.execPath) }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
