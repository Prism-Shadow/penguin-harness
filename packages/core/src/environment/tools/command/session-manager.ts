/**
 * CommandSessionManager — registry and lifecycle management for long-running command sessions.
 *
 * Constructed by Environment (one per Session), injected via services and shared by the
 * `exec_command` and `input_command` tools. Registry responsibilities (id allocation, concurrency
 * cap, dispose, process 'exit' fallback) are handled by the generic `BackgroundRegistry` (shared
 * with subagent sessions, see `../background/registry.ts`); this class only retains
 * command-domain logic: spawning processes and assembling the child process environment (vault
 * injection + hardening).
 * Docs: /docs/tools § "Background session caps".
 */
import { ManagedSession } from "./session.js";
import { BackgroundRegistry } from "../background/index.js";

/** Concurrent managed-session cap: evicts once exceeded (exited sessions first, otherwise LRU — killing a background process has bounded cost). */
const MAX_SESSIONS = 64;

/**
 * Hardening overrides applied to the child process environment: suppresses editor/credential
 * prompts/pagers/color etc. that could interact, avoiding a command hanging while waiting for
 * input. `GIT_EDITOR=true` prevents `git commit`/`rebase -i` from popping an editor;
 * `GIT_TERMINAL_PROMPT=0` prevents git from interactively asking for credentials; in pipe mode,
 * git and similar tools already auto-disable the pager, so the `PAGER` entries are just an extra
 * safeguard.
 */
const HARDENED_ENV: NodeJS.ProcessEnv = {
  GIT_EDITOR: "true",
  GIT_TERMINAL_PROMPT: "0",
  TERM: "dumb",
  NO_COLOR: "1",
  PAGER: "cat",
  GIT_PAGER: "cat",
};

export class CommandSessionManager {
  private readonly registry = new BackgroundRegistry<ManagedSession>({
    idPrefix: "proc",
    maxTasks: MAX_SESSIONS,
  });

  /** Agent vault environment variables: injected into the child process on every spawn (values never enter the model context, only the environment). */
  private readonly vault: Record<string, string>;

  constructor(opts?: { vault?: Record<string, string> }) {
    this.vault = opts?.vault ?? {};
  }

  /** Starts a command, returning an **unregistered** session (no process_id yet). */
  spawn(opts: { cmd: string; cwd: string }): ManagedSession {
    if (this.registry.isDisposed) {
      throw new Error("command session manager disposed");
    }
    return new ManagedSession({
      cmd: opts.cmd,
      cwd: opts.cwd,
      // Spread order is priority: vault overrides host variables of the same name, but must
      // come before HARDENED_ENV — the hardening entries (GIT_EDITOR/PAGER etc. that prevent
      // interactive hangs) must never be overridable by vault.
      env: { ...process.env, ...this.vault, ...HARDENED_ENV },
    });
  }

  /** Registers a still-running session as a background process, allocating and returning a unique `process_id`. */
  register(session: ManagedSession): string {
    this.registry.makeRoom(true);
    return this.registry.register(session);
  }

  /** Looks up a session by process_id and refreshes its access time; returns undefined if it doesn't exist. */
  get(processId: string): ManagedSession | undefined {
    return this.registry.get(processId);
  }

  /** Removes from the registry and cleans up the process group (called after the session exits). */
  remove(processId: string): void {
    this.registry.remove(processId);
  }

  /** Disposes: removes the fallback registration and kills all sessions (the process 'exit' fallback is hooked up by the registry itself). Idempotent. */
  dispose(): void {
    this.registry.dispose();
  }
}
