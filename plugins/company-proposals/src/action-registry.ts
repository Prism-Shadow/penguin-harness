/**
 * The Action registry: every write to an organization's proposals and roadmaps goes through
 * here (action-routes.ts is its one way in). A run, in order:
 *
 *   1. the key resolves to the one bound contribution (action-index.ts), or the caller names
 *      the contribution itself;
 *   2. the subject and the parameters are checked (400);
 *   3. the subject's state is read, and — for an Action that runs on a commit — its commit,
 *      checked against `expectedHead`;
 *   4. the guard, as the organization binds it, is asked with that state;
 *   5. the before hooks run in their order, any of them may refuse;
 *   6. the run: its writes ask the guard again inside their transaction and write the run's
 *      start row there (Act), its effects follow the commit, a process it starts is followed;
 *   7. the after hooks, then the end row.
 *
 * Every attempt once its contribution is known leaves a run: `refused` (the guard, a hook, a
 * check above), `failed` (the run threw: its write rolled back), `succeeded` (the write
 * stands — an after hook that fails is listed in `hookErrors`, never undoes it). A retry with
 * the same `requestId` answers the first run. The answer to a run that started a process goes
 * out as soon as the process starts (202); the run ends when the process exits.
 */
import { randomBytes } from "node:crypto";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import type { ActionRunAnswer, ActionRunVia } from "@prismshadow/penguin-server/api";
import {
  ActionRefusal,
  parseSubject,
  type ActionCaller,
  type ActionOutcome,
  type Guard,
  type HookEvent,
  type ProcessEnd,
  type RunContext,
  type Subject,
  type SubjectCommit,
} from "./action-model.js";
import {
  ActionIndex,
  type BindingState,
  type Bindings,
  type Contributed,
  type IndexedAction,
} from "./action-index.js";
import { ActionStore, writeStart, type RunStart } from "./action-store.js";
import { liveRuns, runProcess, runningCount, type LiveRun } from "./action-live.js";
import { viewOf } from "./action-views.js";
import { BIND_ID, BIND_KEY, runBind } from "./action-bind.js";
import { companyDbPath } from "./schema.js";
import type { StartProcess } from "./deploy-process.js";

export interface RegistryDeps {
  gateway: Pick<OrgGateway, "companyModeEnabled" | "organization" | "principalOf">;
  /** The data root (Paths.root). */
  root: string;
  log: (line: string) => void;
  contributions: readonly Contributed[];
  /** The modules whose contributions are built in: bound unless an organization unbinds them. */
  builtin: ReadonlySet<string>;
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
}

/** A run's answer: 200 once it ended, 202 while its process runs. */
export interface RunAnswer extends ActionRunAnswer {
  status: 200 | 202;
}

/** An organization, its caller and its store, behind the access check. */
export interface OrgScope {
  org: OrgView;
  caller: ActionCaller;
  store: ActionStore;
  orgKey: string;
}

/** The registry's view of an error a run or a check threw. */
interface Classified {
  outcome: "refused" | "failed";
  status: number;
  code: string;
  message: string;
}

function hasStatus(err: unknown): err is { status: number; code: string; message: string } {
  const e = err as { status?: unknown; code?: unknown } | null;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.status === "number" &&
    typeof e.code === "string"
  );
}

/** When this process started: runs started before it and never ended were left by a past one. */
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();

export class ActionRegistry {
  readonly index: ActionIndex;
  private readonly stores = new Map<string, ActionStore>();
  /** The runs this instance started and has not ended, by id: their organization. */
  private readonly mine = new Map<string, string>();
  private stopped = false;

  constructor(private readonly deps: RegistryDeps) {
    this.index = ActionIndex.build(deps.contributions, deps.builtin);
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

  /** The organization with company mode on and the caller belonging to it. */
  async scope(projectId: string, orgId: string, actor: OrgActor): Promise<OrgScope> {
    if (this.stopped) throw new ActionRefusal(503, "stopping", "The registry is stopping.");
    if (!this.deps.gateway.companyModeEnabled()) {
      throw new ActionRefusal(404, "company_mode_off", "Company mode is off.");
    }
    const org = await this.deps.gateway.organization(projectId, orgId);
    if (org === null) {
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
      orgKey: `${projectId}/${orgId}`,
    };
  }

  /** The organization's bindings: what it stored, else bound for a built-in contribution only. */
  bindingsOf(store: ActionStore): Bindings {
    const stored = new Map(store.bindings().map((b) => [b.contribution, b]));
    return (entry): BindingState => {
      const b = stored.get(entry.id);
      return b !== undefined
        ? { enabled: b.enabled, position: b.position, config: b.config }
        : { enabled: entry.builtin, position: 0, config: {} };
    };
  }

  /** Runs an Action; refusals and failures come back as the error they answered with. */
  async run(
    projectId: string,
    orgId: string,
    actor: OrgActor,
    req: RunRequest,
  ): Promise<RunAnswer> {
    const scope = await this.scope(projectId, orgId, actor);
    const via = viaOf(req.via, scope.caller);
    if (req.key === BIND_KEY || req.contribution === BIND_ID) {
      return runBind(this, scope, req, via, this.now());
    }
    const bindings = this.bindingsOf(scope.store);
    const action =
      req.contribution !== undefined
        ? this.boundAction(req.contribution, bindings)
        : this.index.resolve(String(req.key ?? ""), bindings);
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
      prepared = await this.prepare(scope, action, bindings, req, start);
    } catch (err) {
      throw this.endRefused(scope.store, start, err);
    }
    return this.execute(scope, action, bindings, start, prepared);
  }

  /** A contribution named exactly: an action bound in the organization. */
  private boundAction(id: string, bindings: Bindings): IndexedAction {
    const entry = this.index.byId(id);
    if (entry === undefined || entry.kind !== "action" || !bindings(entry).enabled) {
      throw new ActionRefusal(
        404,
        "action_not_found",
        `No action contribution ${id} is bound in this organization.`,
      );
    }
    return entry;
  }

  /** Steps 2–5: everything that may refuse before the run. */
  private async prepare(
    scope: OrgScope,
    action: IndexedAction,
    bindings: Bindings,
    req: RunRequest,
    start: RunStart,
  ): Promise<Prepared> {
    const subject = parseSubject(req.subject);
    start.subjectKind = subject.kind;
    start.subject = subject.text;
    if (!action.subjects.includes(subject.kind)) {
      throw new ActionRefusal(
        400,
        "bad_subject",
        `${action.key} acts on ${action.subjects.join(", ") || "nothing"}, not ${subject.kind}.`,
      );
    }
    const params = action.params(req.params);
    start.params = params;
    const config = bindings(action).config;
    const guard = this.index.guardOf(action, bindings);
    const resolver = this.index.subjectOf(subject.kind, bindings);
    const subjectScope = { org: scope.org, caller: scope.caller };
    const state = resolver === undefined ? null : await resolver.code.state(subjectScope, subject);
    let commit: SubjectCommit | null = null;
    if (action.commit) {
      commit = (await resolver?.code.commit?.(subjectScope, subject)) ?? null;
      if (commit === null) {
        throw new ActionRefusal(409, "no_commit", `${subject.text} has no commit to run on.`);
      }
      start.commit = commit.sha;
      const expected = params.expectedHead;
      if (typeof expected === "string" && !commit.sha.startsWith(expected.toLowerCase())) {
        throw new ActionRefusal(
          409,
          "head_moved",
          `${subject.text} is at ${commit.sha.slice(0, 12)} now, not ${expected.slice(0, 12)}: look again before running ${action.key}.`,
        );
      }
    }
    const running = runningCount(scope.orgKey, action.key);
    guard({ caller: scope.caller, subject, state, params, config, running });
    for (const hook of this.index.hooksOf(action.key, "before", bindings)) {
      try {
        await hook.code(
          this.event(
            "before",
            action,
            scope,
            start,
            subject,
            params,
            commit,
            bindings(hook).config,
          ),
        );
      } catch (err) {
        if (hasStatus(err)) throw err;
        throw new ActionRefusal(
          409,
          "hook_refused",
          `${hook.id} refused: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { subject, params, config, guard, commit };
  }

  private event(
    when: "before" | "after",
    action: IndexedAction,
    scope: OrgScope,
    start: RunStart,
    subject: Subject,
    params: Record<string, unknown>,
    commit: SubjectCommit | null,
    config: Record<string, unknown>,
  ): HookEvent {
    return {
      when,
      key: action.key,
      contribution: action.id,
      runId: start.id,
      org: scope.org,
      caller: scope.caller,
      subject,
      params,
      commit,
      config,
    };
  }

  /** Steps 6–7, and the answer. */
  private async execute(
    scope: OrgScope,
    action: IndexedAction,
    bindings: Bindings,
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
    const refusals = new WeakSet<object>();
    let processEnd: ProcessEnd | null = null;
    let processStarted!: () => void;
    const started = new Promise<"process">((resolve) => {
      processStarted = () => resolve("process");
    });
    const store = scope.store;
    const guarded: Guard = (input) => {
      try {
        p.guard(input);
      } catch (err) {
        if (typeof err === "object" && err !== null) refusals.add(err);
        throw err;
      }
    };
    let wroteStart = false;
    const ctx: RunContext = {
      runId: start.id,
      org: scope.org,
      actor: { userId: scope.caller.userId },
      caller: scope.caller,
      subject: p.subject,
      params: p.params,
      commit: p.commit,
      config: p.config,
      act: {
        guard: (input) =>
          guarded({ ...input, config: p.config, running: runningCount(scope.orgKey, action.key) }),
        inTx: (db) => {
          if (wroteStart) return;
          writeStart(db, start);
          wroteStart = true;
        },
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
        const c = this.classify(err, refusals);
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
      const hookErrors: string[] = [];
      for (const hook of this.index.hooksOf(action.key, "after", bindings)) {
        try {
          await hook.code({
            ...this.event(
              "after",
              action,
              scope,
              start,
              p.subject,
              p.params,
              p.commit,
              bindings(hook).config,
            ),
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

  private classify(err: unknown, refusals: WeakSet<object>): Classified {
    const refused =
      (typeof err === "object" && err !== null && refusals.has(err)) ||
      (err instanceof Error && err.name === "ActionRefusal");
    if (hasStatus(err)) {
      return {
        outcome: refused ? "refused" : "failed",
        status: err.status,
        code: err.code,
        message: err.message,
      };
    }
    return { outcome: "failed", status: 500, code: "internal", message: "Internal error." };
  }

  /** A run refused before it ran: its start and end, recorded together; the error to answer with. */
  private endRefused(store: ActionStore, start: RunStart, err: unknown): unknown {
    const c = this.classify(err, new WeakSet());
    const outcome: ActionOutcome = hasStatus(err) && c.status < 500 ? "refused" : "failed";
    try {
      store.end(start, {
        outcome,
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
    if (hasStatus(err))
      return new ActionRefusal(err.status, err.code, err.message, { runId: start.id });
    this.deps.log(
      `[company-actions] ${start.key}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    return new ActionRefusal(500, "internal", "Internal error.", { runId: start.id });
  }

  /** Once stopped, an organization's store closes when its last live run ends. */
  private closeIfIdle(orgKey: string): void {
    if (!this.stopped) return;
    for (const org of this.mine.values()) if (org === orgKey) return;
    this.stores.get(orgKey)?.close();
    this.stores.delete(orgKey);
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

/** What prepare hands the run. */
interface Prepared {
  subject: Subject;
  params: Record<string, unknown>;
  config: Record<string, unknown>;
  guard: Guard;
  commit: SubjectCommit | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function viaOf(raw: unknown, caller: ActionCaller): ActionRunVia {
  if (caller.sessionId !== undefined) return "session";
  return raw === "web" || raw === "cli" ? raw : "api";
}

function requestIdOf(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw === "" || raw.length > 128) {
    throw new ActionRefusal(400, "bad_request", "requestId must be a string of 1–128 characters.");
  }
  return raw;
}
