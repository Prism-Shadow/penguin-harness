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
import type { Resources } from "@prismshadow/penguin-core/kernel";
import path from "node:path";
import { HttpError } from "../../http/errors.js";
import { spawnHelperHint } from "../../terminal/spawn-helper.js";
import {
  TerminalSession,
  expandHomePath,
  type CreateTerminalSessionOptions,
  type TerminalSessionInfo,
} from "./session.js";

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
    private readonly graceMs: number = EXITED_SESSION_GRACE_MS,
  ) {}

  private readonly sessions = new Map<string, TerminalSession>();
  private readonly reapTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
      resources: this.resources,
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

    this.sessions.set(session.id, session);
    session.onExit(() => this.scheduleReap(session.id));
    return session;
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
      this.sessions.get(id)?.dispose();
      this.sessions.delete(id);
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
