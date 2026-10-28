/**
 * One mouth per machine, and behind it ONE CONNECTION: every word this server speaks to a
 * machine leaves through the MachineConnection for that machine's address, and everything
 * it carries rides the single `ssh -T -D` session ssh-session.ts holds — a probe as a
 * command on its stdin, an installer or a tarball as a heredoc on the same stdin, the
 * machine's API as a channel dialled through the session's SOCKS port (socks.ts). There is
 * no forward process, no one-shot ssh per step, no scp: nothing opens a second connection
 * to a machine, however many callers ask and however often, because there is nothing that
 * could.
 *
 * The guarantee is AUTHORITY first — nothing outside machines/transport/ may open ssh, and
 * machines-transport-boundary.test.ts pins that — and then STRUCTURE: the connection is one,
 * and a second ask queues behind the first. The incident behind this seam (#561) grew where
 * it was absent — four call sites each opened their own channel, each judged the machine's
 * liveness from its own channel's state, and the judgements disagreed.
 *
 * THE ONE EXCEPTION is a Windows remote: sshd there hands commands to cmd.exe, and there is no
 * `sh` to hold a session on. `oneShot` and `copyTo` exist for that host alone — an install
 * runs the PowerShell installer on its own connection — and a Windows machine cannot be
 * connected (no session, no SOCKS, no API) until it has a shell to hold. Serialised per
 * machine all the same (lane.ts).
 *
 * The handle is stateless on purpose: per-machine state stays in ssh-session.ts, keyed by
 * address, so holding a MachineConnection costs nothing and dropping one leaks nothing. The
 * address is always `ssh:<alias>` — the one spelling every registry in machines/ uses.
 *
 * LIFETIME. A session a passing command opened is transient and idles out; one a connect
 * asked to HOLD is kept — reopened by the transport itself when it drops, until a disconnect
 * closes it. Sessions belong to the generation that opened them: a platform generation on its
 * way out closes all of its own (closeAllConnections), and the next re-holds what the record
 * says was held. No session is ever closed by a pid remembered from before.
 *
 * CUT. A target built for this server's automatic work carries that work's signal (commands.ts's
 * RemoteTarget). When the work is cut, its running command ends the session it rode, its requests
 * are destroyed, and nothing more is started for it — a person's job on that machine then has
 * the connection to itself at once.
 */
import http from "node:http";
import type net from "node:net";
import { run, runWithInput } from "./exec.js";
import {
  STOPPED,
  closeAllShells,
  closeShell,
  holdShell,
  isHeld,
  openShell,
  runOnShell,
  sessionOf,
} from "./ssh-session.js";
import type { ShellSession } from "./ssh-session.js";
import { dialThroughSocks } from "./socks.js";
import { inLane } from "./lane.js";
import { noteSignIn, signInFor } from "./login.js";
import { scpArgs, sshArgs } from "../commands.js";
import type { ExecResult } from "./exec.js";
import type { RemoteTarget } from "../commands.js";

/**
 * The verbs a caller speaks to a machine with — what install-server.ts is written against,
 * so a test can hand it a scripted channel instead of a real one.
 */
export interface MachineChannel {
  exec(command: string): Promise<ExecResult>;
  stream(
    command: string,
    opts: { input: Buffer; onLine?: (line: string) => void; timeoutMs?: number },
  ): Promise<ExecResult>;
  oneShot(command: string, opts?: { timeoutMs?: number; input?: Buffer }): Promise<ExecResult>;
  copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult>;
}

/** Enough for an installer to download a release, or a store to cross a slow link. */
const BULK_TIMEOUT_MS = 10 * 60_000;

/**
 * The agents each piece of cut-able work made, destroyed together when it is cut: one abort
 * listener per signal however many agents the work asks for, which an AbortSignal would
 * otherwise warn about past ten.
 */
const agentsOf = new WeakMap<AbortSignal, Set<http.Agent>>();

function destroyOnCut(signal: AbortSignal, agent: http.Agent): void {
  let agents = agentsOf.get(signal);
  if (agents === undefined) {
    const made = new Set<http.Agent>();
    signal.addEventListener("abort", () => made.forEach((each) => each.destroy()), { once: true });
    agentsOf.set(signal, made);
    agents = made;
  }
  agents.add(agent);
}

export class MachineConnection implements MachineChannel {
  readonly address: string;

  constructor(readonly target: RemoteTarget) {
    this.address = `ssh:${target.alias}`;
  }

  /** The signal of the work this target was built for, as a shell command's option. */
  #cut(): { signal?: AbortSignal } {
    return this.target.signal === undefined ? {} : { signal: this.target.signal };
  }

  /** A command over the session — queued, output merged (ssh-session.ts), in ExecResult shape. */
  async exec(command: string): Promise<ExecResult> {
    const result = await runOnShell(this.address, this.target, command, this.#cut());
    return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
  }

  /**
   * A command that reads `input` from its stdin — an installer script, a tarball — over the
   * same session, as a heredoc. `onLine` relays the far side's progress as it arrives.
   */
  async stream(
    command: string,
    opts: { input: Buffer; onLine?: (line: string) => void; timeoutMs?: number },
  ): Promise<ExecResult> {
    const result = await runOnShell(this.address, this.target, command, {
      input: opts.input,
      ...(opts.onLine === undefined ? {} : { onLine: opts.onLine }),
      timeoutMs: opts.timeoutMs ?? BULK_TIMEOUT_MS,
      ...this.#cut(),
    });
    return { code: result.code, stdout: result.output, stderr: "", timedOut: false };
  }

  /** Brings the session up, or says why it cannot be. Transient: it idles out unused. */
  open(): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
    return openShell(this.address, this.target);
  }

  /** Brings the session up and KEEPS it — see the module doc — or says why it cannot be. */
  hold(): Promise<{ ok: true; session: ShellSession } | { ok: false; detail: string }> {
    return holdShell(this.address, this.target);
  }

  /** Whether the session to this machine is a held one. */
  held(): boolean {
    return isHeld(this.address);
  }

  /** The session while it is up. */
  session(): ShellSession | null {
    return sessionOf(this.address);
  }

  /** A TCP connection to `127.0.0.1:<remotePort>` as seen from the machine — a channel in the session. */
  async dial(remotePort: number): Promise<net.Socket> {
    const opened = await this.open();
    if (!opened.ok) throw new Error(opened.detail);
    return dialThroughSocks(opened.session.socksPort, "127.0.0.1", remotePort);
  }

  /** An http.Agent whose every socket is a dial through the session — for node:http callers. */
  agent(remotePort: number): http.Agent {
    const agent = new http.Agent({ keepAlive: false });
    // Cut work ends its requests at once: every socket the agent holds is destroyed, and none
    // is dialled after — a dial that completes after the cut is closed rather than handed over.
    const signal = this.target.signal;
    if (signal !== undefined) destroyOnCut(signal, agent);
    // createConnection is documented on Agent (and overridable); the typings omit it.
    (agent as unknown as { createConnection: unknown }).createConnection = (
      _options: unknown,
      callback: (err: Error | null, socket?: net.Socket) => void,
    ) => {
      if (signal?.aborted === true) {
        callback(new Error(STOPPED.output));
        return;
      }
      this.dial(remotePort).then(
        (socket) => {
          if (signal?.aborted === true) {
            socket.destroy();
            callback(new Error(STOPPED.output));
            return;
          }
          callback(null, socket);
        },
        (err: unknown) => callback(err instanceof Error ? err : new Error(String(err))),
      );
    };
    return agent;
  }

  /**
   * WINDOWS REMOTES ONLY (see the module doc): a command on its own ssh connection, with an
   * optional stdin payload. Serialised per machine.
   */
  oneShot(command: string, opts: { timeoutMs?: number; input?: Buffer } = {}): Promise<ExecResult> {
    const args = sshArgs(this.target, command);
    const timeout = opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs };
    return inLane(this.address, () =>
      this.#signedIn("ssh", (launch) =>
        opts.input !== undefined
          ? runWithInput("ssh", args, { input: opts.input, ...timeout, ...launch })
          : run("ssh", args, { ...timeout, ...launch }),
      ),
    );
  }

  /** WINDOWS REMOTES ONLY: local files copied into a remote directory over scp. Serialised per machine. */
  copyTo(localFiles: string[], remoteDir: string): Promise<ExecResult> {
    return inLane(this.address, () =>
      this.#signedIn("scp", (launch) =>
        run("scp", scpArgs(this.target, localFiles, remoteDir), launch),
      ),
    );
  }

  /**
   * A one-off ssh or scp, signed in the way this machine signs in (login.ts): refused before it
   * starts when it may not be, and a refused password remembered when ssh's own exit says so.
   */
  async #signedIn(
    program: "ssh" | "scp",
    start: (launch: { env?: NodeJS.ProcessEnv; detached?: boolean }) => Promise<ExecResult>,
  ): Promise<ExecResult> {
    // Cut work starts nothing more, here as on the session.
    if (this.target.signal?.aborted === true) {
      return { code: 255, stdout: "", stderr: `${STOPPED.output}\n`, timedOut: false };
    }
    const login = await signInFor(this.target);
    if (!login.ok) return { code: 255, stdout: "", stderr: `${login.detail}\n`, timedOut: false };
    const { env, detached } = login.signIn;
    const result = await start({ ...(env === undefined ? {} : { env }), detached });
    // 255 is ssh's own failure (scp passes ssh's on as 1, with ssh's words on its stderr).
    if (result.code === 255 || (program === "scp" && result.code !== 0)) {
      noteSignIn(this.target, login.signIn, result.stderr);
    }
    return result;
  }
}

/** The machine's connection handle. Cheap: state lives in the per-address registry. */
export function connectionTo(target: RemoteTarget): MachineConnection {
  return new MachineConnection(target);
}

/**
 * Lets go of the connection to a machine, held or not. By address rather than on the handle:
 * a disconnect can outlive the resolvability of its target (an alias removed from the ssh
 * config still has a session to close). Only this generation's own registry is consulted —
 * there is deliberately no way to close a session by a pid remembered from before.
 */
export function closeConnectionTo(address: string): void {
  closeShell(address);
}

/** Every connection this generation opened, closed — the platform's dispose effect. */
export function closeAllConnections(): void {
  closeAllShells();
}
