/**
 * The HTTP way in to a machine's own server, held open per machine.
 *
 * A connection to a machine is a GIVEN on this side, not a cost paid per operation. This is
 * the same bargain ssh-session.ts strikes for small commands — open it once, keep it — and it
 * is what lets work on a machine be an ordinary authenticated request to that machine's own
 * API, the hot update included, instead of a program that has to exist on the far side to
 * receive each thing this side wants done.
 *
 * NOT the connect tunnel. That one is the browser's (same-numbered ports, a state file, an
 * entry in the UI, a session a person can see); this one is this server's own, unnamed and
 * unnumbered, and a machine may have either, both, or neither. When the connect tunnel is up
 * its port already serves both purposes, and the caller passes that instead of opening one
 * of these.
 *
 * UNSUPERVISED, like the shell and the tunnel: a forward that dies is dropped, and the next
 * caller opens another. Idle ones are let go on the same window the shared shell uses, so a
 * machine nobody is touching ends up holding nothing.
 */
import { spawn } from "node:child_process";
import net from "node:net";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { forwardArgs } from "./commands.js";
import { waitForTunneledHttp } from "./tunnel.js";
import type { RemoteTarget } from "./commands.js";

/**
 * How long a forward is kept with no work sent through it.
 *
 * Long, because the gap it has to outlive is the gap between hot pushes: reaped sooner, every
 * push would raise a new forward to every machine and pay a handshake for each, which is the
 * cost this exists to remove. The shared shell can afford ten minutes because a probe touches
 * it constantly; nothing touches this one between upgrades.
 */
const IDLE_MS = 60 * 60_000;

/** How long the far server has to answer through a forward before it is called dead. */
const READY_TIMEOUT_MS = 20_000;

interface Forward {
  localPort: number;
  remotePort: number;
  child: ChildProcessByStdio<null, null, Readable>;
  exited: boolean;
  stderr: string;
  idle: NodeJS.Timeout | null;
}

const forwards = new Map<string, Forward>();

/**
 * A local port nothing is on. Bound and released rather than guessed: the kernel's own answer
 * is the only one true at the moment it is given. The gap before ssh binds it is a race
 * nobody can close, which is what ExitOnForwardFailure is for — losing it becomes a failure
 * with words rather than a forward that silently goes nowhere.
 */
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
  forward.idle = null;
  if (!forward.exited) forward.child.kill();
  if (forwards.get(address) === forward) forwards.delete(address);
}

/**
 * Restarts the idle countdown. The timer is also what collects a forward this generation of
 * the platform loses track of: a hot push re-imports the bundle cache-busted (hmr/host.ts) and
 * this map starts empty, but a scheduled timeout belongs to the PROCESS, so the callback still
 * holds the old child and still kills it — the same thing that collects an orphaned shell.
 * Unref'd, so nothing here keeps the process alive on its own account.
 */
function touch(address: string, forward: Forward): void {
  if (forward.idle !== null) clearTimeout(forward.idle);
  forward.idle = setTimeout(() => drop(address, forward), IDLE_MS);
  forward.idle.unref();
}

/**
 * The local port a machine's server can be reached on, opening a forward if there is none.
 * Reused across calls, and reopened when that server moved to another port — a forward to
 * where it used to be answers nothing.
 */
export async function forwardTo(opts: {
  /** Registry key: the machine's ssh address, the shape ssh-session.ts keys its shells by. */
  address: string;
  target: RemoteTarget;
  /** The port its server is bound to over there. */
  remotePort: number;
}): Promise<{ ok: true; port: number } | { ok: false; detail: string }> {
  const existing = forwards.get(opts.address);
  if (existing !== undefined) {
    if (!existing.exited && existing.remotePort === opts.remotePort) {
      touch(opts.address, existing);
      return { ok: true, port: existing.localPort };
    }
    drop(opts.address, existing);
  }

  const localPort = await freeLocalPort();
  if (localPort === null) return { ok: false, detail: "no free local port to forward on" };

  const child = spawn("ssh", forwardArgs(opts.target, localPort, opts.remotePort), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const forward: Forward = {
    localPort,
    remotePort: opts.remotePort,
    child,
    exited: false,
    stderr: "",
    idle: null,
  };
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

  const ready = await waitForTunneledHttp(
    `http://127.0.0.1:${localPort}`,
    () => forward.exited,
    READY_TIMEOUT_MS,
  );
  if (!ready.ok) {
    drop(opts.address, forward);
    const said = forward.stderr.trim(); // ssh's own words beat ours whenever it left any.
    return { ok: false, detail: said === "" ? ready.detail : said };
  }
  touch(opts.address, forward);
  return { ok: true, port: localPort };
}

/** Lets go of a machine's forward — a disconnect, or a machine that went away. */
export function closeForward(address: string): void {
  const forward = forwards.get(address);
  if (forward !== undefined) drop(address, forward);
}

/** Lets go of every forward. */
export function closeAllForwards(): void {
  for (const address of [...forwards.keys()]) closeForward(address);
}
