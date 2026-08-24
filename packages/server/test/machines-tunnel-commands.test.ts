/**
 * The shell and argv for running a server on the far side and tunnelling to it. Pure
 * strings — no ssh, no processes — because these are the commands whose exact shape decides
 * whether a remote start silently does nothing.
 */
import { describe, expect, it } from "vitest";
import {
  serverLogTailCommand,
  startServerCommand,
  stopServerCommand,
  tunnelArgs,
} from "../src/machines/commands.js";

const target = { alias: "nas", user: "deploy" };

describe("startServerCommand", () => {
  const command = startServerCommand(7364);

  it("runs the launcher by absolute path — sshd's shell has no ~/.local/bin on PATH", () => {
    expect(command).toContain('bin="${XDG_DATA_HOME:-$HOME/.local/share}/penguin/bin/penguin"');
    expect(command).toContain('"$bin" server');
  });

  it("detaches with nohup and redirects every stream, so the ssh session can exit", () => {
    // Without the redirections ssh waits on the inherited streams and the call hangs; and
    // `setsid` is not portable to macOS, which is why this is nohup.
    expect(command).toContain("nohup");
    expect(command).toContain("</dev/null");
    expect(command).toContain('>>"$HOME/.penguin/data/server.log" 2>&1 &');
  });

  it("pins the port and binds loopback — the tunnel is the only way in", () => {
    expect(command).toContain("PORT=7364 HOST=127.0.0.1");
  });

  it("refuses a port that is not one, rather than emitting it into a shell", () => {
    for (const bad of [0, -1, 70000, 1.5, Number.NaN]) {
      expect(() => startServerCommand(bad)).toThrow();
    }
  });
});

describe("stopServerCommand", () => {
  it("is a plain TERM that never fails the ssh call", () => {
    expect(stopServerCommand(4242)).toBe("kill 4242 2>/dev/null || true");
  });

  it("refuses anything that is not a pid", () => {
    for (const bad of [0, -3, 1.5, Number.NaN]) expect(() => stopServerCommand(bad)).toThrow();
  });
});

describe("serverLogTailCommand", () => {
  it("reads the far side's own words, and survives a missing log", () => {
    expect(serverLogTailCommand()).toBe(
      'tail -n 20 "$HOME/.penguin/data/server.log" 2>/dev/null || true',
    );
  });

  it("refuses a nonsensical line count", () => {
    for (const bad of [0, -1, 1.5, 10_000]) expect(() => serverLogTailCommand(bad)).toThrow();
  });
});

describe("tunnelArgs", () => {
  const args = tunnelArgs(target, 7364);

  it("forwards the SAME number on both ends", () => {
    // Preview URLs are built from the server's own bound port, so local and remote must
    // stay equal or Workspace previews break.
    expect(args).toContain("-L");
    expect(args[args.indexOf("-L") + 1]).toBe("7364:127.0.0.1:7364");
  });

  it("makes a taken local port an exit rather than a silent no-op tunnel", () => {
    expect(args.join(" ")).toContain("ExitOnForwardFailure=yes");
  });

  it("keeps the link watched, so a dead one surfaces within a minute", () => {
    expect(args.join(" ")).toContain("ServerAliveInterval=15");
    expect(args.join(" ")).toContain("ServerAliveCountMax=4");
  });

  it("carries no command and never asks for a password", () => {
    expect(args).toContain("-N");
    expect(args.join(" ")).toContain("BatchMode=yes");
    expect(args[args.length - 1]).toBe("nas");
  });

  it("refuses a port that is not one", () => {
    for (const bad of [0, -1, 70000, 1.5]) expect(() => tunnelArgs(target, bad)).toThrow();
  });
});
