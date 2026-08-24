/**
 * Is the server this build installed on that machine actually running?
 *
 * One ssh round trip answers it: the lock file's text plus a marker when the pid recorded
 * there is alive (readServerStateCommand). The remote server is a plain `penguin server`
 * process — never supervised from here, found again through its own
 * `~/.penguin/data/server.lock`. A machine that rebooted simply reads as "not running" on
 * the next probe; nothing is maintained on the far side between probes.
 *
 * ssh's own failure is not a separate condition to report — it IS the answer "cannot reach
 * this machine", carrying OpenSSH's diagnostic so a refused key or a dead host says why.
 */
import { MACHINE_ID_MARK, SERVER_ALIVE_MARK, readServerStateCommand, sshArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";
import type { ExecResult } from "./exec.js";
import { parseMachineId } from "./machine-id.js";

/** Long enough for a slow link, short enough that a dead host does not hold a refresh open. */
const PROBE_TIMEOUT_MS = 20_000;

export type MachineServerState =
  /** ssh answered and the lock names a live pid: the server is up on that port. */
  | { kind: "running"; port: number; pid: number }
  /** ssh answered; no lock, or its pid is gone. The program is there, nothing is serving. */
  | { kind: "stopped" }
  /** ssh did not answer at all — unreachable, refused, or authentication that cannot proceed. */
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
 * Reads the probe's output. The lock text is whatever `cat` printed before the alive marker;
 * a malformed or missing lock reads as "nothing running", exactly like the local reader
 * does — a damaged lock and an absent one mean the same thing to a caller.
 */
export function parseProbe(stdout: string): MachineProbe {
  const [beforeId, afterId] = splitOnce(stdout, MACHINE_ID_MARK);
  return {
    state: parseServerState(beforeId),
    machineId: afterId === null ? null : parseMachineId(afterId),
  };
}

/** `text` up to the first `mark`, and what followed it (null when the mark is absent). */
function splitOnce(text: string, mark: string): [string, string | null] {
  const at = text.indexOf(mark);
  return at === -1 ? [text, null] : [text.slice(0, at), text.slice(at + mark.length)];
}

export function parseServerState(stdout: string): MachineServerState {
  const alive = stdout.includes(SERVER_ALIVE_MARK);
  const text = stdout.split(SERVER_ALIVE_MARK)[0] ?? "";
  try {
    const parsed = JSON.parse(text.trim()) as { pid?: unknown; port?: unknown };
    if (
      alive &&
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      typeof parsed.port === "number" &&
      Number.isInteger(parsed.port)
    ) {
      return { kind: "running", port: parsed.port, pid: parsed.pid };
    }
  } catch {
    // Not a lock: nothing running, or the file is damaged — same answer either way.
  }
  return { kind: "stopped" };
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
    const detail = result.stderr.trim();
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
