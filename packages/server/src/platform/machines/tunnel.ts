/**
 * The SSH tunnel that turns a remote server into a loopback origin — `ssh -N -L` as a child
 * process, held for as long as the window is pointed at that machine. The argv comes from
 * commands.ts (tunnelArgs); this module owns the child's lifecycle and the readiness probe.
 *
 * A tunnel is not supervised: when it dies, the caller's onExit fires and the SHELL decides
 * (offer a reconnect, fall back to the local server). Restarting it silently here would hide
 * exactly the failures — a dropped link, a rebooted machine — the user needs to see.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import { tunnelArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";

export interface Tunnel {
  /** Local (= remote) port the tunnel forwards. */
  port: number;
  /**
   * The ssh child's pid, persisted so a LATER platform (hot swap, server restart) can
   * adopt or kill a tunnel it did not spawn — the process outlives this bundle's objects.
   */
  pid: number | null;
  /** Stops the tunnel; onExit does NOT fire for a close() we asked for. */
  close: () => void;
  /** ssh's stderr so far — shown when the tunnel fails, since its words beat ours. */
  stderr: () => string;
}

/** True when something on this machine already answers on the port (loopback probe). */
export function localPortBusy(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: timeoutMs });
    const done = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Spawns the tunnel and resolves immediately — `ssh -N` prints nothing on success, so there
 * is no "ready" line to wait for. Readiness is the caller's HTTP probe THROUGH the tunnel
 * (waitForTunneledHttp below); an ssh that exits first (auth failure, port taken,
 * ExitOnForwardFailure) flips `exited` and fires onExit.
 */
export function openTunnel(opts: {
  target: RemoteTarget;
  port: number;
  onExit: (code: number | null) => void;
}): Tunnel & { exited: () => boolean } {
  const child = spawn("ssh", tunnelArgs(opts.target, opts.port), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + String(chunk)).slice(-4096);
  });
  let exited = false;
  let closing = false;
  child.on("exit", (code) => {
    exited = true;
    if (!closing) opts.onExit(code);
  });
  child.on("error", () => {
    // No ssh binary at all: surfaces as an immediate exit.
    exited = true;
    if (!closing) opts.onExit(null);
  });
  return {
    port: opts.port,
    pid: child.pid ?? null,
    exited: () => exited,
    stderr: () => stderr,
    close: () => {
      closing = true;
      if (!exited) child.kill();
    },
  };
}

/**
 * Polls the origin through the tunnel until any HTTP answer arrives. Before the remote
 * server listens, the forward accepts and immediately drops the connection — that reads as
 * a fetch failure and the loop just tries again.
 */
export async function waitForTunneledHttp(
  origin: string,
  gone: () => boolean,
  timeoutMs = 20_000,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (gone()) return { ok: false, detail: "the tunnel exited" };
    try {
      const res = await fetch(`${origin}/`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1000),
      });
      void res.body?.cancel();
      return { ok: true };
    } catch {
      // Not answering yet.
    }
    if (Date.now() >= deadline) return { ok: false, detail: "no HTTP answer through the tunnel" };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
