/**
 * The one forward per machine: `ssh -N -L <local>:127.0.0.1:<remote>`, held as a child
 * process, making that machine's server a loopback origin here.
 *
 * Everything this server does over HTTP to a machine goes through it — the proxy for the
 * browser, the model sync, the hot update, a restart. The local port is whatever is free:
 * nothing built from it is shown to a browser as a URL, so it never has to match the far
 * side's number.
 *
 * Held rather than opened per operation: a handshake to a distant host costs seconds, and
 * the connection is a given on this side, not a cost paid per request. The child's pid is
 * what the service persists, so a hot-swapped or restarted platform adopts a forward it did
 * not spawn — the process outlives this module's objects.
 *
 * Unsupervised, like the shared shell: a forward that dies is dropped, and the next caller
 * opens another. A dropped link is what the person needs to see.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { forwardArgs } from "../commands.js";
import type { RemoteTarget } from "../commands.js";

/** How long the far server has to answer through a fresh forward before it is called dead. */
const READY_TIMEOUT_MS = 20_000;

interface Forward {
  child: ChildProcessByStdio<null, null, Readable>;
  port: number;
  remotePort: number;
  exited: boolean;
  stderr: string;
}

const forwards = new Map<string, Forward>();

/** A local port nothing is on: the kernel's answer, bound and released rather than guessed. */
function freeLocalPort(): Promise<number | null> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : null;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Polls the origin until any HTTP answer arrives. Before the remote server listens, the
 * forward accepts and immediately drops the connection — that reads as a fetch failure and
 * the loop just tries again.
 */
async function waitForHttp(port: number, gone: () => boolean): Promise<string | null> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (gone()) return "the forward exited";
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1000),
      });
      void res.body?.cancel();
      return null;
    } catch {
      // Not answering yet.
    }
    if (Date.now() >= deadline) return "no HTTP answer through the forward";
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * The local port a machine's server can be reached on, raising a forward when this module
 * holds none. `pid` is for the caller to persist; a forward this module does not know of but
 * whose pid is alive is still forwarding, and the caller uses its recorded port directly.
 */
export async function forwardTo(opts: {
  /** Registry key: the machine's ssh address, as ssh-session.ts keys its shells. */
  address: string;
  target: RemoteTarget;
  remotePort: number;
}): Promise<{ ok: true; port: number; pid: number | null } | { ok: false; detail: string }> {
  const existing = forwards.get(opts.address);
  if (existing !== undefined) {
    if (!existing.exited && existing.remotePort === opts.remotePort) {
      return { ok: true, port: existing.port, pid: existing.child.pid ?? null };
    }
    closeForward(opts.address);
  }
  const port = await freeLocalPort();
  if (port === null) return { ok: false, detail: "no free local port to forward on" };

  const child = spawn("ssh", forwardArgs(opts.target, port, opts.remotePort), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const forward: Forward = { child, port, remotePort: opts.remotePort, exited: false, stderr: "" };
  child.stderr.on("data", (chunk: Buffer) => {
    forward.stderr = (forward.stderr + String(chunk)).slice(-4096);
  });
  child.on("exit", () => {
    forward.exited = true;
  });
  child.on("error", () => {
    forward.exited = true; // No ssh binary at all reads as an immediate exit.
  });
  forwards.set(opts.address, forward);

  const failure = await waitForHttp(port, () => forward.exited);
  if (failure !== null) {
    closeForward(opts.address);
    return { ok: false, detail: forward.stderr.trim() || failure }; // ssh's words beat ours.
  }
  return { ok: true, port, pid: child.pid ?? null };
}

/**
 * Lets go of a machine's forward — this module's child, or by pid one a previous platform
 * generation spawned and recorded.
 */
export function closeForward(address: string, pid?: number | null): void {
  const forward = forwards.get(address);
  forwards.delete(address);
  if (forward !== undefined && !forward.exited) forward.child.kill();
  // A pid this module did not spawn: a forward a previous generation of the platform left
  // behind, which only the record names. Never our own — the recorded pid can be anything,
  // including this process, and signalling ourselves here would take the server down.
  if (pid != null && pid !== process.pid && forward?.child.pid !== pid) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
}
