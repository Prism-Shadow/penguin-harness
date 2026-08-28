/**
 * Starting and stopping the INSTALLED server on a remote machine — the half of connect that
 * talks to the far side.
 *
 * One command each, and the machine does the waiting. It used to be done from here: `nohup …
 * &` to start it, then a fresh ssh probe every second for thirty seconds to find out whether
 * it came up — up to thirty round trips to learn one fact the machine knew the moment it
 * happened. `penguin server start` waits on the spot and answers once, so a start that takes
 * twenty seconds costs one connection instead of twenty.
 *
 * The remote server is a plain `penguin server` process, never supervised from here. A
 * machine that reboots simply reads as "not running" on the next probe; nothing is maintained
 * on the far side between calls.
 */
import { REMOTE_PENGUIN, sshArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";
import { jsonAnswer } from "./answer.js";

/** Generous: the far side is doing the waiting, and this only has to outlast it. */
const CALL_TIMEOUT_MS = 60_000;

/** What `penguin server start` / `stop` answer with. */
interface LifecycleResult {
  ok: boolean;
  port?: number;
  pid?: number;
  detail?: string;
}

/**
 * Runs one lifecycle command and reads its verdict (answer.ts). Output with no verdict in it
 * is a FAILURE carrying whatever the far side did say — a build too old for the subcommand
 * says so there, and reporting success because nothing contradicted us would be worse.
 */
async function lifecycle(
  target: RemoteTarget,
  command: string,
): Promise<{ ok: true; port?: number; pid?: number } | { ok: false; detail: string }> {
  const result = await run("ssh", sshArgs(target, `${REMOTE_PENGUIN} server ${command} 2>&1`), {
    timeoutMs: CALL_TIMEOUT_MS,
  });
  const answer = jsonAnswer<LifecycleResult>(result.stdout, "ok");
  if (answer !== null) {
    return answer.ok
      ? { ok: true, port: answer.port, pid: answer.pid }
      : { ok: false, detail: answer.detail ?? "the machine refused without saying why" };
  }
  const said = (result.stderr.trim() || result.stdout.trim()).trim();
  return { ok: false, detail: said === "" ? "the machine said nothing." : said };
}

/**
 * Starts the remote server on the given port and waits until it answers there. Failure
 * carries the far side's own words — its server log's last lines when the process came up and
 * died, which say far more about a port collision or a broken install than "it did not start".
 */
export function startRemoteServer(
  target: RemoteTarget,
  port: number,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`bad port ${port}`);
  return lifecycle(target, `start --port ${port}`).then((r) => (r.ok ? { ok: true as const } : r));
}

/** Stops the remote server and waits for it to let go. Already stopped counts as stopped. */
export async function stopRemoteServer(target: RemoteTarget): Promise<boolean> {
  return (await lifecycle(target, "stop")).ok;
}
