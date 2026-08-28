/**
 * The HTTP way in to a machine's own server, held open per machine.
 *
 * A connection to a machine is a given on this side, not a cost paid per operation — the
 * same bargain ssh-session.ts strikes for small commands. Holding one is what lets work on a
 * machine be an ordinary authenticated request to that machine's own API, the hot update
 * included, instead of a program that has to exist on the far side to receive it.
 *
 * Not the connect tunnel: that one is the browser's (same-numbered ports, a state file, an
 * entry in the UI). This one is this server's own, on whatever local port is free, and a
 * machine may have either, both, or neither. A caller with a live connect tunnel passes its
 * port instead of opening one of these.
 *
 * Unsupervised, like the shell and the tunnel: a forward that dies is dropped and the next
 * caller opens another. Idle ones are let go, on a window long enough to outlive the gap
 * between hot pushes — reaped sooner, every push would pay a handshake per machine again.
 */
import net from "node:net";
import { openTunnel, waitForTunneledHttp } from "./tunnel.js";
import type { RemoteTarget } from "./commands.js";

const IDLE_MS = 60 * 60_000;
const READY_TIMEOUT_MS = 20_000;

interface Forward {
  tunnel: ReturnType<typeof openTunnel>;
  remotePort: number;
  idle: NodeJS.Timeout | null;
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

function drop(address: string, forward: Forward): void {
  if (forward.idle !== null) clearTimeout(forward.idle);
  forward.tunnel.close();
  if (forwards.get(address) === forward) forwards.delete(address);
}

/**
 * Restarts the idle countdown. The timer is also what collects a forward a hot push orphans:
 * the bundle is re-imported cache-busted (hmr/host.ts) and this map starts empty, but a
 * scheduled timeout belongs to the process and still closes the child it was made for.
 */
function touch(address: string, forward: Forward): void {
  if (forward.idle !== null) clearTimeout(forward.idle);
  forward.idle = setTimeout(() => drop(address, forward), IDLE_MS);
  forward.idle.unref();
}

/**
 * The local port a machine's server can be reached on, opening a forward if there is none —
 * or if the one there is points at a port the server has since moved away from.
 */
export async function forwardTo(opts: {
  /** Registry key: the machine's ssh address, as ssh-session.ts keys its shells. */
  address: string;
  target: RemoteTarget;
  /** The port its server is bound to over there. */
  remotePort: number;
}): Promise<{ ok: true; port: number } | { ok: false; detail: string }> {
  const existing = forwards.get(opts.address);
  if (existing !== undefined) {
    if (!existing.tunnel.exited() && existing.remotePort === opts.remotePort) {
      touch(opts.address, existing);
      return { ok: true, port: existing.tunnel.port };
    }
    drop(opts.address, existing);
  }
  const localPort = await freeLocalPort();
  if (localPort === null) return { ok: false, detail: "no free local port to forward on" };

  const tunnel = openTunnel({
    target: opts.target,
    port: localPort,
    remotePort: opts.remotePort,
    onExit: () => {},
  });
  const forward: Forward = { tunnel, remotePort: opts.remotePort, idle: null };
  forwards.set(opts.address, forward);
  const ready = await waitForTunneledHttp(
    `http://127.0.0.1:${localPort}`,
    () => tunnel.exited(),
    READY_TIMEOUT_MS,
  );
  if (!ready.ok) {
    drop(opts.address, forward);
    return { ok: false, detail: tunnel.stderr().trim() || ready.detail };
  }
  touch(opts.address, forward);
  return { ok: true, port: localPort };
}

/** Lets go of a machine's forward — a disconnect, or a machine that went away. */
export function closeForward(address: string): void {
  const forward = forwards.get(address);
  if (forward !== undefined) drop(address, forward);
}
