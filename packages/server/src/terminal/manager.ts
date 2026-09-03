/**
 * Terminal registry: create / look up / list / kill, plus the lifetime rules.
 *
 * Ownership is per user, not per project: a shell runs as the OS account hosting the server
 * and can read and write everything that account can, so it is not a project-scoped
 * resource and must never be reachable by another account.
 *
 * Two lifetime rules matter:
 * - A session that has exited is kept for a short grace period instead of being dropped, so
 *   a reload right after `exit` still shows the final screen.
 * - A live session is *not* tied to any connection. Closing the tab leaves the shell (and
 *   whatever it is running) alive — that is the entire point of a server-side terminal.
 */
import fsp from "node:fs/promises";
import type { Resources, Opaque, ClassCtx, Json } from "@prismshadow/penguin-core/kernel";
import path from "node:path";
import { HttpError } from "../http/errors.js";
import { spawnHelperHint } from "./spawn-helper.js";
import {
  TerminalSession,
  expandHomePath,
  type CreateTerminalSessionOptions,
  type TerminalSessionInfo,
} from "./session.js";
import { Interface, Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hono } from "hono";
import { Hmr } from "../hmr/host.js";
import { ResourceGroups } from "../hmr/platform.js";
import { RuntimeModule } from "../hmr/capabilities.js";
import { terminalRoutes } from "./routes.js";
import { identityFrom } from "./identity.js";
import type { AuthService } from "../auth/service.js";

/** How long an exited session stays listable/attachable before it is disposed. */
export const EXITED_SESSION_GRACE_MS = 5 * 60 * 1000;
/** Cap per user; a runaway UI loop would otherwise fork shells until the box gives up. */
export const MAX_TERMINALS_PER_USER = 12;

export interface CreateTerminalRequest {
  cwd: string;
  ownerUserId: string;
  name?: string;
  cols?: number;
  rows?: number;
  shell?: string;
}

export class TerminalManager {
  /**
   * The kernel's resource registry, threaded to every session it creates: a native module
   * reaches the platform through it (pty-module.ts), and live ptys are registered in it so
   * a hot swap hands them to the next platform instead of killing them.
   */
  constructor(
    private readonly resources: Resources,
    private readonly opts: {
      graceMs?: number;
      /** Where a pushed bundle's node-pty assets live (hmr.assetsDir); absent falls back to the packaged require. */
      assets?: () => string | null;
    } = {},
  ) {}

  private get graceMs(): number {
    return this.opts.graceMs ?? EXITED_SESSION_GRACE_MS;
  }

  private readonly sessions = new Map<string, TerminalSession>();
  private readonly reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Exit-listener unsubscribers, so quiesce() can detach this manager from delivered ptys. */
  private readonly exitUnsubs = new Set<() => void>();
  /** Paired unregister per pty (register's return): the only way an entry leaves the registry. */
  private readonly unregisters = new Map<string, () => void>();

  async create(request: CreateTerminalRequest): Promise<TerminalSession> {
    const cwd = await resolveCwd(request.cwd);

    const owned = this.list(request.ownerUserId).filter((session) => session.alive);
    if (owned.length >= MAX_TERMINALS_PER_USER) {
      throw new HttpError(
        429,
        "terminal_limit_reached",
        `You already have ${MAX_TERMINALS_PER_USER} open terminals. Close one first.`,
      );
    }

    // Unnamed terminals auto-increment per user ("tmp", "tmp 2", …): several shells in
    // the same directory would otherwise be indistinguishable in every list.
    let name = request.name;
    if (name === undefined) {
      const base = path.basename(cwd) || "terminal";
      const taken = new Set(owned.map((session) => session.info().name));
      name = base;
      for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
    }

    // Stable display number: smallest free among the user's live terminals, and it stays
    // with this terminal for life. (Positional numbering would renumber tabs on every
    // reorder — a dragged tab must keep its number so the user can see where it went.)
    const usedSeqs = new Set(owned.map((session) => session.seq));
    let seq = 1;
    while (usedSeqs.has(seq)) seq += 1;

    const options: CreateTerminalSessionOptions = {
      cwd,
      ownerUserId: request.ownerUserId,
      seq,
      name,
      ...(this.opts.assets !== undefined ? { assets: this.opts.assets } : {}),
      ...(request.cols !== undefined ? { cols: request.cols } : {}),
      ...(request.rows !== undefined ? { rows: request.rows } : {}),
      ...(request.shell !== undefined ? { shell: request.shell } : {}),
    };

    let session: TerminalSession;
    try {
      session = new TerminalSession(options);
    } catch (err) {
      // A bare "posix_spawnp failed." says nothing; when the cause is node-pty's
      // non-executable spawn-helper, name the file and the fix.
      const hint = spawnHelperHint();
      throw new HttpError(
        500,
        "terminal_spawn_failed",
        `Could not start a shell: ${err instanceof Error ? err.message : String(err)}` +
          (hint === null ? "" : ` (${hint})`),
      );
    }

    this.track(session);
    return session;
  }

  /**
   * Takes a session into this manager AND into the runtime's resource registry. The
   * registry is what makes a pty outlive a platform swap: it sits outside the reloadable
   * tree, so the shell keeps running and the next instance claims it back (see
   * hmr/resources.ts). The parked context carries only these ids.
   */
  private track(session: TerminalSession): void {
    this.sessions.set(session.id, session);
    this.exitUnsubs.add(session.onExit(() => this.scheduleReap(session.id)));
    this.unregisters.set(
      session.id,
      this.resources.register(resourceId(session.id), session, () => session.dispose()),
    );
  }

  /**
   * Reclaims the sessions a previous instance parked. An id the registry no longer knows
   * is simply dropped: its shell died with the process that owned it, and a manager
   * holding a handle to nothing would only fail later, further from the cause.
   */
  adopt(ids: readonly string[]): void {
    for (const id of ids) {
      const session = this.resources.claim<TerminalSession>(resourceId(id));
      if (session === undefined) continue;
      this.sessions.set(session.id, session);
      this.exitUnsubs.add(session.onExit(() => this.scheduleReap(session.id)));
      // Re-register under THIS generation: the overwrite retires the previous owner's
      // paired unregister (it no-ops from now on), and ours becomes the live one — the
      // registry's ownership rule, applied to adoption.
      this.unregisters.set(
        session.id,
        this.resources.register(resourceId(session.id), session, () => session.dispose()),
      );
      // Died during the swap freeze: its exit fired into the PREVIOUS generation (whose
      // listeners are detached by then), so this listener will never fire — reap it here
      // or nobody ever releases its registry entry.
      if (!session.alive) this.scheduleReap(session.id);
    }
  }

  /**
   * Park-side detach (hot swap only — never process exit): the ptys are DELIVERED to the
   * next App through the registry, so this manager must stop acting on them. Exit
   * listeners are unsubscribed (the successor adopts and re-listens), and every pending
   * reap — each targeting an already-dead session that was therefore NOT parked for
   * adoption — runs immediately instead of firing later from a dead generation, where it
   * would release a registry id out from under whoever owns it next.
   */
  quiesce(): void {
    for (const unsub of this.exitUnsubs) unsub();
    this.exitUnsubs.clear();
    for (const [id, timer] of this.reapTimers) {
      clearTimeout(timer);
      this.sessions.delete(id);
      // Unregister disposes as it removes — one call, paired and identity-safe.
      this.unregisters.get(id)?.();
      this.unregisters.delete(id);
    }
    this.reapTimers.clear();
  }

  /** Handle ids for the parked context document — live sessions only. */
  handleIds(): string[] {
    return [...this.sessions.values()].filter((s) => s.alive).map((s) => s.id);
  }

  /** Looks up a session, enforcing ownership. Unknown and not-yours are both 404 — no probing. */
  require(id: string, userId: string): TerminalSession {
    const session = this.sessions.get(id);
    if (!session || session.ownerUserId !== userId) {
      throw new HttpError(404, "terminal_not_found", "Terminal does not exist or has been closed.");
    }
    return session;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  list(userId: string): TerminalSession[] {
    return [...this.sessions.values()]
      .filter((session) => session.ownerUserId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  listInfo(userId: string): TerminalSessionInfo[] {
    return this.list(userId).map((session) => session.info());
  }

  kill(id: string, userId: string): void {
    const session = this.require(id, userId);
    session.kill();
    this.scheduleReap(id, 2000);
  }

  /** Drops the session once nothing can usefully be read from it any more. */
  private scheduleReap(id: string, delayMs = this.graceMs): void {
    const existing = this.reapTimers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.reapTimers.delete(id);
      this.sessions.delete(id);
      // The paired unregister both removes the entry and disposes the session ("out of
      // the registry means shut down"), and only ever acts on our own registration — a
      // reap can never touch an entry a successor re-registered.
      this.unregisters.get(id)?.();
      this.unregisters.delete(id);
    }, delayMs);
    timer.unref?.();
    this.reapTimers.set(id, timer);
  }

  /** Server shutdown: every pty is a child process and must not outlive us. */
  disposeAll(): void {
    for (const timer of this.reapTimers.values()) clearTimeout(timer);
    this.reapTimers.clear();
    for (const session of this.sessions.values()) session.dispose();
    this.sessions.clear();
  }
}

/** Expands `~`, requires an absolute path, and verifies it is a readable directory. */
async function resolveCwd(input: string): Promise<string> {
  const expanded = expandHomePath((input ?? "").trim() || "~");
  // A relative path would silently resolve against the *server process* cwd — never what
  // the caller meant, and it leaks where the server was started from.
  if (!path.isAbsolute(expanded)) {
    throw new HttpError(400, "cwd_not_absolute", `Working directory must be absolute: ${expanded}`);
  }
  let real: string;
  try {
    real = await fsp.realpath(expanded);
  } catch {
    throw new HttpError(400, "cwd_not_found", `Directory does not exist: ${expanded}`);
  }
  const stat = await fsp.stat(real);
  if (!stat.isDirectory()) {
    throw new HttpError(400, "cwd_not_a_dir", `Not a directory: ${real}`);
  }
  return real;
}

/** Registry key for a session's live pty (namespaced so kinds cannot collide). */
function resourceId(sessionId: string): string {
  return `terminal:${sessionId}`;
}

/** A live pty: a host-like object (it owns a process), compared by name. */
export type Terminal = Opaque<"TerminalSession", TerminalSession>;

/** Live ptys: the spawn primitive behind /api/terminals and the terminal WebSocket. */
export abstract class Terminals extends Interface<{
  create(request: CreateTerminalRequest): Promise<Terminal>;
  adopt(ids: readonly string[]): void;
  quiesce(): void;
  handleIds(): string[];
  require(id: string, userId: string): Terminal;
  get(id: string): Terminal | undefined;
  list(userId: string): Terminal[];
  listInfo(userId: string): TerminalSessionInfo[];
  kill(id: string, userId: string): void;
  disposeAll(): void;
}>() {}

/** The manager satisfies the contract; this keeps the two from drifting. */
export type _Check = TerminalManager extends Terminals ? true : never;

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "TerminalModule.routes",
        prefix: "/",
        auth: "none",
        order: 0,
      },
    ],
  },
  context: {
    version: 1,
    schema: {
      "terminals?": "string[]",
    },
  },
})
export class TerminalModule {
  @Use(RuntimeModule) private readonly hmr!: Hmr;
  @Use(RuntimeModule) private readonly resourceGroups!: ResourceGroups;
  @Use() private readonly auth!: AuthService;
  @Provide() terminals!: Terminals;
  @Bind("TerminalModule.routes") routes!: ReturnType<typeof terminalRoutes>;
  setup({ resources, effect }: ClassCtx, context: Json) {
    const terminals = new TerminalManager(resources, {
      // A pushed bundle's node-pty binaries live where the host materialized them.
      assets: () => this.hmr.assetsDir() ?? null,
    });
    // Shells started before this App existed are still running in the registry: claim
    // them back so a push is invisible to whoever was typing in one — unless their group
    // is doomed, in which case this build cannot speak the contract behind those handles.
    const parked = (context as { terminals?: string[] } | null)?.terminals ?? [];
    terminals.adopt(this.resourceGroups.adoptable("TerminalModule") ? parked : []);
    // Deliberately NOT disposing the terminals at swap: the shells are resources, and
    // outliving a swap is the whole point. Only the reap timers stop with this App.
    effect(() => terminals.quiesce());
    this.terminals = terminals;
    this.routes = terminalRoutes(terminals, identityFrom(this.auth));
  }

  park(): Json {
    return { terminals: this.terminals.handleIds() };
  }
}
