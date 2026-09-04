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
import { REMOTE_PENGUIN, SERVER_LOG_TAIL, startServerCommand } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import type { ExecResult } from "./transport/index.js";
import { probeServerState } from "./server-state.js";
import { jsonAnswer } from "./answer.js";

/** How long a freshly started server gets to answer on its port. */
const START_TIMEOUT_MS = 30_000;

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

/**
 * Stops the remote server, over its own CLI.
 *
 * `penguin server stop` and not a request to the server itself: the machine that needs
 * stopping is usually the one whose PLATFORM is behind, and a platform route only exists
 * once it is already running the build that has it. The CLI comes from the store this side
 * pushed (commands.ts's REMOTE_PENGUIN), so it speaks the current protocol whatever the
 * running platform is.
 */
export async function stopRemoteServer(
  target: RemoteTarget,
  exec: (target: RemoteTarget, command: string) => Promise<ExecResult>,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const result = await exec(target, `${REMOTE_PENGUIN} server stop 2>&1`);
  const answer = jsonAnswer<{ ok: boolean; detail?: string }>(result.stdout, "ok");
  if (answer?.ok === true) return { ok: true };
  const said = answer?.detail ?? result.stdout.trim();
  return { ok: false, detail: said === "" ? "the machine said nothing." : said };
}
