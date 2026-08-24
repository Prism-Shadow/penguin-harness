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
import { SERVER_ALIVE_MARK, readServerStateCommand, sshArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { run } from "./exec.js";

/** Long enough for a slow link, short enough that a dead host does not hold a refresh open. */
const PROBE_TIMEOUT_MS = 20_000;

export type MachineServerState =
  /** ssh answered and the lock names a live pid: the server is up on that port. */
  | { kind: "running"; port: number; pid: number }
  /** ssh answered; no lock, or its pid is gone. The program is there, nothing is serving. */
  | { kind: "stopped" }
  /** ssh did not answer at all — unreachable, refused, or authentication that cannot proceed. */
  | { kind: "unreachable"; detail: string };

/**
 * Reads the probe's output. The lock text is whatever `cat` printed before the alive marker;
 * a malformed or missing lock reads as "nothing running", exactly like the local reader
 * does — a damaged lock and an absent one mean the same thing to a caller.
 */
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

/** Probes one machine. Never throws: every failure is one of the states above. */
export async function probeServerState(target: RemoteTarget): Promise<MachineServerState> {
  const result = await run("ssh", sshArgs(target, readServerStateCommand()), {
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const detail = result.stderr.trim();
    return {
      kind: "unreachable",
      detail: detail === "" ? "ssh exited without a message." : detail,
    };
  }
  return parseServerState(result.stdout);
}
