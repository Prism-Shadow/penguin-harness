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
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";
import net from "node:net";
import { forwardArgs } from "./commands.js";
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
  /**
   * Hot-swap handover: forget the child WITHOUT killing it. The tunnel is delivered to
   * the next App through the state file (pid + port), so the ssh process must survive —
   * but this bundle's onExit handler must stop firing on a process it no longer owns.
   */
  detach: () => void;
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
  /** Local port. Also the remote one unless `remotePort` says otherwise (see forwardArgs). */
  port: number;
  remotePort?: number;
  onExit: (code: number | null) => void;
}): Tunnel & { exited: () => boolean } {
  const child = spawn("ssh", forwardArgs(opts.target, opts.port, opts.remotePort ?? opts.port), {
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
    detach: () => {
      closing = true;
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

/** How far past the well-known port the search goes before giving up. */
const PORT_SEARCH_SPAN = 20;

/**
 * The port a machine's tunnel should try: its remembered port first, then the well-known
 * port and the numbers after it, skipping whatever is busy locally. The remote side is not
 * asked — its server start is the authoritative check, and a collision surfaces as that
 * start's failure.
 */
export async function pickTunnelPort(opts: {
  remembered: number | undefined;
  busy: (port: number) => Promise<boolean>;
}): Promise<number | null> {
  const candidates: number[] = [];
  if (opts.remembered !== undefined) candidates.push(opts.remembered);
  for (let port = DEFAULT_SERVER_PORT; port < DEFAULT_SERVER_PORT + PORT_SEARCH_SPAN; port++) {
    if (!candidates.includes(port)) candidates.push(port);
  }
  for (const port of candidates) {
    if (!(await opts.busy(port))) return port;
  }
  return null;
}
