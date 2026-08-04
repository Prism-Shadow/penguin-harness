/**
 * Session index service.
 *
 * The default list is served from the DB index alone (web rows: `client` web/NULL) — no
 * Trace directory scanning in steady state (#139). `includeCli` widens it to DB ∪ Trace
 * directory discovery: scans `<agent>/traces/<date>/<session_id>_<index3>.jsonl`; an
 * unmanaged Session (one started via the CLI) has its first line's session_meta read for
 * (provider, model_id) / workspace, which is backfilled into a DB row marked
 * `client: "cli"` (approval_mode defaults, createdAt is taken from the timestamp embedded
 * in session_id) — the default list keeps excluding it, but it becomes individually
 * reachable (deep links).
 * Create: via core's `agent.createSession` (the model reference is always a complete
 * (provider, modelId) pair — both or neither; omitting both falls back to the
 * Project's default reference, 400 if there is none); the new Session is
 * added to session-manager's active table (state idle).
 */
import { createAgent, isSessionMeta } from "@prismshadow/penguin-core";
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
import { TraceIndexService, traceFilePath } from "./trace-index.js";
import type { ProjectConfigService } from "./project-config-service.js";

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
  /** Trace-file index: discovery / adoption / stats serve from it (mtime-gated reconciler; no per-request walks). */
  traceIndex: TraceIndexService;
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  /**
   * DB row -> SessionInfo (run status and pending approval count come from session-manager).
   * Async because `source` is derived from session_meta: a registry miss (Session predating
   * this process) falls back to reading the Trace head once (see sourceOf). `traces` is the
   * list flow's one-walk discovery result; without it a miss locates the shard itself.
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
      pendingFollowUpCount: this.deps.manager.pendingFollowUpCount(row.sessionId),
      hasTrace,
      archived: (row.archivedAt ?? null) !== null,
    };
  }

  /**
   * A Session's origin, with session_meta as the single source of truth: the in-process
   * registry answers first (populated at creation / subagent registration / adoption /
   * index registration); on a miss (a Session created before this process started) the
   * trace index's registration-time facts answer — the reconciler head-read the earliest
   * shard once when the file first appeared, so no file is touched here. A Session with
   * no Trace yet stays unknown and is NOT cached negatively — its meta may appear with
   * the first run.
   */
  private async sourceOf(row: SessionRow, hasTrace: boolean): Promise<SessionSource | undefined> {
    const known = this.deps.sources.get(row.sessionId);
    if (known !== undefined) return known ?? undefined;
    if (!hasTrace) return undefined;
    const facts = this.deps.traceIndex.repo.getSession(row.sessionId);
    if (!facts?.metaRead) return undefined; // Unreadable/unregistered: stay unknown, retry on the next list.
    this.deps.sources.set(row.sessionId, facts.source);
    return facts.source ?? undefined;
  }

  /** Whether this Session already has a Trace record (a Task has been run): answered by the index (reconciled first). */
  async hasTrace(row: SessionRow): Promise<boolean> {
    return (await this.discoverTraces(row.projectId, row.agentId)).has(row.sessionId);
  }

  /**
   * The list category of a row: archived wins (an explicit user action), then the
   * origin's bucket, and no/unknown source is `active` — the same precedence the
   * sidebar's partition applies to loaded rows, so server filtering and client
   * rendering can never disagree.
   */
  private async categoryOf(row: SessionRow, hasTrace: boolean): Promise<SessionCategory> {
    if ((row.archivedAt ?? null) !== null) return "archived";
    return (await this.sourceOf(row, hasTrace)) ?? "active";
  }

  /**
   * List, sorted by createdAt descending. The default serves **web sessions straight from
   * the DB** (`client` web/NULL rows) with no Trace directory scanning — the answer to
   * many-session sidebar reloads re-walking the filesystem on every request (#139). One
   * lazy discovery walk still runs for a list call that contains rows this process has not
   * classified yet (no in-process source entry): it supplies the Trace locations for the
   * one-time head reads and backfills the `has_trace` cache; once every row is classified,
   * list calls touch only the DB. `includeCli` widens the list to DB ∪ Trace directory
   * discovery (adopting unmanaged CLI Traces as `client: "cli"` rows), which inherently
   * scans — that path is opt-in via the "show CLI sessions" preference.
   *
   * Optional `paging` returns just that slice (the sidebar pages with limit+1 to detect
   * "has more"); slicing happens before toInfo, so per-request source derivation (lazy
   * Trace-head reads) stays bounded by the page size.
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
      includeCli?: boolean;
    } = {},
  ): Promise<{
    sessions: SessionInfo[];
    counts?: SessionCategoryCounts;
    workspaceCounts?: Record<string, SessionCategoryCounts>;
  }> {
    const { paging, category, withCounts, includeCli } = opts;
    const rows = new Map(
      this.deps.sessions
        .listByAgent(projectId, agentId, { webOnly: !includeCli })
        .map((r) => [r.sessionId, r]),
    );

    let traces: ReadonlySet<string> | undefined;
    if (includeCli) {
      traces = await this.discoverTraces(projectId, agentId);
      // Unmanaged Trace Sessions (the CLI's): backfill an index row from the trace
      // index's registration-time facts, marked client "cli" so the default list can
      // exclude them.
      for (const sessionId of traces) {
        if (rows.has(sessionId)) continue;
        const discovered = this.adoptTraceSession(projectId, agentId, sessionId);
        if (discovered) rows.set(sessionId, discovered);
      }
    } else if ([...rows.values()].some((r) => this.deps.sources.get(r.sessionId) === undefined)) {
      // Hydration pass: some rows predate this process and are unclassified — one
      // reconciled index read supplies discovery so sourceOf's facts lookups and the
      // has_trace cache need no per-row work. Steady state (everything classified)
      // skips this.
      traces = await this.discoverTraces(projectId, agentId);
      for (const row of rows.values()) {
        if (!row.hasTrace && traces.has(row.sessionId)) {
          row.hasTrace = true;
          this.deps.sessions.markHasTrace(row.sessionId);
        }
      }
    }

    const sorted = [...rows.values()].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
    );
    const rowHasTrace = (row: SessionRow): boolean =>
      traces ? traces.has(row.sessionId) : row.hasTrace === true;
    const toPage = (page: SessionRow[]) =>
      Promise.all(page.map((row) => this.toInfo(row, rowHasTrace(row))));

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
      const cat = await this.categoryOf(row, rowHasTrace(row));
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

    // Trace activity from the index (one mtime-gated reconcile, then a pure DB read —
    // this used to walk the Agent's ENTIRE trace history on every agents-list request):
    // the date is the shard's date directory (local yyyy-mm-dd, core's writing convention).
    await this.deps.traceIndex.reconcileAgent(projectId, agentId);
    for (const f of this.deps.traceIndex.repo.listFilesByAgent(projectId, agentId)) {
      mark(f.date, f.sessionId);
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
      // Everything created through this service is the Web App's (schedule runs included);
      // "cli" is stamped only by Trace adoption. NULL means a legacy row, treated as web.
      client: "web",
      createdAt: new Date().toISOString(),
    };
    this.deps.sessions.insert(row);
    this.deps.manager.adopt(row, session);
    return this.toInfo(row, false);
  }

  /**
   * Absolute path of a Session's **latest** Trace file (the current context shard);
   * undefined when no Trace exists. Costs a directory walk, so only the single-session
   * GET includes it in the DTO (see SessionInfo.tracePath) — the web's `/model` switch
   * hands it to the new session's `[model_switch_from]` block so the model can read the
   * source history itself when it needs it.
   */
  async latestTracePath(row: SessionRow): Promise<string | undefined> {
    await this.deps.traceIndex.reconcileAgent(row.projectId, row.agentId);
    let files = this.deps.traceIndex.repo.listFilesBySession(
      row.projectId,
      row.agentId,
      row.sessionId,
    );
    if (files.length === 0) {
      // Index miss with disk possibly ahead: one forced diff, then retry (the consumers'
      // rule — a stale index costs one extra scan, never a missing resume shard).
      await this.deps.traceIndex.reconcileAgent(row.projectId, row.agentId, { force: true });
      files = this.deps.traceIndex.repo.listFilesBySession(
        row.projectId,
        row.agentId,
        row.sessionId,
      );
    }
    const latest = files.at(-1);
    return latest === undefined ? undefined : traceFilePath(this.deps.root, latest);
  }

  /**
   * One walk over the Trace directory: session_id → its **earliest** shard (the shard
   * whose head carries the original session_meta). Discovery (which Sessions have
   * records) and the meta-read location come out of a single pass, so classifying every
   * row (`counts=1`) costs one directory walk total instead of one per Session.
   */
  private async discoverTraces(projectId: string, agentId: string): Promise<Set<string>> {
    await this.deps.traceIndex.reconcileAgent(projectId, agentId);
    const out = new Set<string>();
    for (const f of this.deps.traceIndex.repo.listFilesByAgent(projectId, agentId)) {
      out.add(f.sessionId);
    }
    return out;
  }

  /**
   * Adopts a Session that exists only in the Trace directory, from the index's
   * registration-time facts (the reconciler head-read the earliest shard's session_meta
   * once when the file first appeared — adoption itself reads no file).
   */
  private adoptTraceSession(
    projectId: string,
    agentId: string,
    sessionId: string,
  ): SessionRow | null {
    const facts = this.deps.traceIndex.repo.getSession(sessionId);
    if (!facts?.metaRead) return null; // Corrupt/unreadable head: skip (does not block the list; retried by a later reconcile)
    // An older Trace version's session_meta lacks provider (the model reference
    // wasn't split into separate fields yet): no backward compat, skip adoption
    // (core will give a clear error on resume; the product hasn't launched yet, so
    // old data can simply be deleted and recreated).
    if (facts.provider === null || facts.modelId === null) return null;
    // Registration already narrowed the origin; record it in the registry (single source of truth).
    this.deps.sources.set(sessionId, facts.source);
    const row: SessionRow = {
      sessionId,
      projectId,
      agentId,
      provider: facts.provider,
      modelId: facts.modelId,
      workspace: facts.workspace,
      // The approval mode for an unmanaged Session (started via the CLI) isn't in the Trace, so it's backfilled with the default value.
      approvalMode: "allow-all",
      title: null,
      // Adopted = a Trace this server never created, i.e. the CLI's: the default list
      // (web-only) excludes these rows; the "show CLI sessions" preference includes them.
      client: "cli",
      hasTrace: true,
      createdAt: sessionIdCreatedAt(sessionId) ?? facts.firstTs ?? new Date().toISOString(),
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
