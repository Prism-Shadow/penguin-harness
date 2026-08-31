/**
 * One mouth per machine: every word this server speaks to a machine leaves through the
 * MachineConnection for that machine's address — a probe on the shared shell, a one-shot
 * install step, a streamed transfer, the held forward. What sockets exist underneath
 * (today: one `ssh -T sh` shell, one `ssh -N -L` forward, a fresh ssh/scp per bulk
 * transfer) is this directory's implementation detail, free to be tightened toward a
 * literal single connection later without a caller noticing.
 *
 * The guarantee is AUTHORITY, not socket count: nothing outside machines/transport/ may
 * open ssh, and machines-transport-boundary.test.ts pins that. The incident behind this
 * seam (#561) grew where it was absent — four call sites each opened their own channel,
 * each judged the machine's liveness from its own channel's state, and the judgements
 * disagreed.
 *
 * The handle is stateless on purpose: per-machine state stays in the private modules
 * (ssh-session.ts keys shells by address, forward.ts keys forwards by address), so holding
 * a MachineConnection costs nothing and dropping one leaks nothing. The address is always
 * `ssh:<alias>` — the one spelling every registry in machines/ already uses.
 */
import { run, runPiped, runWithInput } from "./exec.js";
import { closeShell, runOnShell } from "./ssh-session.js";
import { closeForward, forwardTo } from "./forward.js";
import { scpArgs, sshArgs } from "../commands.js";
import type { ExecResult } from "./exec.js";
import type { RemoteTarget } from "../commands.js";

export class MachineConnection {
  readonly address: string;

  constructor(readonly target: RemoteTarget) {
    this.address = `ssh:${target.alias}`;
  }

  /**
   * A small command over the machine's shared shell — queued, output merged (ssh-session.ts),
   * answered in ExecResult shape so a caller parses one channel identically whichever way
   * the command reached the machine.
   */
  async exec(command: string): Promise<ExecResult> {
    const result = await runOnShell(this.address, this.target, command);
    return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
  }

  /**
   * A command on its own ssh connection — for the long steps and stdin payloads the shared
   * shell's one pipe cannot carry. With `input`, the payload rides stdin and `onLine`
   * relays the far side's progress as it arrives (an install takes minutes).
   */
  oneShot(
    command: string,
    opts: { timeoutMs?: number; input?: Buffer; onLine?: (line: string) => void } = {},
  ): Promise<ExecResult> {
    const args = sshArgs(this.target, command);
    if (opts.input !== undefined) {
      return runWithInput("ssh", args, {
        input: opts.input,
        ...(opts.onLine === undefined ? {} : { onLine: opts.onLine }),
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
      });
    }
    return run("ssh", args, opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs });
  }

  /** A local process's stdout piped straight into a remote command (local tar → remote unpack). */
  pipeTo(
    producer: { file: string; args: string[] },
    command: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<ExecResult> {
    return runPiped(producer, { file: "ssh", args: sshArgs(this.target, command) }, opts);
  }

  /** Local files copied into a remote directory over scp. */
  copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult> {
    return run("scp", scpArgs(this.target, localFiles, remoteDir));
  }

  /** The held forward to a port on the machine (forward.ts: raised once, reused while live). */
  forward(
    remotePort: number,
  ): Promise<{ ok: true; port: number; pid: number | null } | { ok: false; detail: string }> {
    return forwardTo({ address: this.address, target: this.target, remotePort });
  }
}

/** The machine's connection handle. Cheap: state lives in the per-address registries. */
export function connectionTo(target: RemoteTarget): MachineConnection {
  return new MachineConnection(target);
}

/**
 * Lets go of every channel to a machine — the shared shell and the forward. By address
 * rather than on the handle: a disconnect can outlive the resolvability of its target (an
 * alias removed from the ssh config still has channels to close). `forwardPid` collects a
 * recorded forward a previous platform generation spawned (forward.ts).
 */
export function closeConnectionTo(address: string, forwardPid?: number | null): void {
  closeShell(address);
  closeForward(address, forwardPid);
}
