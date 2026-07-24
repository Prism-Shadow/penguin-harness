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
import { open, readdir } from "node:fs/promises";
import {
  createAgent,
  isSessionMeta,
  parseTraceLines,
  readTraceTolerant,
  tracesDir,
} from "@prismshadow/penguin-core";
import type { SessionMetaMessage } from "@prismshadow/penguin-core";
import type {
  ApprovalMode,
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
  SessionSource,
} from "../api/types.js";
import { HttpError, isMissingCredential, modelCredentialMissing } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { SessionRow, SessionsRepo } from "../db/repos/sessions.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { asSessionSource } from "../runtime/session-sources.js";
import type { SessionSources } from "../runtime/session-sources.js";
import type { ProjectConfigService } from "./project-config-service.js";

const TRACE_FILE_RE = /^(.+)_(\d{3})\.jsonl$/;
const SESSION_ID_TS_RE = /^session-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-[0-9a-f]{8}$/;

/** Head window for session_meta reads: generous for a long system prompt, far below a whole multi-MB shard. */
const TRACE_HEAD_BYTES = 256 * 1024;

/**
 * Parse a Trace file's head window only. session_meta is the first line core writes to
 * every shard, so a bounded read finds it without pulling the whole file into memory —
 * category filtering / counts may need every Session's source in a single request.
 * The window is cut at its last newline (the tail fragment is incomplete); a first line
 * larger than the whole window falls back to the full tolerant read.
 */
async function readTraceHead(filePath: string) {
  const fh = await open(filePath, "r");
  let text: string;
  let truncated: boolean;
  try {
    // allocUnsafe: only subarray(0, bytesRead) is ever read, so the uninitialized tail never leaks.
    const { buffer, bytesRead } = await fh.read(
      Buffer.allocUnsafe(TRACE_HEAD_BYTES),
      0,
      TRACE_HEAD_BYTES,
      0,
    );
    text = buffer.subarray(0, bytesRead).toString("utf8");
    truncated = bytesRead === TRACE_HEAD_BYTES;
  } finally {
    await fh.close();
  }
  if (!truncated) return parseTraceLines(text);
  const nl = text.lastIndexOf("\n");
  if (nl === -1) return readTraceTolerant(filePath);
  return parseTraceLines(text.slice(0, nl + 1));
}

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
   * this process) falls back to reading the Trace head once (see sourceOf). `traces` is the
   * list flow's one-walk discovery result; without it a miss locates the shard itself.
   */
  async toInfo(
    row: SessionRow,
    hasTrace: boolean,
    traces?: ReadonlyMap<string, TraceLocation>,
  ): Promise<SessionInfo> {
    const source = await this.sourceOf(row, hasTrace, traces);
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
  private async sourceOf(
    row: SessionRow,
    hasTrace: boolean,
    traces?: ReadonlyMap<string, TraceLocation>,
  ): Promise<SessionSource | undefined> {
    const known = this.deps.sources.get(row.sessionId);
    if (known !== undefined) return known ?? undefined;
    if (!hasTrace) return undefined;
    // Single-session paths carry no discovery map: locate this Session's earliest shard on demand.
    const location =
      traces?.get(row.sessionId) ??
      (await this.discoverTraces(row.projectId, row.agentId)).get(row.sessionId);
    if (!location) return undefined;
    const meta = await this.readTraceMeta(location);
    if (!meta) return undefined; // Unreadable/corrupt Trace: stay unknown, retry on the next list.
    // On-disk values are untrusted: only the exact known origins pass, junk = user-created.
    const source = asSessionSource(meta.payload.source) ?? null;
    this.deps.sources.set(row.sessionId, source);
    return source ?? undefined;
  }

  /** Whether this Session already has a Trace record (a Task has been run). */
  async hasTrace(row: SessionRow): Promise<boolean> {
    return (await this.discoverTraces(row.projectId, row.agentId)).has(row.sessionId);
  }

  /**
   * The list category of a row: archived wins (an explicit user action), then the
   * origin's bucket, and no/unknown source is `active` — the same precedence the
   * sidebar's partition applies to loaded rows, so server filtering and client
   * rendering can never disagree.
   */
  private async categoryOf(
    row: SessionRow,
    hasTrace: boolean,
    traces?: ReadonlyMap<string, TraceLocation>,
  ): Promise<SessionCategory> {
    if ((row.archivedAt ?? null) !== null) return "archived";
    return (await this.sourceOf(row, hasTrace, traces)) ?? "active";
  }

  /**
   * List: DB ∪ Trace directory discovery, sorted by createdAt descending. Optional
   * `paging` returns just that slice (the sidebar pages with limit+1 to detect "has
   * more"); slicing happens before toInfo, so per-request source derivation (lazy
   * Trace-head reads) stays bounded by the page size. Discovery/adoption still scans
   * the whole directory — the union and global ordering need every id.
   *
   * `category` filters to one sidebar bucket **before** paging, so offset/limit page
   * within the category. Filtering needs each walked row's category (a possible
   * Trace-head read per row, cached in the sources registry); without `withCounts`
   * the walk stops as soon as the requested page is complete. `withCounts` classifies
   * every row and returns per-category totals over the whole list — plus the same
   * totals broken down by Workspace path — so the sidebar can label the collapsed
   * folders (and a workspace group can know its own share) without loading them.
   */
  async listSessions(
    projectId: string,
    agentId: string,
    opts: {
      paging?: { offset: number; limit: number };
      category?: SessionCategory;
      withCounts?: boolean;
    } = {},
  ): Promise<{
    sessions: SessionInfo[];
    counts?: SessionCategoryCounts;
    workspaceCounts?: Record<string, SessionCategoryCounts>;
  }> {
    const { paging, category, withCounts } = opts;
    const traces = await this.discoverTraces(projectId, agentId);
    const rows = new Map(
      this.deps.sessions.listByAgent(projectId, agentId).map((r) => [r.sessionId, r]),
    );

    // Unmanaged Trace Sessions: backfill an index row by reading the first line's session_meta.
    for (const [sessionId, location] of traces) {
      if (rows.has(sessionId)) continue;
      const discovered = await this.adoptTraceSession(projectId, agentId, sessionId, location);
      if (discovered) rows.set(sessionId, discovered);
    }

    const sorted = [...rows.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
    );
    const toPage = (page: SessionRow[]) =>
      Promise.all(page.map((row) => this.toInfo(row, traces.has(row.sessionId), traces)));

    // No classification asked for: slice straight away (the pre-category behavior).
    if (category === undefined && !withCounts) {
      return {
        sessions: await toPage(
          paging ? sorted.slice(paging.offset, paging.offset + paging.limit) : sorted,
        ),
      };
    }

    const want = paging ? paging.offset + paging.limit : Infinity;
    const counts: SessionCategoryCounts = { active: 0, subagent: 0, schedule: 0, archived: 0 };
    const workspaceCounts: Record<string, SessionCategoryCounts> = {};
    const matched: SessionRow[] = [];
    for (const row of sorted) {
      if (!withCounts && matched.length >= want) break;
      const cat = await this.categoryOf(row, traces.has(row.sessionId), traces);
      counts[cat] += 1;
      if (withCounts) {
        const ws = (workspaceCounts[row.workspace] ??= {
          active: 0,
          subagent: 0,
          schedule: 0,
          archived: 0,
        });
        ws[cat] += 1;
      }
      if ((category === undefined || cat === category) && matched.length < want) matched.push(row);
    }
    const sessions = await toPage(paging ? matched.slice(paging.offset, want) : matched);
    return withCounts ? { sessions, counts, workspaceCounts } : { sessions };
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

  /**
   * Model switch: fork a Session onto another model. Creates a NEW Session for the same
   * Agent that carries the source Session's conversation as sanitized real history (core
   * `agent.forkSession`); the source Session is left untouched. Rejected with 409 while
   * the source is running or compacting (same task_in_progress / compacting semantics as
   * starting a Task); the model reference must be the complete pair (the route enforces
   * presence; an unknown pair is a 400 from core validation). The new row copies the
   * source's approval mode and title (a real continuation).
   */
  async forkSession(args: {
    row: SessionRow;
    modelId: string;
    provider: string;
  }): Promise<{ session: SessionInfo; forkedFrom: string }> {
    const { row, modelId, provider } = args;
    // The source must be idle: forking mid-run would snapshot a half-written turn.
    const status = this.deps.manager.statusOf(row.sessionId);
    if (status === "running") {
      throw new HttpError(409, "task_in_progress", "This Session already has a Task in progress.");
    }
    if (status === "compacting") {
      throw new HttpError(
        409,
        "compacting",
        "This Session is compacting its context; not accepting new input.",
      );
    }
    const agent = await createAgent({
      root: this.deps.root,
      projectId: row.projectId,
      agentId: row.agentId,
    });
    let session;
    try {
      session = await agent.forkSession({ fromSessionId: row.sessionId, modelId, provider });
    } catch (err) {
      if (isMissingCredential(err)) throw modelCredentialMissing(modelId);
      throw new HttpError(
        400,
        "session_fork_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    // A fork is a user action: its origin derives from the new core session_meta (which
    // carries none), same single-source-of-truth convention as createSession.
    const metaMsg = session.metaMessage;
    this.deps.sources.set(
      session.sessionId,
      isSessionMeta(metaMsg) ? (asSessionSource(metaMsg.payload.source) ?? null) : null,
    );
    const newRow: SessionRow = {
      sessionId: session.sessionId,
      projectId: row.projectId,
      agentId: row.agentId,
      provider: session.provider,
      modelId: session.modelId,
      workspace: session.workspaceDir,
      // The fork continues the source conversation: its approval mode and title carry over.
      approvalMode: row.approvalMode,
      title: row.title,
      createdAt: new Date().toISOString(),
    };
    this.deps.sessions.insert(newRow);
    this.deps.manager.adopt(newRow, session);
    // hasTrace is true from birth: the forked Trace file was just written.
    return { session: await this.toInfo(newRow, true), forkedFrom: row.sessionId };
  }

  /**
   * One walk over the Trace directory: session_id → its **earliest** shard (the shard
   * whose head carries the original session_meta). Discovery (which Sessions have
   * records) and the meta-read location come out of a single pass, so classifying every
   * row (`counts=1`) costs one directory walk total instead of one per Session.
   */
  private async discoverTraces(
    projectId: string,
    agentId: string,
  ): Promise<Map<string, TraceLocation>> {
    const dir = tracesDir(this.deps.root, projectId, agentId);
    const out = new Map<string, TraceLocation>();
    for (const dateDir of await listDirsSafe(dir)) {
      for (const file of await listFilesSafe(path.join(dir, dateDir))) {
        const match = TRACE_FILE_RE.exec(file);
        if (!match) continue;
        const sessionId = match[1]!;
        const index = Number(match[2]);
        const cur = out.get(sessionId);
        if (!cur || index < cur.index) {
          out.set(sessionId, { path: path.join(dir, dateDir, file), index });
        }
      }
    }
    return out;
  }

  /**
   * session_meta from a located Trace shard head; null when unreadable or it has no
   * meta. Shared by adoption backfill and lazy `source` resolution.
   */
  private async readTraceMeta(location: TraceLocation): Promise<SessionMetaMessage | null> {
    let messages;
    try {
      messages = await readTraceHead(location.path);
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
    location: TraceLocation,
  ): Promise<SessionRow | null> {
    const meta = await this.readTraceMeta(location);
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

/** A located Trace shard of one Session: absolute path plus its shard index. */
interface TraceLocation {
  path: string;
  index: number;
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
