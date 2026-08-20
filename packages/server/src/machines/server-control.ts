/**
 * Starting, watching and stopping the INSTALLED server on a remote machine — the half of
 * "connect" that talks to the far side. The commands themselves live in commands.ts (pure,
 * unit-visible); this module runs them and reads their answers.
 *
 * The remote server is a plain `penguin server` process: started detached with nohup, found
 * again through its own `~/.penguin/data/server.lock` (pid + port), never supervised. A
 * machine that reboots simply reads as "not running" on the next connect — the design says
 * we do not maintain the remote, we re-probe and re-start on demand.
 */
import {
  readServerStateCommand,
  SERVER_ALIVE_MARK,
  serverLogTailCommand,
  sshArgs,
  startServerCommand,
  stopServerCommand,
} from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";

/** What the state probe said: the lock as written, and whether its pid is alive over there. */
export interface RemoteServerState {
  lock: { pid: number; port: number } | null;
  alive: boolean;
}

/**
 * Reads the probe's output. The lock text is whatever `cat` printed before the alive marker;
 * a malformed or missing lock reads as "no server", exactly like the local reader does.
 */
export function parseRemoteServerState(stdout: string): RemoteServerState {
  const alive = stdout.includes(SERVER_ALIVE_MARK);
  const text = stdout.split(SERVER_ALIVE_MARK)[0] ?? "";
  try {
    const parsed = JSON.parse(text.trim()) as { pid?: unknown; port?: unknown };
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.port === "number" &&
      Number.isInteger(parsed.port)
    ) {
      return { lock: { pid: parsed.pid, port: parsed.port }, alive };
    }
  } catch {
    // Not a lock: nothing running, or the file is damaged — same answer either way.
  }
  return { lock: null, alive: false };
}

export async function remoteServerState(target: RemoteTarget): Promise<RemoteServerState> {
  const result = await run("ssh", sshArgs(target, readServerStateCommand()), {
    timeoutMs: 30_000,
  });
  if (result.code !== 0) return { lock: null, alive: false };
  return parseRemoteServerState(result.stdout);
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a freshly started remote server gets to write a live lock before we give up. */
const START_TIMEOUT_MS = 30_000;

/**
 * Starts the remote server on the given port and waits until its lock says it is alive on
 * that port. Failure carries the server log's last lines — the server's own words about a
 * port collision or a broken install say more than "it did not come up".
 */
export async function startRemoteServer(
  target: RemoteTarget,
  port: number,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const started = await run("ssh", sshArgs(target, startServerCommand(port)), {
    timeoutMs: 30_000,
  });
  if (started.code !== 0) {
    return { ok: false, detail: started.stderr.trim() || "ssh failed to start the server" };
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(1000);
    const state = await remoteServerState(target);
    if (state.alive && state.lock !== null) {
      if (state.lock.port === port) return { ok: true };
      // A live server on a DIFFERENT port answered: something else won the race. The caller
      // re-reads the state and decides; this start did not do what was asked.
      return { ok: false, detail: `a server is already running on port ${state.lock.port}` };
    }
  }
  const log = await run("ssh", sshArgs(target, serverLogTailCommand()), { timeoutMs: 30_000 });
  return {
    ok: false,
    detail: log.stdout.trim() || "the server never wrote a live lock (no log either)",
  };
}

/** Stops the remote server (TERM) and waits for its lock to read dead. Best-effort. */
export async function stopRemoteServer(target: RemoteTarget, pid: number): Promise<boolean> {
  await run("ssh", sshArgs(target, stopServerCommand(pid)), { timeoutMs: 30_000 });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await delay(500);
    const state = await remoteServerState(target);
    if (!state.alive) return true;
  }
  return false;
}
