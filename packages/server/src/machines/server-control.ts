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
import { remotePenguin, serverLogTail, startServerCommand } from "./commands.js";
import type { RemoteLayout } from "./layout.js";
import type { RemoteTarget } from "./commands.js";
import type { ExecResult } from "./exec.js";
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
  layout: RemoteLayout,
  exec: (target: RemoteTarget, command: string) => Promise<ExecResult>,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const started = await exec(target, startServerCommand(port, layout));
  if (started.code !== 0) {
    return { ok: false, detail: started.stdout.trim() || "the machine could not start it." };
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Each probe is a full Node start on the far side (`penguin-hmr.js server status`), so
    // the interval is what bounds the CPU this wait costs there; a server that is coming up
    // takes a few seconds anyway.
    await sleep(1500);
    const probed = await probeServerState(target, layout, exec);
    if (probed.state.kind === "running") return { ok: true };
  }
  const tail = (await exec(target, serverLogTail(layout))).stdout.trim();
  return { ok: false, detail: tail || "it did not answer within 30s." };
}

/**
 * Stops the remote server, over its own CLI.
 *
 * `penguin server stop` and not a request to the server itself: the machine that needs
 * stopping is usually the one whose PLATFORM is behind, and a platform route only exists
 * once it is already running the build that has it. The CLI comes from the store this side
 * pushed (commands.ts's remotePenguin), so it speaks the current protocol whatever the
 * running platform is.
 */
export async function stopRemoteServer(
  target: RemoteTarget,
  layout: RemoteLayout,
  exec: (target: RemoteTarget, command: string) => Promise<ExecResult>,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const result = await exec(target, `${remotePenguin(layout)} server stop 2>&1`);
  const answer = jsonAnswer<{ ok: boolean; detail?: string }>(result.stdout, "ok");
  if (answer?.ok === true) return { ok: true };
  const said = answer?.detail ?? result.stdout.trim();
  return { ok: false, detail: said === "" ? "the machine said nothing." : said };
}
