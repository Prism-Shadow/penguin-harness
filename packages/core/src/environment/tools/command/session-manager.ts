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
 * Harness-owned variables **removed** from the child environment (removed, not blanked: a
 * program that checks `PORT` for presence rather than value must see nothing at all).
 *
 * `PORT` / `HOST` are stripped because they are never about the command being run. On the
 * serving paths they are the harness's own listener: `penguin web` / `penguin server` write both
 * into their own `process.env` as the channel to the server module (see the CLI's `startServer`).
 * On the CLI-only paths (`penguin run`, `penguin chat`, the REPL) nothing listens at all, but the
 * CLI still loads `dotenv/config`, so a `PORT` there is the one the *user's own project* picked
 * for *its* server. `npm run dev`, Vite, Next and most Express templates read `PORT`, so either
 * way an inherited value makes a server the Agent starts bind a port it was never asked to take —
 * the harness's own in the first case, one already spoken for in the second. A command that needs
 * a particular port should be told so in its own invocation (or through the vault), never by
 * ambient inheritance.
 *
 * `PENGUIN_CLI_ENTRY` is internal plumbing: the CLI uses it to tell the server which script to
 * re-run for self-update. It means nothing to any other program and leaks the install path.
 *
 * `PENGUIN_WEB_DIST` is *not* internal — it is a documented deployment override (see the
 * configuration reference and the server README) — and is stripped anyway because it names this
 * installation's front-end build. In the self-development case an Agent that starts a
 * PenguinHarness server would otherwise serve the deployment's assets instead of the ones it just
 * built in the workspace, silently and with no error to read.
 *
 * Deliberately **not** stripped: `PENGUIN_HOME`, `PENGUIN_WEB_DB` and the rest of the user-facing
 * `PENGUIN_*` settings. Those select the *data* an Agent-started harness works against, and the
 * self-development case may legitimately want the same data root — sharing state is a config
 * decision, whereas serving a deployment's code from a workspace checkout never is.
 */
const STRIPPED_ENV_KEYS = new Set([
  "PORT",
  "HOST",
  "PENGUIN_CLI_ENTRY",
  "PENGUIN_WEB_DIST",
  // `FORCE_COLOR` wins over NO_COLOR in Node and several popular color libraries. A host or
  // vault value must not force terminal escapes into these deliberately piped sessions.
  "FORCE_COLOR",
  "FORCE_COLORS",
]);

/** The host environment minus {@link STRIPPED_ENV_KEYS}. */
function hostEnvForChild(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Matched case-insensitively rather than deleting the upper-case spellings: Windows resolves
  // environment names without regard to case but stores whatever casing was written, so a
  // `set Port=3000` before `penguin web` would survive a `delete env.PORT` and still reach the
  // child as PORT. On POSIX the two are distinct names and only the exact one exists.
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV_KEYS.has(key.toUpperCase())) env[key] = value;
  }
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
    const env = { ...hostEnvForChild(), ...this.vault, ...HARDENED_ENV };
    // Vault entries normally override the host, but terminal hardening is non-overridable.
    // Delete case-insensitively for Windows, where environment names are case-insensitive.
    for (const key of Object.keys(env)) {
      const normalized = key.toUpperCase();
      if (normalized === "FORCE_COLOR" || normalized === "FORCE_COLORS") delete env[key];
    }
    return new ManagedSession({
      cmd: opts.cmd,
      cwd: opts.cwd,
      // Spread order is priority: vault overrides host variables of the same name, but must
      // come before HARDENED_ENV — the hardening entries (GIT_EDITOR/PAGER etc. that prevent
      // interactive hangs) must never be overridable by vault. The host side is stripped of
      // the harness's own variables first (see STRIPPED_ENV_KEYS); the vault still wins, so a
      // user who genuinely wants PORT in commands can set it there.
      env,
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
