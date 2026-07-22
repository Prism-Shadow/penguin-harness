/**
 * Session index service.
 *
 * The list is DB index ∪ Trace directory discovery: scans
 * `<agent>/traces/<date>/<session_id>_<index3>.jsonl`; an unmanaged Session (e.g.
 * one started via the CLI) has its first line's session_meta read for
 * (provider, model_id) / workspace, which is backfilled into a DB row
 * (approval_mode defaults, createdAt is taken from the timestamp embedded in
 * session_id).
 * Create: via core's `agent.createSession` (the model reference is always a complete
 * (provider, modelId) pair — both or neither; omitting both falls back to the
 * Project's default reference, 400 if there is none); the new Session is
 * added to session-manager's active table (state idle).
 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  createAgent,
  isSessionMeta,
  readTraceTolerant,
  tracesDir,
} from "@prismshadow/penguin-core";
import type { SessionMetaMessage } from "@prismshadow/penguin-core";
import type { ApprovalMode, SessionInfo, SessionSource } from "../api/types.js";
import { HttpError, isMissingCredential, modelCredentialMissing } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { SessionRow, SessionsRepo } from "../db/repos/sessions.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { asSessionSource } from "../runtime/session-sources.js";
import type { SessionSources } from "../runtime/session-sources.js";
import type { ProjectConfigService } from "./project-config-service.js";

const TRACE_FILE_RE = /^(.+)_(\d{3})\.jsonl$/;
const SESSION_ID_TS_RE = /^session-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-[0-9a-f]{8}$/;

/** Derives creation time from the local timestamp embedded in session_id; returns null if it doesn't match. */
export function sessionIdCreatedAt(sessionId: string): string | null {
  const m = SESSION_ID_TS_RE.exec(sessionId);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface SessionServiceDeps {
  root: string;
  sessions: SessionsRepo;
  manager: SessionManager;
  projectConfig: ProjectConfigService;
  /** In-process origin registry derived from session_meta (the DB stores no source column). */
  sources: SessionSources;
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  /**
   * DB row -> SessionInfo (run status and pending approval count come from session-manager).
   * Async because `source` is derived from session_meta: a registry miss (Session predating
   * this process) falls back to reading the Trace head once (see sourceOf).
   */
  async toInfo(row: SessionRow, hasTrace: boolean): Promise<SessionInfo> {
    const source = await this.sourceOf(row, hasTrace);
    return {
      sessionId: row.sessionId,
      projectId: row.projectId,
      agentId: row.agentId,
      provider: row.provider,
      modelId: row.modelId,
      workspace: row.workspace,
      approvalMode: row.approvalMode,
      ...(row.title !== null ? { title: row.title } : {}),
      ...(source !== undefined ? { source } : {}),
      createdAt: row.createdAt,
      status: this.deps.manager.statusOf(row.sessionId),
      pendingApprovalCount: this.deps.manager.pendingApprovalCount(row.sessionId),
      hasTrace,
      archived: (row.archivedAt ?? null) !== null,
    };
  }

  /**
   * A Session's origin, with session_meta as the single source of truth: the in-process
   * registry answers first (populated at creation / subagent registration / adoption);
   * on a miss (a Session created before this process started) the earliest Trace shard's
   * session_meta is read once and cached. A Session with no Trace yet stays unknown and
   * is NOT cached negatively — its meta may appear with the first run.
   */
  private async sourceOf(row: SessionRow, hasTrace: boolean): Promise<SessionSource | undefined> {
    const known = this.deps.sources.get(row.sessionId);
    if (known !== undefined) return known ?? undefined;
    if (!hasTrace) return undefined;
    const meta = await this.readTraceMeta(row.projectId, row.agentId, row.sessionId);
    if (!meta) return undefined; // Unreadable/corrupt Trace: stay unknown, retry on the next list.
    // On-disk values are untrusted: only the exact known origins pass, junk = user-created.
    const source = asSessionSource(meta.payload.source) ?? null;
    this.deps.sources.set(row.sessionId, source);
    return source ?? undefined;
  }

  /** Whether this Session already has a Trace record (a Task has been run). */
  async hasTrace(row: SessionRow): Promise<boolean> {
    const ids = await this.discoverTraceSessionIds(row.projectId, row.agentId);
    return ids.has(row.sessionId);
  }

  /**
   * List: DB ∪ Trace directory discovery, sorted by createdAt descending. Optional
   * `paging` returns just that slice (the sidebar pages with limit+1 to detect "has
   * more"); slicing happens before toInfo, so per-request source derivation (lazy
   * Trace-head reads) stays bounded by the page size. Discovery/adoption still scans
   * the whole directory — the union and global ordering need every id.
   */
  async listSessions(
    projectId: string,
    agentId: string,
    paging?: { offset: number; limit: number },
  ): Promise<SessionInfo[]> {
    const traceIds = await this.discoverTraceSessionIds(projectId, agentId);
    const rows = new Map(
      this.deps.sessions.listByAgent(projectId, agentId).map((r) => [r.sessionId, r]),
    );

    // Unmanaged Trace Sessions: backfill an index row by reading the first line's session_meta.
    for (const sessionId of traceIds) {
      if (rows.has(sessionId)) continue;
      const discovered = await this.adoptTraceSession(projectId, agentId, sessionId);
      if (discovered) rows.set(sessionId, discovered);
    }

    const sorted = [...rows.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
    );
    const page = paging ? sorted.slice(paging.offset, paging.offset + paging.limit) : sorted;
    return Promise.all(page.map((row) => this.toInfo(row, traceIds.has(row.sessionId))));
  }

  /**
   * Session stats (Agents list card): total count = size of the union of DB index
   * ∪ Trace directory discovery; activity = number of active Sessions per day over
   * the last `days` days (deduplicated count of Sessions created that day or with a
   * Trace record that day; index 0 = earliest, last index = today). Counts only —
   * does not backfill index rows.
   */
  async sessionStats(
    projectId: string,
    agentId: string,
    days: number,
  ): Promise<{ sessionCount: number; activity: number[] }> {
    const all = new Set<string>();
    const byDate = new Map<string, Set<string>>();
    const mark = (date: string, sessionId: string): void => {
      all.add(sessionId);
      const set = byDate.get(date) ?? new Set<string>();
      set.add(sessionId);
      byDate.set(date, set);
    };

    // Trace directory: the date directory name is the local date (yyyy-mm-dd) that core uses when writing to disk.
    const dir = tracesDir(this.deps.root, projectId, agentId);
    for (const dateDir of await listDirsSafe(dir)) {
      for (const file of await listFilesSafe(path.join(dir, dateDir))) {
        const match = TRACE_FILE_RE.exec(file);
        if (match) mark(dateDir, match[1]!);
      }
    }
    // DB index: the creation day also counts as active (a Session that hasn't run a Task yet produces no Trace).
    for (const row of this.deps.sessions.listByAgent(projectId, agentId)) {
      const created = new Date(row.createdAt);
      if (Number.isNaN(created.getTime())) all.add(row.sessionId);
      else mark(localDate(created), row.sessionId);
    }

    const activity: number[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      activity.push(byDate.get(localDate(d))?.size ?? 0);
    }
    return { sessionCount: all.size, activity };
  }

  /**
   * Create a Session: the model reference is a complete `(provider, modelId)` pair.
   * Half a reference is a client error, never something to resolve — the missing half
   * is never guessed, since a guessed provider would send an entry's credential to a
   * vendor nobody named. Omitting both falls back to the Project's default reference
   * (400 prompting to configure a model first if there is none). `workspace` is already
   * validated by the route guard. The new Session is added to the active table
   * (idle).
   */
  async createSession(args: {
    projectId: string;
    agentId: string;
    /** Upstream id of the session's model; always paired with provider. Omit both for the Project's default reference. */
    modelId?: string;
    /** The provider group for `modelId`; always paired with modelId, never inferred. */
    provider?: string;
    workspace?: string;
    approvalMode?: ApprovalMode;
    /** Session source marker (schedule when triggered by a scheduled task; defaults to user-created). */
    source?: "schedule";
  }): Promise<SessionInfo> {
    if ((args.modelId === undefined) !== (args.provider === undefined)) {
      throw badRequest(
        "modelId and provider must be given together as a (provider, modelId) pair: specify both, or neither to use the Project's default model.",
      );
    }
    let modelId: string;
    let provider: string;
    if (args.modelId !== undefined && args.provider !== undefined) {
      modelId = args.modelId;
      provider = args.provider;
    } else {
      // The guard above leaves only "both omitted" here: fall back to the Project default.
      const def = await this.deps.projectConfig.getDefaultModelRef(args.projectId);
      if (def === undefined) {
        throw new HttpError(
          400,
          "no_default_model",
          "This Project has no default model yet. Add a model on the Models page and set it as the default first.",
        );
      }
      modelId = def.model_id;
      provider = def.provider;
    }
    const agent = await createAgent({
      root: this.deps.root,
      projectId: args.projectId,
      agentId: args.agentId,
    });
    let session;
    try {
      session = await agent.createSession({
        modelId,
        provider,
        ...(args.workspace !== undefined ? { workspaceDir: args.workspace } : {}),
        // The origin is also recorded in core session_meta (Trace), not just the index row.
        ...(args.source !== undefined ? { source: args.source } : {}),
      });
    } catch (err) {
      // A missing credential is its own category (the frontend shows localized text
      // by code); other core errors (the pair naming no configured entry, Workspace
      // not existing, etc.) are collapsed to 400 — the guard already blocks most cases.
      if (isMissingCredential(err)) throw modelCredentialMissing(modelId);
      throw new HttpError(
        400,
        "session_create_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    // The origin is derived from the just-created core Session's session_meta (the single
    // source of truth) rather than echoing args.source back: what the registry serves is
    // exactly what the Trace will record.
    const metaMsg = session.metaMessage;
    this.deps.sources.set(
      session.sessionId,
      isSessionMeta(metaMsg) ? (asSessionSource(metaMsg.payload.source) ?? null) : null,
    );
    const row: SessionRow = {
      sessionId: session.sessionId,
      projectId: args.projectId,
      agentId: args.agentId,
      provider: session.provider,
      modelId: session.modelId,
      workspace: session.workspaceDir,
      approvalMode: args.approvalMode ?? "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
    };
    this.deps.sessions.insert(row);
    this.deps.manager.adopt(row, session);
    return this.toInfo(row, false);
  }

  /** Scans the Trace directory to get the set of session_ids with records. */
  private async discoverTraceSessionIds(projectId: string, agentId: string): Promise<Set<string>> {
    const dir = tracesDir(this.deps.root, projectId, agentId);
    const ids = new Set<string>();
    for (const dateDir of await listDirsSafe(dir)) {
      for (const file of await listFilesSafe(path.join(dir, dateDir))) {
        const match = TRACE_FILE_RE.exec(file);
        if (match) ids.add(match[1]!);
      }
    }
    return ids;
  }

  /**
   * session_meta from the earliest Trace shard of a Session (the shard whose head carries
   * the original meta); null when there is no readable Trace or it has no meta. Shared by
   * adoption backfill and lazy `source` resolution.
   */
  private async readTraceMeta(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<SessionMetaMessage | null> {
    const dir = tracesDir(this.deps.root, projectId, agentId);
    let earliest: { path: string; index: number } | null = null;
    for (const dateDir of await listDirsSafe(dir)) {
      for (const file of await listFilesSafe(path.join(dir, dateDir))) {
        const match = TRACE_FILE_RE.exec(file);
        if (!match || match[1] !== sessionId) continue;
        const index = Number(match[2]);
        if (!earliest || index < earliest.index) {
          earliest = { path: path.join(dir, dateDir, file), index };
        }
      }
    }
    if (!earliest) return null;
    let messages;
    try {
      messages = await readTraceTolerant(earliest.path);
    } catch {
      return null; // Corrupt file: skip (does not block the list)
    }
    return messages.find(isSessionMeta) ?? null;
  }

  /** Adopts a Session that exists only in the Trace directory: reads session_meta from the first line of the earliest index file. */
  private async adoptTraceSession(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): Promise<SessionRow | null> {
    const meta = await this.readTraceMeta(projectId, agentId, sessionId);
    if (!meta) return null;
    // An older Trace version's session_meta lacks provider (the model reference
    // wasn't split into separate fields yet): no backward compat, skip adoption
    // (core will give a clear error on resume; the product hasn't launched yet, so
    // old data can simply be deleted and recreated).
    if (typeof meta.payload.provider !== "string") return null;
    // The adoption read already has the meta in hand: record the origin (single source of
    // truth); on-disk values are narrowed — junk counts as user-created.
    this.deps.sources.set(sessionId, asSessionSource(meta.payload.source) ?? null);
    const row: SessionRow = {
      sessionId,
      projectId,
      agentId,
      provider: meta.payload.provider,
      modelId: meta.payload.model_id,
      workspace: meta.payload.workspace,
      // The approval mode for an unmanaged Session (started via the CLI) isn't in the Trace, so it's backfilled with the default value.
      approvalMode: "allow-all",
      title: null,
      createdAt: sessionIdCreatedAt(sessionId) ?? meta.timestamp,
    };
    // Idempotent backfill: concurrent list calls may discover the same Session for the first time simultaneously (consistent with AgentsRepo's convention).
    this.deps.sessions.insertOrIgnore(row);
    return row;
  }
}

/** Local date as yyyy-mm-dd (matches the Trace date directory convention: core's internal formatLocalDate, not publicly exported). */
function localDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function listDirsSafe(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFilesSafe(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}
