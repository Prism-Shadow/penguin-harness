/**
 * The Action registry: every write to an organization's proposals and roadmaps goes through
 * here (action-routes.ts is its one way in). A run, in order:
 *
 *   1. the key resolves to one contribution in the organization's index (action-index.ts) — a
 *      company workflow's ahead of the built-in one — and to its guard in force, or the caller
 *      names an action or a guard contribution exactly; an ambiguous key is answered here, with
 *      no run recorded;
 *   2. the subject and the parameters are checked (400);
 *   3. the subject's state is read, and — for an Action that runs on a commit — its commit,
 *      checked against `expectedHead`;
 *   4. the guard in force is asked with that state;
 *   5. the before hooks run in their order, any of them may refuse;
 *   6. the run: its writes ask the guard again inside their transaction and write the run's
 *      start row there (Act), its effects follow the commit, a process it starts is followed;
 *   7. the after hooks, then the end row.
 *
 * Steps 2–5 are action-prepare.ts. Every attempt once its contribution is known leaves a run:
 * `refused` (the guard, a hook, a check above, or a domain error with a 4xx status the run
 * threw), `failed` (anything else the run threw: its write rolled back; answered with its own
 * status when that is a 5xx, else 500), `succeeded` (the write
 * stands — an after hook that fails is listed in `hookErrors`, never undoes it). A run's write
 * may send notices once it committed (`ctx.act.notify`): each is a run of a `notify.*` Action by
 * key, as the same caller, recorded `via: "notify"`; one that is refused or fails is listed in the
 * sending run's `hookErrors` too. A `notify.*` Action runs only as such a notice. A retry with
 * the same `requestId` answers the first run. The answer to a run that started a process goes
 * out as soon as the process starts (202); the run ends when the process exits.
 *
 * The built-in contributions are the same in every organization; an organization's company
 * contributions come from its company workflows (RegistryDeps.company), so each organization
 * has an index of its own, rebuilt whenever its workflows' contributions change.
 */
import { randomBytes } from "node:crypto";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { ActionRunAnswer } from "@prismshadow/penguin-server/api";
import {
  ActionRefusal,
  type ActionCaller,
  type ActionOutcome,
  type Guard,
  type ProcessEnd,
  type RunContext,
} from "./action-model.js";
import { ActionIndex, type Contributed, type IndexedAction } from "./action-index.js";
import { ActionStore, writeStart, type RunStart } from "./action-store.js";
import { liveRuns, runProcess, runningCount, stopRuns, type LiveRun } from "./action-live.js";
import { RetiredOrgs } from "./org-retire.js";
import { viewOf } from "./action-views.js";
import {
  classify,
  eventOf,
  hasStatus,
  isRecord,
  prepare,
  requestIdOf,
  targetOf,
  viaOf,
  type Prepared,
} from "./action-prepare.js";
import { actorOf, requireNoticeOnly, sendNotice } from "./action-notice.js";
import { companyDbPath } from "./schema.js";
import { withSkillHint } from "./skill-hint.js";
import type { StartProcess } from "./deploy-process.js";

/** Where an organization's company contributions come from: its company workflows. */
export interface CompanySource {
  /** The contributions its workflows give now — the same array while none of them reloaded. */
  contributions(org: OrgView): Promise<readonly Contributed[]>;
}

export interface RegistryDeps {
  gateway: Pick<OrgGateway, "companyModeEnabled" | "organization" | "principalOf">;
  /** The data root (Paths.root). */
  root: string;
  log: (line: string) => void;
  /** The built-in contributions: the slot's, and the registry's own. */
  contributions: readonly Contributed[];
  company?: CompanySource;
  now?: () => number;
  start?: StartProcess;
  timeoutMs?: number;
}

/** What a run is asked for. */
export interface RunRequest {
  /** The Action's key, or … */
  key?: string;
  /** … the contribution to run, exactly. */
  contribution?: string;
  subject: unknown;
  params?: unknown;
  requestId?: unknown;
  via?: unknown;
  /** Set by the registry alone (never from a route): the run is a notice another run sent. */
  notice?: boolean;
}

/** A run's answer: 200 once it ended, 202 while its process runs. */
export interface RunAnswer extends ActionRunAnswer {
  status: 200 | 202;
}

/** An organization, its caller, its store and its index, behind the access check. */
export interface OrgScope {
  org: OrgView;
  caller: ActionCaller;
  store: ActionStore;
  orgKey: string;
  index: ActionIndex;
}

/** When this process started: runs started before it and never ended were left by a past one. */
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

export class ActionRegistry {
  /** The built-in contributions alone: what every organization's index starts from. */
  readonly index: ActionIndex;
  private readonly stores = new Map<string, ActionStore>();
  /** Each organization's index, and the company contributions it was built from. */
  private readonly indexes = new Map<
    string,
    { company: readonly Contributed[]; index: ActionIndex }
  >();
  /** The runs this instance started and has not ended, by id: their organization. */
  private readonly mine = new Map<string, string>();
  private stopped = false;
  /** Organizations being (or already) deleted, whose store may not open again (org-retire.ts). */
  private readonly retired = new RetiredOrgs();

  constructor(private readonly deps: RegistryDeps) {
    this.index = ActionIndex.build(deps.contributions);
    for (const s of this.index.skipped) {
      deps.log(`[company-actions] contribution ${s.id} left out: ${s.reason}`);
    }
  }

  private now(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString();
  }

  private storeOf(projectId: string, orgId: string): ActionStore {
    const key = `${projectId}/${orgId}`;
    let s = this.stores.get(key);
    if (s === undefined) {
      s = ActionStore.open(
        companyDbPath(this.deps.root, projectId, orgId),
        PROCESS_STARTED_AT,
        () => Date.parse(this.now()),
      );
      this.stores.set(key, s);
    }
    return s;
  }

  /** The organization's index: the built-in contributions and its company workflows'. */
  private async indexOf(org: OrgView, orgKey: string): Promise<ActionIndex> {
    const company = (await this.deps.company?.contributions(org)) ?? [];
    if (company.length === 0) return this.index;
    const cached = this.indexes.get(orgKey);
    if (cached !== undefined && cached.company === company) return cached.index;
    const index = ActionIndex.build([...this.deps.contributions, ...company]);
    this.indexes.set(orgKey, { company, index });
    return index;
  }

  /**
   * The contributions the organization's index leaves out now, and why — read after a company
   * workflow loaded, so a run of `workflow.*` reports them (workflow-actions.ts).
   */
  async skippedIn(org: OrgView): Promise<ReadonlyArray<{ id: string; reason: string }>> {
    return (await this.indexOf(org, `${org.projectId}/${org.orgId}`)).skipped;
  }

  /** The organization with company mode on and the caller belonging to it. */
  async scope(projectId: string, orgId: string, actor: OrgActor): Promise<OrgScope> {
    if (this.stopped) throw new ActionRefusal(503, "stopping", "The registry is stopping.");
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new ActionRefusal(404, "company_mode_off", "Company mode is off.");
    }
    const orgKey = `${projectId}/${orgId}`;
    const seen = this.retired.stamp();
    const org = await this.deps.gateway.organization(projectId, orgId);
    // A retired organization opens again only for a read that found it after its retirement began.
    if (org === null || !this.retired.admit(orgKey, seen)) {
      throw new ActionRefusal(404, "org_not_found", `Organization does not exist: ${orgId}`);
    }
    const principal = await this.deps.gateway.principalOf(projectId, orgId, actor);
    const agentId = principal.startsWith("agent:") ? principal.slice("agent:".length) : null;
    if (agentId === null && !org.userIds.includes(actor.userId)) {
      throw new ActionRefusal(403, "project_access", "Not a member of this Project.");
    }
    return {
      org,
      caller: {
        principal,
        agentId,
        userId: actor.userId,
        ...(actor.sessionId !== undefined ? { sessionId: actor.sessionId } : {}),
      },
      store: this.storeOf(projectId, orgId),
      orgKey,
      index: await this.indexOf(org, orgKey),
    };
  }

  /**
   * Runs an Action; refusals and failures come back as the error they answered with — for an
   * employee's proposal or roadmap write, followed by the skill that explains it (skill-hint.ts).
   */
  async run(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    req: RunRequest,
  ): Promise<RunAnswer> {
    const scope = await this.scope(projectId, orgId, actor);
    try {
      return await this.runIn(scope, req);
    } catch (err) {
      throw withSkillHint(err, req, scope.caller);
    }
  }

  private async runIn(scope: OrgScope, req: RunRequest): Promise<RunAnswer> {
    const via = req.notice === true ? "notify" : viaOf(req.via, scope.caller);
    // Which Action, judged by which guard: a key that resolves to none, or to two of one
    // standing, is answered here, before any run exists — it is not recorded.
    const { action, guard } = targetOf(scope.index, req);
    requireNoticeOnly(action.key, req);
    const start: RunStart = {
      id: randomBytes(8).toString("hex"),
      key: action.key,
      contribution: action.id,
      subjectKind: "unknown",
      subject: typeof req.subject === "string" ? req.subject.slice(0, 400) : "",
      commit: null,
      params: isRecord(req.params) ? req.params : {},
      by: scope.caller.principal,
      via,
      sessionId: scope.caller.sessionId ?? null,
      requestId: null,
      startedAt: this.now(),
    };
    const requestId = requestIdOf(req.requestId);
    if (requestId !== null) {
      start.requestId = requestId;
      const earlier = scope.store.byRequest(start.by, start.key, requestId);
      if (earlier !== null) {
        return {
          status: earlier.end === null ? 202 : 200,
          run: viewOf(earlier),
          result: earlier.end?.result ?? null,
        };
      }
    }
    let prepared: Prepared;
    try {
      prepared = await prepare(scope, scope.index, action, guard, req, start);
    } catch (err) {
      throw this.endRefused(scope.store, start, err);
    }
    return this.execute(scope, action, start, prepared);
  }

  /** Steps 6–7, and the answer. */
  private async execute(
    scope: OrgScope,
    action: IndexedAction,
    start: RunStart,
    p: Prepared,
  ): Promise<RunAnswer> {
    const live: LiveRun = {
      start,
      orgKey: scope.orgKey,
      output: "",
      dropped: 0,
      hasProcess: false,
    };
    liveRuns().set(start.id, live);
    this.mine.set(start.id, scope.orgKey);
    let processEnd: ProcessEnd | null = null;
    let processStarted!: () => void;
    const started = new Promise<"process">((resolve) => {
      processStarted = () => resolve("process");
    });
    const store = scope.store;
    const guard: Guard = p.guard;
    let wroteStart = false;
    // The notices the run sent that were refused or failed: listed with its after hooks'.
    const noticeErrors: string[] = [];
    const ctx: RunContext = {
      runId: start.id,
      key: action.key,
      org: scope.org,
      actor: { userId: scope.caller.userId },
      caller: scope.caller,
      subject: p.subject,
      params: p.params,
      commit: p.commit,
      act: {
        guard: (input) => guard({ ...input, running: runningCount(scope.orgKey, action.key) }),
        inTx: (db) => {
          if (wroteStart) return;
          writeStart(db, start);
          wroteStart = true;
        },
        notify: (notice) =>
          sendNotice(
            (req) => this.run(scope.org.projectId, scope.org.orgId, actorOf(scope.caller), req),
            start.id,
            notice,
            noticeErrors,
          ),
      },
      process: async (argv, opts) => {
        if (live.hasProcess) throw new Error("a run starts one process");
        if (scope.org.machineId !== null) {
          throw new ActionRefusal(
            409,
            "org_elsewhere",
            `${scope.org.orgId} runs on another machine (${scope.org.machineId}); run ${action.key} there, where its workspace is.`,
          );
        }
        if (store.get(start.id) === null) store.start(start);
        wroteStart = true;
        const end = runProcess(live, argv, {
          cwd: opts?.cwd ?? scope.org.workspace,
          env: { ...process.env, ...(opts?.env ?? {}) },
          ...(this.deps.start !== undefined ? { start: this.deps.start } : {}),
          ...(this.deps.timeoutMs !== undefined ? { timeoutMs: this.deps.timeoutMs } : {}),
        });
        processStarted();
        processEnd = await end;
        return processEnd;
      },
    };
    live.ctx = ctx;
    // The caller's own actor carries its session and Agent claims.
    if (scope.caller.sessionId !== undefined) ctx.actor.sessionId = scope.caller.sessionId;
    if (scope.caller.agentId !== null) ctx.actor.agentId = scope.caller.agentId;
    const label = `[company-actions] ${start.id} ${action.key} ${p.subject.text} by ${start.by}`;
    const completion = (async () => {
      let ended: {
        outcome: ActionOutcome;
        status: number;
        code: string | null;
        message: string | null;
        result: unknown;
      };
      try {
        const result = await action.code.run(ctx);
        ended = {
          outcome: "succeeded",
          status: 200,
          code: null,
          message: null,
          result: result ?? null,
        };
      } catch (err) {
        const c = classify(err);
        if (c.outcome === "failed" && !hasStatus(err)) {
          this.deps.log(
            `${label} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
          );
        }
        ended = { ...c, result: null };
      }
      if (processEnd !== null) {
        const pe: ProcessEnd = processEnd;
        if (ended.result === null) ended.result = { exitCode: pe.exitCode, error: pe.error };
      }
      const hookErrors: string[] = [...noticeErrors];
      for (const hook of scope.index.hooksOf(action.key, "after")) {
        try {
          await hook.code({
            ...eventOf("after", action, scope, start, p),
            outcome: ended.outcome,
            result: ended.result,
          });
        } catch (err) {
          hookErrors.push(`${hook.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      try {
        store.end(start, {
          ...ended,
          hookErrors,
          endedAt: this.now(),
          output: live.hasProcess ? live.output : null,
        });
      } catch (err) {
        this.deps.log(
          `${label}: the run's end was not recorded: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        liveRuns().delete(start.id);
        this.mine.delete(start.id);
        this.closeIfIdle(scope.orgKey);
      }
      if (live.hasProcess) this.deps.log(`${label} ${ended.outcome}`);
      return ended;
    })();
    live.done = completion;
    const first = await Promise.race([completion, started]);
    if (first === "process") {
      completion.catch((err: unknown) => this.deps.log(`${label}: ${String(err)}`));
      return { status: 202, run: viewOf({ ...start, end: null }), result: null };
    }
    const stored = store.get(start.id);
    const run = viewOf(stored ?? { ...start, end: null });
    if (first.outcome !== "succeeded") {
      throw new ActionRefusal(first.status, first.code ?? "internal", first.message ?? "", {
        runId: start.id,
      });
    }
    return { status: 200, run, result: first.result };
  }

  /** A run refused before it ran: its start and end, recorded together; the error to answer with. */
  private endRefused(store: ActionStore, start: RunStart, err: unknown): unknown {
    const c = classify(err);
    try {
      store.end(start, {
        outcome: c.outcome,
        status: c.status,
        code: c.code,
        message: c.message,
        result: null,
        hookErrors: [],
        endedAt: this.now(),
        output: null,
      });
    } catch (recordErr) {
      this.deps.log(
        `[company-actions] the refused run ${start.id} was not recorded: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`,
      );
    }
    if (!hasStatus(err)) {
      this.deps.log(
        `[company-actions] ${start.key}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
    }
    return new ActionRefusal(c.status, c.code, c.message, { runId: start.id });
  }

  /** Once stopped, an organization's store closes when its last live run ends. */
  private closeIfIdle(orgKey: string): void {
    if (!this.stopped) return;
    for (const org of this.mine.values()) if (org === orgKey) return;
    this.stores.get(orgKey)?.close();
    this.stores.delete(orgKey);
  }

  /**
   * The organization is being deleted (org-retire.ts): no new runs of it; its live runs — this
   * instance's and any an instance before a hot update started — have their processes stopped
   * and are awaited until their ends are recorded (action-live.ts); then its connection closes
   * and its index is dropped.
   */
  async retire(projectId: string, orgId: string): Promise<void> {
    const orgKey = `${projectId}/${orgId}`;
    this.retired.retire(orgKey);
    await stopRuns(orgKey);
    this.stores.get(orgKey)?.close();
    this.stores.delete(orgKey);
    this.indexes.delete(orgKey);
  }

  /**
   * The plugin is stopping (a hot update or a shutdown): no new runs; a run still going ends
   * on this instance, so each store closes when its last one ends.
   */
  stop(): void {
    this.stopped = true;
    for (const orgKey of [...this.stores.keys()]) this.closeIfIdle(orgKey);
  }
}
