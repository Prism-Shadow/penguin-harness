/**
 * Starting and stopping the INSTALLED server on a remote machine — the half of connect that
 * talks to the far side. The commands themselves live in commands.ts (pure, unit-visible);
 * this module runs them and reads their answers through the same state probe the Machines
 * page already uses.
 *
 * The remote server is a plain `penguin server` process: started detached with nohup, found
 * again through its own `~/.penguin/data/server.lock`, never supervised. A machine that
 * reboots simply reads as "not running" on the next probe — we do not maintain the remote,
 * we re-probe and re-start on demand.
 */
import {
  serverLogTailCommand,
  sshArgs,
  startServerCommand,
  stopServerCommand,
} from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";
import { probeServerState } from "./server-state.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a freshly started remote server gets to write a live lock before we give up. */
const START_TIMEOUT_MS = 30_000;

/**
 * Starts the remote server on the given port and waits until its lock says it is alive on
 * that port. Failure carries the server log\'s last lines — the far side\'s own words about a
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
    const { state } = await probeServerState(target);
    if (state.kind === "running") {
      if (state.port === port) return { ok: true };
      // A live server on a DIFFERENT port answered: something else won the race. The caller
      // re-reads the state and decides; this start did not do what was asked.
      return { ok: false, detail: `a server is already running on port ${state.port}` };
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
    const { state } = await probeServerState(target);
    if (state.kind !== "running") return true;
  }
  return false;
}
