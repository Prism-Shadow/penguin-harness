/**
 * Is the server this build installed on that machine running, and which machine is it?
 *
 * One ssh round trip answers both: `penguin server status` over there prints one line of
 * JSON (machine-status.ts). The far side has Node, so the far side formats; this side
 * carries no parser for a shell's output. ssh's own failure is not a separate condition —
 * it IS the answer "cannot reach this machine", carrying OpenSSH's diagnostic.
 */
import { remotePenguin } from "./commands.js";
import type { RemoteLayout } from "./layout.js";
import { jsonAnswer } from "./answer.js";
import type { RemoteTarget } from "./commands.js";
import type { RemotePlatform } from "./detect.js";
import type { ExecResult } from "./transport/index.js";
import type { MachineStatus } from "../machine-status.js";

/**
 * `2>&1` so the far side's own complaint (an old build with no such subcommand, a launcher
 * that is not there) comes back as text rather than being swallowed by the shared shell,
 * which merges the streams and reports an empty stderr.
 */
export function readServerStateCommand(platform: RemotePlatform, layout: RemoteLayout): string {
  return `${remotePenguin(platform, layout)} server status 2>&1`;
}

type MachineServerState =
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
  const said = stdout.trim();
  const cannotTell = (detail: string): MachineProbe => ({
    state: { kind: "unreachable", detail },
    machineId: null,
  });
  const status = jsonAnswer<MachineStatus>(stdout, "running");
  if (status === null) return cannotTell(said === "" ? "the machine said nothing." : said);

  // The declared type is what a healthy far side sends; this is untrusted text off a wire,
  // so the shape is checked rather than assumed. For the same reason output holding no
  // answer is not "stopped": an answer whose shape is wrong is not an answer either, and
  // coercing one MANUFACTURES a state. `"running": "false"` is a truthy string and would
  // read as up; `"running": true` carrying no port would read as down. Both are worse than
  // saying the machine could not be read.
  const { running, port, pid } = status;
  const id = status.machineId;
  const machineId = typeof id === "string" && id !== "" ? id : null;
  if (typeof running !== "boolean") return cannotTell(said);
  if (!running) return { state: { kind: "stopped" }, machineId };
  if (typeof port !== "number" || typeof pid !== "number") return cannotTell(said);
  return { state: { kind: "running", port, pid }, machineId };
}

/**
 * Probes one machine. Never throws: every failure is one of the states above.
 *
 * `exec` is the caller's channel — the machines service passes the machine's shared shell,
 * so a probe every few minutes does not open a connection every few minutes. Required: the
 * one-shot fallback this parameter used to have was a second mouth to the machine, opened
 * outside the transport seam (see transport/connection.ts).
 */
export async function probeServerState(
  target: RemoteTarget,
  layout: RemoteLayout,
  exec: (target: RemoteTarget, command: string) => Promise<ExecResult>,
  /**
   * The dialect to ask in — what the install found the machine to be. Null when nothing is
   * on record: the POSIX form is tried first and, if it holds no answer, the Windows form,
   * the same way detectRemote asks. One round trip for a machine that is known, two at most
   * for one that is not.
   */
  platform: RemotePlatform | null = null,
): Promise<MachineProbe> {
  const first = await probeIn(target, layout, exec, platform ?? "linux");
  if (platform !== null || first.state.kind !== "unreachable") return first;
  const second = await probeIn(target, layout, exec, "win32");
  return second.state.kind === "unreachable" ? first : second;
}

async function probeIn(
  target: RemoteTarget,
  layout: RemoteLayout,
  exec: (target: RemoteTarget, command: string) => Promise<ExecResult>,
  platform: RemotePlatform,
): Promise<MachineProbe> {
  const result = await exec(target, readServerStateCommand(platform, layout));
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
