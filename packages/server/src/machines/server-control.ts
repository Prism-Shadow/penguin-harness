/**
 * Starting and stopping the INSTALLED server on a remote machine.
 *
 * A start is one command on the shared shell — `nohup penguin server … &` — and then the
 * status probe, on that same shell, until the server answers. A stop is a request to the
 * server's own shutdown endpoint, over the forward this side holds, then watching that port
 * go quiet. Neither costs a handshake.
 *
 * The remote server is a plain `penguin server` process, never supervised from here. A
 * machine that reboots simply reads as "not running" on the next probe.
 */
import { SERVER_LOG_TAIL, startServerCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import type { ExecResult } from "./exec.js";
import { probeServerState } from "./server-state.js";
import { machineApi } from "./machine-api.js";

/** How long a freshly started server gets to answer on its port. */
const START_TIMEOUT_MS = 30_000;

/** How long a server asked to shut down gets to let go of its port. */
const STOP_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the remote server on the given port and waits until it answers there. Failure
 * carries the far side's own words — its server log's last lines when the process came up
 * and died, which say more about a port collision or a broken install than "did not start".
 */
export async function startRemoteServer(
  target: RemoteTarget,
  port: number,
  exec: (target: RemoteTarget, command: string) => Promise<ExecResult>,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const started = await exec(target, startServerCommand(port));
  if (started.code !== 0) {
    return { ok: false, detail: started.stdout.trim() || "the machine could not start it." };
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    const probed = await probeServerState(target, exec);
    if (probed.state.kind === "running") return { ok: true };
  }
  const tail = (await exec(target, SERVER_LOG_TAIL)).stdout.trim();
  return { ok: false, detail: tail || "it did not answer within 30s." };
}

/** Asks the server reachable at `port` to shut down and waits for it to stop answering. */
export async function stopRemoteServer(port: number, cookie: string): Promise<boolean> {
  const api = machineApi(port, cookie);
  try {
    if ((await api.request("POST", "/api/version/shutdown", {})).status !== 202) return false;
  } catch {
    return false;
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await api.request("GET", "/api/version");
    } catch {
      return true; // The forward's far end refuses now: the port is free.
    }
    await sleep(250);
  }
  return false;
}
