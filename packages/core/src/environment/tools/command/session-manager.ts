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

/**
 * Harness-owned variables **removed** from the child environment (deleted, not blanked: a
 * program that checks `PORT` for presence rather than value must see nothing at all).
 *
 * `PORT` / `HOST` describe the port the harness itself listens on. `penguin web` writes both
 * into its own `process.env` as the channel to the server module (see the CLI's `startServer`),
 * so without this every command the Agent runs inherits them — and `npm run dev`, Vite, Next
 * and most Express templates all read `PORT`, so an Agent asked to start a dev server would
 * bind the harness's own port instead of picking its own. Stripping is right even when the
 * value came from the user's shell (`PORT=3000 penguin web`): it still means "the port
 * PenguinHarness is on", which is precisely the port a spawned server must not take.
 *
 * `PENGUIN_CLI_ENTRY` / `PENGUIN_WEB_DIST` are internal plumbing between the CLI and the
 * server; they mean nothing to a command and leak install paths.
 *
 * Deliberately **not** stripped: `PENGUIN_HOME` and the other user-facing `PENGUIN_*` settings.
 * An Agent working on PenguinHarness itself (the self-evolution case) may legitimately need to
 * run against the same data root, and that is a config decision rather than a leak.
 */
const STRIPPED_ENV_KEYS = ["PORT", "HOST", "PENGUIN_CLI_ENTRY", "PENGUIN_WEB_DIST"] as const;

/**
 * The host environment minus {@link STRIPPED_ENV_KEYS}. Exported for the unit test — the
 * spawn path itself cannot be asserted without starting a real process.
 */
export function hostEnvForChild(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of STRIPPED_ENV_KEYS) delete env[key];
  return env;
}

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
      // interactive hangs) must never be overridable by vault. The host side is stripped of
      // the harness's own variables first (see STRIPPED_ENV_KEYS); the vault still wins, so a
      // user who genuinely wants PORT in commands can set it there.
      env: { ...hostEnvForChild(), ...this.vault, ...HARDENED_ENV },
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
