/**
 * Is the server this build installed on that machine actually running, and which machine is
 * it?
 *
 * One ssh round trip answers both: `penguin server status` over there prints one line of
 * JSON (machine-status.ts), and this reads it. Nothing is recovered from the shape of a
 * shell's output any more — the far side has Node, so the far side does the formatting, and
 * this side does not carry a parser for a format nobody defined.
 *
 * The remote server is a plain `penguin server` process, never supervised from here and
 * found again through its own data root. A machine that rebooted simply reads as "not
 * running" on the next probe; nothing is maintained on the far side between probes.
 *
 * ssh's own failure is not a separate condition to report — it IS the answer "cannot reach
 * this machine", carrying OpenSSH's diagnostic so a refused key or a dead host says why.
 */
import { REMOTE_PENGUIN, sshArgs } from "./commands.js";
import { jsonAnswer } from "./answer.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";
import type { ExecResult } from "./exec.js";
import type { MachineStatus } from "../machine-status.js";

/**
 * Asks the machine what it is doing, in its own words: `penguin server status` prints one
 * line of JSON with the server state and the machine's id (machine-status.ts over there).
 *
 * This used to be a shell script — `cat` the lock, `sed` the pid out of it, `kill -0`, then
 * `cat` a second file for the id — which bought two problems and no advantage. It needed a
 * parser HERE for a format defined nowhere, and it could not run on Windows at all, `kill -0`
 * having no cmd.exe equivalent. The far side has Node; asking it to answer in JSON puts the
 * work on the side that already has the tools for it.
 *
 * `2>&1` so the far side's own complaint (an old build with no such subcommand, a launcher
 * that is not there) comes back as text rather than being swallowed by the shared shell,
 * which merges the streams and reports an empty stderr.
 */
export function readServerStateCommand(): string {
  return `${REMOTE_PENGUIN} server status 2>&1`;
}

/** Long enough for a slow link, short enough that a dead host does not hold a refresh open. */
const PROBE_TIMEOUT_MS = 20_000;

export type MachineServerState =
  /** The machine answered and a server owns its data root: it is up on that port. */
  | { kind: "running"; port: number; pid: number }
  /** The machine answered; nothing is serving there. The program is installed either way. */
  | { kind: "stopped" }
  /** No usable answer — unreachable, refused, or a build that cannot answer the question. */
  | { kind: "unreachable"; detail: string };

/** What one probe learned: the server's state, and who that machine says it is. */
export interface MachineProbe {
  state: MachineServerState;
  /**
   * The machine's own id, when it has one. Absent until a server has STARTED there — the id
   * is minted by that server, not by the install — so a freshly installed machine answers
   * `stopped` with no id, and gains one the first time it runs.
   */
  machineId: string | null;
}

/**
 * Reads the answer out of the command's output.
 *
 * Line by line rather than parsing the whole thing: an ssh command runs in a shell that may
 * print a banner, an MOTD or a warning of its own, and none of that is the machine's answer.
 *
 * Output holding no answer at all is NOT reported as "stopped". A build too old for the
 * subcommand, or a launcher that is not where this side expects it, would then look exactly
 * like a healthy machine with nothing running — so it reads as "cannot tell", carrying what
 * the far side actually said.
 */
export function parseProbe(stdout: string): MachineProbe {
  const status = jsonAnswer<MachineStatus>(stdout, "running");
  if (status === null) {
    const said = stdout.trim();
    return {
      state: { kind: "unreachable", detail: said === "" ? "the machine said nothing." : said },
      machineId: null,
    };
  }
  const id = status.machineId;
  return {
    state:
      status.running && typeof status.port === "number" && typeof status.pid === "number"
        ? { kind: "running", port: status.port, pid: status.pid }
        : { kind: "stopped" },
    machineId: typeof id === "string" && id !== "" ? id : null,
  };
}

/**
 * Probes one machine. Never throws: every failure is one of the states above.
 *
 * `exec` lets the caller supply a channel — the machines service passes the machine's shared
 * shell, so a probe every few minutes does not open a connection every few minutes. Left
 * out, it is a one-shot ssh, which is what a caller with no session to reuse should get.
 */
export async function probeServerState(
  target: RemoteTarget,
  exec?: (target: RemoteTarget, command: string) => Promise<ExecResult>,
): Promise<MachineProbe> {
  const result =
    exec === undefined
      ? await run("ssh", sshArgs(target, readServerStateCommand()), { timeoutMs: PROBE_TIMEOUT_MS })
      : await exec(target, readServerStateCommand());
  if (result.code !== 0) {
    // stdout as the fallback, not just stderr: over the shared shell the two streams are
    // merged and stderr arrives empty (ssh-session.ts), so reading only stderr threw away
    // the far side's own words — which here are the whole diagnostic, the command being one
    // the machine either ran or could not find.
    const detail = result.stderr.trim() || result.stdout.trim();
    return {
      state: {
        kind: "unreachable",
        detail: detail === "" ? "ssh exited without a message." : detail,
      },
      machineId: null,
    };
  }
  return parseProbe(result.stdout);
}
