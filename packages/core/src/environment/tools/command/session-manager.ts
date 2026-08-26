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
import { statSync } from "node:fs";
import { ManagedSession } from "./session.js";
import { BackgroundRegistry } from "../background/index.js";
import type { ProxyEnvPolicy } from "../../../interfaces/index.js";

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
 * Variables **removed** from the child environment (removed, not blanked: a program that
 * checks `PORT` for presence rather than value must see nothing at all).
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
 * `FORCE_COLOR` / `CLICOLOR_FORCE` are color-forcing overrides that Node (and the chalk-family
 * libraries) deliberately let defeat `NO_COLOR`, so an inherited value would cancel the
 * `NO_COLOR=1` + `TERM=dumb` hardening above and leak ANSI escapes into tool output (#102).
 * Removal, not blanking, matters here too: Node reads an *empty* `FORCE_COLOR` as "force 16
 * colors on". The vault still wins, so a user who genuinely wants forced color in commands can
 * set it there.
 *
 * Every `PENGUIN_*` variable is removed as well — see {@link HARNESS_ENV_PREFIX}. That covers
 * `PENGUIN_HOME` and `PENGUIN_WEB_DB`, which select the *data* an Agent-started harness works
 * against. They were once left inheriting on the grounds that the self-development case may
 * legitimately want the same data root, but inheriting them is not that decision being made — it
 * is an accident of where this process happens to be running. Whenever an Agent spawns a command
 * the harness is by definition up, holding `<root>/server.lock`, so an Agent-started server on the
 * inherited root cannot start at all; it exits 3 against a lock whose owner is the very process
 * that handed it the root.
 *
 * Any of it really wanted is asked for rather than inherited: the vault is applied after this
 * environment (see the spread in `spawn`), so a `PENGUIN_HOME` set there reaches commands exactly
 * as before. Same escape hatch as `FORCE_COLOR` above.
 */
const STRIPPED_ENV_KEYS = new Set([
  "PORT",
  "HOST",
  "PENGUIN_CLI_ENTRY",
  "PENGUIN_WEB_DIST",
  "FORCE_COLOR",
  "CLICOLOR_FORCE",
  // Desktop-mode process credentials and wiring: the shell's token authorizes the
  // server shutdown endpoint (and desktop-login until redeemed), and the port file is
  // the shell's private channel — neither is a user-facing setting, and leaking them
  // into Agent-run commands would let a prompt-injected command stop the server.
  "PENGUIN_DESKTOP_TOKEN",
  "PENGUIN_PORT_FILE",
  // Pinned seed password (tests/e2e): a credential, not a data-selection setting.
  "PENGUIN_SEED_ADMIN_PASSWORD",
]);

/**
 * Every variable named `PENGUIN_*` is this installation's own configuration — where its data
 * lives, which shell it resolved, which release feed it checks, which language its UI speaks —
 * and none of it describes the command an Agent is running. Stripping by prefix rather than by
 * name is the point: the harness reads two dozen of them today and gains more with each feature,
 * and a list has to be remembered at exactly the moment nobody is thinking about it. Twenty-five
 * existed when this was written and a by-name list had caught seven.
 *
 * Outbound proxy settings are the deliberate exception to "the harness's environment stays out of
 * the child", and they are not `PENGUIN_*` — they are HTTP_PROXY and friends, governed by
 * {@link PROXY_ENV_KEYS} and the host's policy just below. `PENGUIN_TRUST_PROXY` only looks like
 * one: it decides whether the server trusts an inbound `x-forwarded-proto`, and means nothing to
 * a child.
 *
 * The vault still wins, so any single variable that is genuinely wanted can be set there.
 */
const HARNESS_ENV_PREFIX = "PENGUIN_";

/**
 * Proxy variables removed IN ADDITION when the host supplies a proxy policy (`proxyEnv`,
 * see {@link CommandSessionManager}): the Web server's proxy settings must keep commands
 * from just inheriting the serving process's proxy environment.
 * In `strip` mode NO_PROXY is deliberately NOT removed — with no proxy variables left it
 * is inert, and removing it would change behavior for commands that set their own proxy.
 * In `inject` mode the inherited NO_PROXY is replaced too (the policy carries the merged
 * list), and ALL_PROXY stays removed rather than replaced: the explicit app-level proxy
 * outranks ambient env wholesale. Matched case-insensitively like
 * {@link STRIPPED_ENV_KEYS}, which also covers the conventional lowercase spellings
 * (http_proxy etc.).
 */
const PROXY_ENV_KEYS = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]);

/**
 * The host environment minus {@link STRIPPED_ENV_KEYS}, with the proxy policy applied:
 * `strip` removes {@link PROXY_ENV_KEYS}; `inject` additionally replaces NO_PROXY and
 * sets the explicit proxy variables (both spellings — programs disagree on which they
 * read); null passes the proxy variables through untouched.
 */
function hostEnvForChild(policy: ProxyEnvPolicy | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Matched case-insensitively rather than deleting the upper-case spellings: Windows resolves
  // environment names without regard to case but stores whatever casing was written, so a
  // `set Port=3000` before `penguin web` would survive a `delete env.PORT` and still reach the
  // child as PORT. On POSIX the two are distinct names and only the exact one exists.
  for (const [key, value] of Object.entries(process.env)) {
    const name = key.toUpperCase();
    if (STRIPPED_ENV_KEYS.has(name) || name.startsWith(HARNESS_ENV_PREFIX)) continue;
    if (policy !== null && PROXY_ENV_KEYS.has(name)) continue;
    if (policy?.mode === "inject" && name === "NO_PROXY") continue;
    env[key] = value;
  }
  if (policy?.mode === "inject") {
    env.HTTP_PROXY = policy.url;
    env.http_proxy = policy.url;
    env.HTTPS_PROXY = policy.url;
    env.https_proxy = policy.url;
    env.NO_PROXY = policy.noProxy;
    env.no_proxy = policy.noProxy;
  }
  return env;
}

/**
 * Rejects a working directory that cannot be spawned into, before the spawn.
 *
 * Node reports a missing or unusable `cwd` as `spawn <shell> ENOENT` — the error names the
 * COMMAND, not the directory, so a Workspace that has been deleted or moved reads exactly
 * like a missing shell and sends the reader hunting for a `bash` that was there all along.
 * The directory is therefore checked here, where the real reason can still be named.
 *
 * Never auto-created: Agent.createSession and the server's Workspace guard both refuse to
 * create a Workspace so a typo cannot silently start working in the wrong place, and a
 * directory that disappeared under a live Session is a fact to report rather than paper over.
 */
function assertUsableCwd(cwd: string): void {
  let stat;
  try {
    stat = statSync(cwd);
  } catch {
    throw new Error(
      `working directory does not exist: ${cwd}. That is the Session's Workspace unless a workdir was given — restore the directory, or run the command somewhere that exists.`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`working directory is not a directory: ${cwd}.`);
  }
}

export class CommandSessionManager {
  private readonly registry = new BackgroundRegistry<ManagedSession>({
    idPrefix: "proc",
    maxTasks: MAX_SESSIONS,
  });

  /** Agent vault environment variables: injected into the child process on every spawn (values never enter the model context, only the environment). */
  private readonly vault: Record<string, string>;
  /**
   * Proxy policy for the child environment (see {@link ProxyEnvPolicy}: strip the proxy
   * variables, inject an explicit proxy over the inherited ones, or null = pass
   * through). A getter rather than a snapshot: the hosting server's proxy settings
   * change at runtime, and re-reading at every spawn makes a change reach Sessions that
   * are already running. Absent = pass through (SDK/CLI standalone use).
   */
  private readonly proxyEnv: (() => ProxyEnvPolicy | null) | undefined;
  /**
   * Harness-control variables (PENGUIN_API_URL / PENGUIN_API_TOKEN / the Session
   * coordinates, see {@link EnvironmentConfig.controlEnv}): injected on every spawn AFTER
   * the vault, so the host's sanctioned wiring wins over a vault entry of the same name.
   * A getter like `proxyEnv`, re-read at every spawn. Absent = nothing injected.
   */
  private readonly controlEnv: (() => Record<string, string>) | undefined;

  constructor(opts?: {
    vault?: Record<string, string>;
    proxyEnv?: () => ProxyEnvPolicy | null;
    controlEnv?: () => Record<string, string>;
  }) {
    this.vault = opts?.vault ?? {};
    this.proxyEnv = opts?.proxyEnv;
    this.controlEnv = opts?.controlEnv;
  }

  /** Starts a command, returning an **unregistered** session (no process_id yet). */
  spawn(opts: { cmd: string; cwd: string }): ManagedSession {
    if (this.registry.isDisposed) {
      throw new Error("command session manager disposed");
    }
    assertUsableCwd(opts.cwd);
    return new ManagedSession({
      cmd: opts.cmd,
      cwd: opts.cwd,
      // Spread order is priority: vault overrides host variables of the same name; the
      // host's control variables (controlEnv) override the vault — they are the hosting
      // server's own wiring (API URL/token, Session coordinates) and a vault entry must
      // not silently point commands at another server; and HARDENED_ENV comes last — the
      // hardening entries (GIT_EDITOR/PAGER etc. that prevent interactive hangs) are never
      // overridable by anything. The host side is stripped of the harness's own variables
      // first (see STRIPPED_ENV_KEYS) and has the proxyEnv policy applied (strip or
      // inject); the vault still wins over the host env — over an injected proxy too — so
      // a user who genuinely wants PORT, or their own proxy, in commands can set it there.
      //
      // The strip governs inheritance only: it runs inside hostEnvForChild and never
      // re-applies to entries spread in after it, so the vault and controlEnv carry
      // authoritative values into the child — stripped names, PENGUIN_* included, and all.
      // Both guarantees hold because of that order: no PENGUIN_* reaches a command by
      // inheritance, while the control variables the host does sanction arrive as injected
      // values rather than as surviving copies. Pinned by the "an explicit injection
      // layered after the strip wins" test.
      env: {
        ...hostEnvForChild(this.proxyEnv?.() ?? null),
        ...this.vault,
        ...(this.controlEnv?.() ?? {}),
        ...HARDENED_ENV,
      },
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

  /** Snapshot of the registered background command sessions (id + session), registration order. */
  list(): Array<{ processId: string; session: ManagedSession }> {
    return this.registry.list().map(({ id, task }) => ({ processId: id, session: task }));
  }

  /** Kills a background process by id (SIGTERM→SIGKILL on the whole group) and drops it from the registry; false when the id is unknown. */
  kill(processId: string): boolean {
    if (this.registry.get(processId) === undefined) return false;
    this.registry.remove(processId);
    return true;
  }

  /** Disposes: removes the fallback registration and kills all sessions (the process 'exit' fallback is hooked up by the registry itself). Idempotent. */
  dispose(): void {
    this.registry.dispose();
  }
}
