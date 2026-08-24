/**
 * Active Session runtime: the HTTP-facing facade, and the generation's code behind the
 * per-session event loop (see ./hmr-agent.ts).
 *
 * No per-session state lives here — it is all on the agents, which survive a platform
 * swap. This class owns what a generation owns: the `AgentImpl` the pump invokes (open a
 * run, advance it one turn, close it), the submission surface the routes call, the
 * cross-session guards (shutdown and the Agent/Session deletion windows), the per-Agent
 * config generations behind vault invalidation, and the idle sweep. The per-message
 * pipeline lives in ./run-stream.ts and goal mode in ./goal-run.ts.
 *
 * Session lifecycle, unchanged in meaning since before the loop:
 *   - get-or-resume-or-heal (ensureSession): recover via Trace, or self-heal rebuild with
 *     a new session_id, which the index's primary key and the agents table follow;
 *   - a vault or model update bumps the Agent's config generation, so every Session
 *     loaded earlier is reloaded at its next idle boundary — never mid-run;
 *   - one Task or compaction at a time per Session (the queue and the activity slot);
 *   - an approval decision re-reads approval_mode from the DB; an interrupt converges
 *     pending approvals to deny, then aborts.
 *
 * `SessionLoader` injects the implementation of get-or-resume-or-heal: production uses
 * the core SDK (createCoreSessionLoader), tests inject a fake Session.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  createAgent,
  findLatestTraceFile,
  stripLeadingMarkerBlocks,
  tracesDir,
} from "@prismshadow/penguin-core";
import type {
  ApproveFn,
  BackgroundCommandInfo,
  CompactAvailability,
  OmniMessage,
  ProxyEnvPolicy,
  SpawnConfiner,
  SessionTitleResult,
  ThinkingLevelName,
} from "@prismshadow/penguin-core";
import type {
  PendingFollowUpInfo,
  PendingSteeringInfo,
  ServerEvent,
  SessionStatus,
} from "../api/types.js";
import type { RecallableFile } from "../services/task-attachments.js";
import { HttpError, isMissingCredential, modelCredentialMissing } from "../http/errors.js";
import type { GoalsRepo } from "../db/repos/goals.js";
import type { SessionRow, SessionsRepo } from "../db/repos/sessions.js";
import { makeApprove } from "./approvals.js";
import type { PendingApproval } from "./approvals.js";
import type { ChannelHub } from "./channel.js";
import type { ErrorSink } from "./error-recorder.js";
import { goalStream } from "./goal-run.js";
import { HmrAgent } from "./hmr-agent.js";
import type { AgentEvent, AgentImpl, OpenRun } from "./hmr-agent.js";
import { RunStream, isPlainText } from "./run-stream.js";
import type { SessionSources } from "./session-sources.js";
import type { TitleNotifier } from "./title-generator.js";
import type { UsageContext } from "./usage-recorder.js";

/**
 * 409 for when there's nothing to compact, one code per reason. Clients localize by code
 * (the Web's `apiErrorText` looks it up and falls back to the raw English), so a shared
 * code would force either three unrelated explanations flattened into one vague sentence
 * or English prose reaching a non-English UI — the same split `dir_not_absolute` /
 * `dir_not_found` / `not_a_dir` make for one rejected directory.
 */
function compactUnavailable(why: Exclude<CompactAvailability, "ok">): HttpError {
  const reasons: Record<typeof why, { code: string; message: string }> = {
    unsupported: {
      code: "compaction_not_configured",
      message: "This Agent does not have context compaction configured.",
    },
    empty: {
      code: "nothing_to_compact",
      message: "The current context has nothing to compact (no completed conversation turns yet).",
    },
    just_compacted: {
      code: "already_compacted",
      message:
        "The context was just compacted and there is no new conversation since; no need to compact again.",
    },
  };
  const { code, message } = reasons[why];
  return new HttpError(409, code, message);
}

/** Minimal interface for a runtime Session (satisfied by core Session; tests may inject a fake implementation). */
export interface RuntimeSession {
  readonly sessionId: string;
  run(
    newMessages: OmniMessage[],
    opts: {
      approve: ApproveFn;
      signal: AbortSignal;
      thinkingLevel?: ThinkingLevelName;
      /** Present = goal mode: core loops rounds inside this one run (see core SessionRunOptions). */
      goal?: { budget?: number };
    },
  ): AsyncGenerator<OmniMessage>;
  /**
   * The stepped run (core Session.beginRun/stepRun/endRun): begin opens it, the driver
   * takes one turn per stepRun until "done", and every begin is paired with endRun. This
   * is what gives the event loop its turn-boundary swap points. Optional — a Session
   * without it (test fakes, older embedders) is driven through `run` as one whole,
   * un-swappable event instead.
   */
  beginRun?(
    newMessages: OmniMessage[],
    opts: { approve: ApproveFn; signal: AbortSignal; thinkingLevel?: ThinkingLevelName },
  ): AsyncGenerator<OmniMessage, "continue" | "done">;
  stepRun?(): AsyncGenerator<OmniMessage, "continue" | "done">;
  endRun?(): void;
  compact(opts: { signal: AbortSignal }): AsyncGenerator<OmniMessage>;
  /** Whether compaction is possible and why; when not ok, compact() yields no messages (see core ContextEngine.compactability). */
  compactability(): CompactAvailability;
  /** Queues a mid-run steering input (core `Session.steer`); false when no Task is running. */
  steer(input: OmniMessage[]): boolean;
  /**
   * Withdraws a queued steering input before core delivers it (core `Session.unsteer`,
   * matched by input-list identity); false once it is no longer queued. Optional: a fake
   * omitting it reports every recall as "already delivered".
   */
  unsteer?(input: OmniMessage[]): boolean;
  /** Skips the in-progress reconnect backoff, firing the next retry immediately; false when no wait is in progress. */
  skipReconnectWait(): boolean;
  toolPermission(name: string): "r" | "rw" | undefined;
  /**
   * Out-of-band one-shot title generation (core `Session.generateTitle`; writes no
   * history/Trace). Material defaults to what the Session collected itself; `material`
   * overrides it for subagents.
   */
  generateTitle(args?: {
    material?: { userText: string; assistantText: string };
    signal?: AbortSignal;
  }): Promise<SessionTitleResult>;
  /**
   * The idle-arrival signal for background-task completion notices: fired when a
   * `run_in_background` launch settles while no Task is running (mid-run arrivals are
   * delivered inside the run by core). Delivery is queued as a `notices` event.
   */
  onBackgroundNotice?(listener: () => void): void;
  /** Takes the queued background completion notices as task input. Optional, like onBackgroundNotice. */
  takeBackgroundNotices?(): OmniMessage[];
  /** Whether completion notices are still queued; pins the agent against idle eviction. */
  hasPendingBackgroundNotices?(): boolean;
  /** Refreshes the listen-port probes behind the process list's `serviceUrl`. Optional: test fakes may omit it. */
  probeBackgroundCommandServices?(): Promise<void>;
  /** Subscribes live-forwarded background-subagent messages; the manager publishes them to the session channel. */
  onBackgroundMessage?(listener: (msg: OmniMessage) => void): void;
  /** Background command processes owned by the Session's environment. Optional: test fakes may omit it. */
  listBackgroundCommands?(): BackgroundCommandInfo[];
  /** Kills one background command process; false when the id is unknown. Optional, like listBackgroundCommands. */
  killBackgroundCommand?(processId: string): boolean;
  /** Whether a background subagent is mid-round; pins the agent against idle eviction. */
  hasRunningBackgroundSubagents?(): boolean;
  /** Releases environment resources — kills the remaining background processes. Optional, idempotent. */
  dispose?(): void;
}

/** The underlying loader behind get-or-resume-or-heal. */
export interface SessionLoader {
  /**
   * Load a runtime Session from an index row: recover (with a Trace) or self-heal rebuild
   * (no Trace, session_id will change). Throws HttpError(409) for unrecoverable cases
   * such as a missing Workspace.
   */
  load(row: SessionRow): Promise<RuntimeSession>;
}

/**
 * Production loader: the core SDK's resumeSession / createSession. `sources` lets the
 * no-Trace self-heal rebuild re-record a known origin into the fresh session_meta; with
 * no registry entry the rebuilt Session is unsourced, session_meta being the single
 * source of truth and none having survived. `opts.proxyEnv` threads the admin proxy
 * settings into core as a live getter (strip the proxy variables, inject an explicit
 * address, or null = pass the environment through).
 */
export function createCoreSessionLoader(
  root: string,
  sources?: SessionSources,
  opts: {
    proxyEnv?: () => ProxyEnvPolicy | null;
    confineSpawn?: () => SpawnConfiner | null;
  } = {},
): SessionLoader {
  return {
    async load(row: SessionRow): Promise<RuntimeSession> {
      const agent = await createAgent({
        root,
        projectId: row.projectId,
        agentId: row.agentId,
        ...(opts.proxyEnv ? { proxyEnv: opts.proxyEnv } : {}),
        ...(opts.confineSpawn ? { confineSpawn: opts.confineSpawn } : {}),
      });
      const located = await findLatestTraceFile(
        tracesDir(root, row.projectId, row.agentId),
        row.sessionId,
      );
      if (located) {
        // With a Trace: rebuild via Session Recovery (history injected via setHistory,
        // carrying over any residual state). Core's recognizable recovery failures
        // (Workspace deleted, Model removed from config, Trace missing session_meta) are
        // converged to 409 preserving the original message, rather than bubbling as 500.
        try {
          return await agent.resumeSession({ sessionId: row.sessionId });
        } catch (err) {
          // A credential deleted after the Session was created only surfaces here.
          if (isMissingCredential(err)) throw modelCredentialMissing(row.modelId);
          throw toUnrecoverableError(err);
        }
      }
      // No Trace (created but never run, and the process has restarted since): self-heal
      // rebuild. A missing Workspace → 409.
      try {
        const stat = await fs.stat(row.workspace);
        if (!stat.isDirectory()) throw new Error("not a directory");
      } catch {
        throw new HttpError(
          409,
          "workspace_missing",
          `This Session's Workspace no longer exists: ${row.workspace}, so it cannot continue. Create a new Session.`,
        );
      }
      const knownSource = sources?.get(row.sessionId);
      try {
        return await agent.createSession({
          workspaceDir: row.workspace,
          modelId: row.modelId,
          provider: row.provider,
          ...(knownSource != null ? { source: knownSource } : {}),
        });
      } catch (err) {
        if (isMissingCredential(err)) throw modelCredentialMissing(row.modelId);
        throw toUnrecoverableError(err);
      }
    },
  };
}

/** A plain Error thrown by core recovery/self-heal rebuild → 409 (preserving the original, actionable message). */
function toUnrecoverableError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  return new HttpError(
    409,
    "session_unrecoverable",
    err instanceof Error ? err.message : String(err),
  );
}

export interface UsageRecorderLike {
  record(ctx: UsageContext, msg: OmniMessage): Promise<void>;
}

export interface SessionManagerDeps {
  sessions: SessionsRepo;
  channels: ChannelHub;
  loader: SessionLoader;
  /** Session-origin registry (session_meta is the single source of truth; subagent registration records the forwarded meta's source here). */
  sources: SessionSources;
  recorder: UsageRecorderLike;
  /** Automatic Session title generation (optional: not injected in tests or when disabled). */
  titles?: TitleNotifier;
  /** Error persistence (optional: without it, only logs). */
  errors?: ErrorSink;
  log?: (line: string) => void;
  /** Goal run-state persistence (optional: without it, goals run but leave no restorable record). */
  goals?: GoalsRepo;
  /**
   * Publishes a Session-scoped event on the user-level channel of everyone who can see
   * the Project. The audience lookup (owner + members) stays in the app layer — the same
   * split the scheduler's `notify` uses, since this class holds no membership repos.
   */
  notifyProjectUsers?: (projectId: string, event: ServerEvent) => void;
  /**
   * Clock for persisted timestamps (last_active_at), injected so a stubbed clock moves
   * this and `usage_records.ts` together — the pairing the legacy backfill assumes when
   * it reads MAX(ts) as a session's last activity.
   */
  now?: () => Date;
  /**
   * The shared per-session agents table (see ./hmr-agent.ts): ONE map for the process,
   * riding the hot-resource registry when the platform wires it, so sessions survive a
   * platform swap. This manager attaches itself to every agent at construction. Optional:
   * tests and standalone embedders get a private table.
   */
  agents?: Map<string, HmrAgent>;
}

/**
 * A queued message's original content, held while it waits so a recall (DELETE /steer/:id,
 * DELETE /follow-ups/:id) can hand it back to the composer for editing (#287). `text` and
 * `images` are the same strings the queued input references; files stay on disk in the
 * Session scratchpad and are read back only at recall.
 */
export interface RecallStore {
  text: string;
  images: string[];
  files: RecallableFile[];
}

/** What quiesce() hands the swap's drain: work with no turn boundary, hard-aborted here. */
export interface QuiesceResult {
  /** Goal/compaction activity promises; adopted Task runs deliberately outlive the swap and are not listed. */
  aborted: Promise<void>[];
}

/** Agent idle eviction: same convention as the SSE channel (30 minutes of inactivity releases the memory). */
const ENTRY_IDLE_MS = 30 * 60 * 1000;
const ENTRY_SWEEP_INTERVAL_MS = 60 * 1000;

/** Composite Agent key (a Set key that cannot be confused by projectId/agentId concatenation). */
function agentKey(projectId: string, agentId: string): string {
  return `${projectId}\0${agentId}`;
}

function sessionNotFound(): HttpError {
  return new HttpError(
    404,
    "session_not_found",
    "Session does not exist or you do not have access.",
  );
}

export class SessionManager implements AgentImpl {
  private readonly agents: Map<string, HmrAgent>;
  private readonly stream: RunStream;
  private readonly log: (line: string) => void;
  /** Graceful-shutdown flag: once set, new Tasks/compactions are rejected (503). */
  private closed = false;
  /** Agents being deleted (key = agentKey): new Tasks/compactions are rejected with 409 for the window. */
  private readonly deletingAgents = new Set<string>();
  /** Sessions being deleted (guards against the agent/Trace being rebuilt and reviving it inside the window). */
  private readonly deletingSessions = new Set<string>();
  /** Per-Agent config generation (key = agentKey), bumped by invalidateAgentRuntimes. */
  private readonly agentGenerations = new Map<string, number>();
  private readonly sweepTimer: NodeJS.Timeout;
  private readonly now: () => Date;

  constructor(private readonly deps: SessionManagerDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
    this.now = deps.now ?? (() => new Date());
    this.agents = deps.agents ?? new Map();
    this.stream = new RunStream({
      channels: deps.channels,
      sessions: deps.sessions,
      sources: deps.sources,
      recorder: deps.recorder,
      ...(deps.titles ? { titles: deps.titles } : {}),
      ...(deps.errors ? { errors: deps.errors } : {}),
      log: this.log,
      now: this.now,
      publishState: (agent, state) => this.publishState(agent, state),
      publishEvent: (agent, event) => this.publishEvent(agent, event),
    });
    // Adoption: this generation takes over every surviving agent at its next turn
    // boundary — immediately when idle, and mid-run without interrupting anything.
    for (const a of this.agents.values()) a.setPending(this);
    this.sweepTimer = setInterval(() => this.sweepIdle(), ENTRY_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  // —— Query surface (Session listing / Agent active-count / SSE subscription replay) ——

  statusOf(sessionId: string): SessionStatus {
    return this.agents.get(sessionId)?.status ?? "idle";
  }

  pendingApprovalCount(sessionId: string): number {
    return this.agents.get(sessionId)?.approvals.size ?? 0;
  }

  pendingApprovals(sessionId: string): PendingApproval[] {
    return this.agents.get(sessionId)?.approvals.list() ?? [];
  }

  /** Queued follow-up tasks awaiting their turn, as display/recall info (the active event is never in the queue). */
  pendingFollowUpsOf(sessionId: string): PendingFollowUpInfo[] {
    const queue = this.agents.get(sessionId)?.queue ?? [];
    return queue
      .filter((e): e is Extract<AgentEvent, { type: "task" }> => e.type === "task")
      .map((f) => ({
        id: f.id,
        text: f.recall?.text ?? "",
        images: f.recall?.images.length ?? 0,
        files: f.recall?.files.length ?? 0,
      }));
  }

  pendingFollowUpCount(sessionId: string): number {
    return this.pendingFollowUpsOf(sessionId).length;
  }

  /** Steering messages queued but not yet delivered to the model (display mirror). */
  pendingSteeringOf(sessionId: string): PendingSteeringInfo[] {
    return (this.agents.get(sessionId)?.pendingSteering ?? []).map((p) => p.info);
  }

  /** Live tail of a running session (see live-tail.ts); scoped to runs this generation observes. */
  liveFragments(sessionId: string): OmniMessage[] {
    return this.stream.fragments(sessionId);
  }

  /**
   * The running Task's input messages as published at launch; empty when idle. The engine
   * writes these envelopes to the Trace only after the first run's bootstrap (MCP connect
   * + discovery), so GET /messages appends whichever the Trace read has not caught up to
   * — without it a client rebuilding history during the connect loses the user's message.
   */
  pendingInputs(sessionId: string): OmniMessage[] {
    return this.agents.get(sessionId)?.pendingInputs ?? [];
  }

  /** The running Task's streamed bootstrap records, held for the same reason as pendingInputs. */
  pendingBootstrap(sessionId: string): OmniMessage[] {
    return this.agents.get(sessionId)?.pendingBootstrap ?? [];
  }

  /** Number of Sessions for this Agent that are currently running / compacting. */
  activeCountForAgent(projectId: string, agentId: string): number {
    let n = 0;
    for (const a of this.agents.values()) {
      if (a.projectId === projectId && a.agentId === agentId && a.status !== "idle") n++;
    }
    return n;
  }

  /** Register a newly created Session's agent (idle), avoiding a redundant load on the next Task. */
  adopt(row: SessionRow, session: RuntimeSession): void {
    const agent = new HmrAgent(this, row);
    agent.session = session;
    agent.generation = this.generationOf(row.projectId, row.agentId);
    this.agents.set(row.sessionId, agent);
    this.registerSessionHooks(agent, session);
  }

  /**
   * The hooks every load path must install (ensureSession's loads, adopt's fresh
   * creations): the idle-arrival notice signal, queued as a `notices` event; and
   * live-forwarded background-subagent messages, published to the session channel and
   * recorded — a background child streams to the frontend past its launching turn's end.
   */
  private registerSessionHooks(agent: HmrAgent, session: RuntimeSession): void {
    session.onBackgroundNotice?.(() => agent.post({ type: "notices" }));
    session.onBackgroundMessage?.((msg) => {
      // A child producing messages IS session activity: without this stamp the idle sweep
      // measures only the launching task, and a long background run ages into eviction.
      agent.lastActivityMs = Date.now();
      this.deps.channels.get(agent.sessionId).publish(msg);
      const ctx = this.usageContext(agent);
      void this.deps.recorder.record(ctx, msg).catch((err: unknown) => {
        this.log(`[usage] Insert failed: ${err instanceof Error ? err.message : String(err)}`);
        this.deps.errors?.record({ source: "usage", err, ctx, code: "usage_insert_failed" });
      });
    });
  }

  /**
   * After an Agent's vault is updated: bump its config generation, so every Session
   * loaded before the update is reloaded at its next idle access (resume re-reads
   * agent_state/.vault.toml). A Task already in flight keeps the values it started with.
   */
  invalidateAgentRuntimes(projectId: string, agentId: string): void {
    this.agentGenerations.set(
      agentKey(projectId, agentId),
      this.generationOf(projectId, agentId) + 1,
    );
  }

  /**
   * After a Project's models/credentials change: same effective-value semantics, for
   * every Agent with a cached Session in this Project. Iterating is complete, not a
   * shortcut — an Agent with no cached Session builds fresh through the loader anyway.
   */
  invalidateProjectRuntimes(projectId: string): void {
    const agentIds = new Set<string>();
    for (const a of this.agents.values()) {
      if (a.projectId === projectId) agentIds.add(a.agentId);
    }
    for (const agentId of agentIds) this.invalidateAgentRuntimes(projectId, agentId);
  }

  // —— Submission surface (serialized per agent by HmrAgent.submit) ——

  /**
   * Lock-free rehearsal of startTask's 409/503 conditions, throwing the same HttpErrors.
   * **Advisory only** — it takes no lock and loads nothing, so a racing status change is
   * not caught; the authoritative check is inside the submission. It exists so a caller
   * with irreversible work to do first (POST /tasks writes file attachments to disk) can
   * learn about the ordinary "already running" rejection before doing it.
   */
  assertCanAcceptTask(sessionId: string, opts?: { queueIfBusy?: boolean }): void {
    this.assertAccepting(sessionId);
    const agent = this.agents.get(sessionId);
    if (agent && !opts?.queueIfBusy) this.assertAvailable(agent);
  }

  /**
   * Run a metadata operation at an idle Session boundary, under the submission lock Task
   * and compaction starts take. Session fork uses it to snapshot an append-only Trace
   * with no Task beginning between its status check and final read. A session with no
   * agent and no index row has nothing to serialize against (startTask would 404) and
   * runs the operation directly; neither path loads a heavyweight runtime.
   */
  async atIdleBoundary<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const agent = this.agentFor(sessionId);
    if (agent === null) {
      this.assertAccepting(sessionId);
      return operation();
    }
    return agent.submit(async () => {
      this.assertAccepting(agent.sessionId);
      this.assertAvailable(agent);
      return operation();
    });
  }

  /**
   * Start a Task: accept → the agent's queue → the pump opens the run (publishing the
   * input first) and advances it turn by turn. Returns the current actual session_id —
   * the load happens here, before acceptance, so the response carries the healed id and
   * load failures reach the caller rather than dying in the pump. With `queueIfBusy` a
   * busy session enqueues a follow-up (`queued: true`) instead of 409ing, keeping its
   * thinkingLevel for the eventual start.
   */
  async startTask(
    sessionId: string,
    input: OmniMessage[],
    opts?: { thinkingLevel?: ThinkingLevelName; queueIfBusy?: boolean; recall?: RecallStore },
  ): Promise<{ sessionId: string; queued: boolean }> {
    const agent = this.requireAgent(sessionId);
    return agent.submit(async () => {
      this.assertAccepting(agent.sessionId);
      const event: AgentEvent = {
        type: "task",
        id: randomUUID(),
        input,
        ...(opts?.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
        ...(opts?.recall !== undefined ? { recall: opts.recall } : {}),
      };
      if (this.isBusy(agent)) {
        if (!opts?.queueIfBusy) this.assertAvailable(agent); // throws the specific 409
        agent.post(event);
        agent.lastActivityMs = Date.now();
        // Re-publish so subscribers pick up the queued count; the input itself is
        // published when the follow-up actually starts.
        this.publishState(agent, agent.status);
        return { sessionId: agent.sessionId, queued: true };
      }
      await this.ensureSession(agent);
      // startTask resolves once the run is visibly started, not merely accepted.
      const started = new Promise<void>((resolve) => {
        event.started = resolve;
      });
      agent.post(event);
      await started;
      return { sessionId: agent.sessionId, queued: false };
    });
  }

  /**
   * Start a goal run: an immediate activity outside the queue — ONE `session.run(input,
   * { goal })` looping rounds until a terminal state, with the Session `running` for the
   * whole goal, so the abort endpoint interrupts the entire loop as usual. Progress goes
   * out as goal_* events and into goal_state (see ./goal-run.ts).
   */
  async startGoal(
    sessionId: string,
    args: {
      /** Round-1 input (route-validated to carry text; images may ride along); its marker-stripped text is the objective. */
      input: OmniMessage[];
      budget: number;
      thinkingLevel?: ThinkingLevelName;
    },
  ): Promise<{ sessionId: string }> {
    const agent = this.requireAgent(sessionId);
    return agent.submit(async () => {
      this.assertAccepting(agent.sessionId);
      this.assertAvailable(agent);
      await this.ensureSession(agent);
      // The objective is the user's own text with leading skill-invocation blocks
      // stripped — the same derivation core records in GOAL.yaml. `isPlainText` leaves
      // images out, so no `[attached image: <path>]` lines reach a status card or a
      // generated title; core keeps its own folded copy for what the rounds re-inject.
      const text = args.input
        .filter(isPlainText("user"))
        .map((msg) => msg.payload.text)
        .join("\n");
      const objective = stripLeadingMarkerBlocks(text).trim() || text.trim();
      agent.beginActivity("goal");
      const thinkingLevel = this.runThinkingLevel(agent.sessionId, args.thinkingLevel);
      const open = this.openRun(agent, "running", thinkingLevel);
      // Round-1 input takes the same pendingInputs hold as a task: core yields round
      // inputs onto the stream, but the Trace write still waits for the bootstrap.
      agent.pendingInputs = [...agent.pendingInputs, ...args.input];
      agent.pendingBootstrap = [];
      this.publishState(agent, "running");
      const goalId = this.deps.goals?.create({
        sessionId: agent.sessionId,
        projectId: agent.projectId,
        agentId: agent.agentId,
        objective,
        budget: args.budget,
      });
      this.publishEvent(agent, {
        type: "goal_started",
        sessionId: agent.sessionId,
        objective,
        budget: args.budget,
      });
      const gen = goalStream(
        {
          ...(this.deps.goals ? { goals: this.deps.goals } : {}),
          publishEvent: (a, e) => this.publishEvent(a, e),
        },
        agent,
        {
          session: open.session,
          input: args.input,
          budget: args.budget,
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
          approve: this.makeRunApprove(agent, open.session),
          signal: open.ac.signal,
          ...(goalId !== undefined ? { goalId } : {}),
        },
      );
      // The objective doubles as the title material (a task's input text plays that role).
      this.runActivity(agent, open, gen, { userExcerpt: objective });
      return { sessionId: agent.sessionId };
    });
  }

  /** Manually compact the context: 409 if busy. An immediate activity like a goal (hard-aborted by a swap). */
  async startCompact(sessionId: string): Promise<{ sessionId: string }> {
    const agent = this.requireAgent(sessionId);
    return agent.submit(async () => {
      this.assertAccepting(agent.sessionId);
      this.assertAvailable(agent);
      await this.ensureSession(agent);
      // With nothing to compact core's compact() yields no messages at all, so returning
      // 202 would leave the frontend waiting forever for a banner that never comes (the
      // "/compact does nothing after an interrupt" complaint). Refuse, and say which of
      // the two zero-turn states it is: "just compacted" and "haven't talked yet" share
      // `sessionTurns === 0` but are completely different messages to a user.
      const why = agent.session!.compactability();
      if (why !== "ok") throw compactUnavailable(why);
      agent.beginActivity("compact");
      const open = this.openRun(agent, "compacting", undefined);
      this.publishState(agent, "compacting");
      this.runActivity(agent, open, agent.session!.compact({ signal: open.ac.signal }));
      return { sessionId: agent.sessionId };
    });
  }

  /** Submit an approval decision; false when the pending approval doesn't exist (already decided/unknown). */
  decideApproval(sessionId: string, toolCallId: string, decision: "allow" | "deny"): boolean {
    return this.agents.get(sessionId)?.approvals.decide(toolCallId, decision) ?? false;
  }

  /**
   * Mid-run steering: core delivers it between turns as a standalone `[user_steering]`
   * user message followed by its images, through the stream the run already publishes.
   * 409 when no Task is in progress (idle / compacting / not loaded, or the run finished
   * in the race window) — the caller then submits it as a normal task instead.
   *
   * The mirrored summary is broadcast on `task_state` until the delivered message is seen
   * on the stream, which is what keeps the composer's "steering queued" hint alive across
   * reloads; `recall` is what a withdrawal hands back to the composer.
   */
  steer(sessionId: string, input: OmniMessage[], recall: RecallStore): void {
    const agent = this.agents.get(sessionId);
    if (!agent || agent.status !== "running" || !(agent.session?.steer(input) ?? false)) {
      throw new HttpError(
        409,
        "not_running",
        "This Session has no Task in progress; send the message as a new task instead.",
      );
    }
    agent.pendingSteering.push({
      info: {
        id: randomUUID(),
        text: recall.text,
        images: recall.images.length,
        files: recall.files.length,
      },
      input,
      recall,
    });
    agent.lastActivityMs = Date.now();
    this.publishState(agent, agent.status);
  }

  /**
   * Withdraw an undelivered steering message (#287) and hand its content back. 409
   * `not_pending` covers every "nothing left to take back": already delivered (core's
   * `unsteer` is authoritative — the mirror can lag until the message is seen on the
   * stream), the run exited, or the id is unknown.
   */
  recallSteering(sessionId: string, steerId: string): RecallStore {
    const agent = this.agents.get(sessionId);
    const i = agent?.pendingSteering.findIndex((p) => p.info.id === steerId) ?? -1;
    const pending = i >= 0 ? agent!.pendingSteering[i]! : undefined;
    if (!agent || !pending || !(agent.session?.unsteer?.(pending.input) ?? false)) {
      throw new HttpError(
        409,
        "not_pending",
        "This steering message was already delivered to the model and can no longer be recalled.",
      );
    }
    agent.pendingSteering.splice(i, 1);
    agent.lastActivityMs = Date.now();
    this.publishState(agent, agent.status);
    return pending.recall;
  }

  /**
   * Withdraw a queued follow-up before the pump reaches it (#287), handing back its
   * content and the thinking level it was queued with. 409 `not_pending` when it already
   * started, the agent was evicted (which empties the queue), or it carries no recall.
   */
  recallFollowUp(
    sessionId: string,
    followUpId: string,
  ): { recall: RecallStore; thinkingLevel?: ThinkingLevelName } {
    const agent = this.agents.get(sessionId);
    const i = agent?.queue.findIndex((e) => e.type === "task" && e.id === followUpId) ?? -1;
    const queued = i >= 0 ? (agent!.queue[i] as Extract<AgentEvent, { type: "task" }>) : undefined;
    if (!agent || !queued?.recall) {
      throw new HttpError(
        409,
        "not_pending",
        "This follow-up message already started and can no longer be recalled.",
      );
    }
    agent.queue.splice(i, 1);
    agent.lastActivityMs = Date.now();
    this.publishState(agent, agent.status);
    return {
      recall: queued.recall,
      ...(queued.thinkingLevel !== undefined ? { thinkingLevel: queued.thinkingLevel } : {}),
    };
  }

  /**
   * "Retry now" on the reconnect countdown: skip the backoff wait and fire the next retry
   * immediately, without consuming an extra attempt. False is a benign no-op — a wait
   * that elapsed right before the click must not surface as an error.
   */
  retryNow(sessionId: string): boolean {
    const agent = this.agents.get(sessionId);
    // Both running Tasks and compactions can be parked in a reconnect backoff.
    if (!agent || agent.status === "idle") return false;
    const skipped = agent.session?.skipReconnectWait() ?? false;
    if (skipped) agent.lastActivityMs = Date.now();
    return skipped;
  }

  /**
   * Interrupt the current Task/compaction: approvals converge to deny, then the
   * AbortSignal fires. False when nothing is in progress (the route answers 204). The
   * controller lives on the agent, so this reaches the run whichever generation drives it.
   */
  abortTask(sessionId: string): boolean {
    return this.agents.get(sessionId)?.interrupt() ?? false;
  }

  /**
   * Background command processes of a LOADED session (empty with no session object — a
   * reloaded Session starts with a fresh environment and could only report an empty list,
   * so nothing is resurrected just to answer a poll).
   */
  listProcesses(sessionId: string): BackgroundCommandInfo[] {
    return this.agents.get(sessionId)?.session?.listBackgroundCommands?.() ?? [];
  }

  /** Refreshes the listen-port probes behind the process list's `serviceUrl` before a listing. */
  async probeProcessServices(sessionId: string): Promise<void> {
    await this.agents.get(sessionId)?.session?.probeBackgroundCommandServices?.();
  }

  /** Kills one background command process; false when the session isn't loaded or the id is unknown. */
  killProcess(sessionId: string, processId: string): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    const killed = agent.session?.killBackgroundCommand?.(processId) ?? false;
    if (killed) agent.lastActivityMs = Date.now();
    return killed;
  }

  /**
   * Removes one EXITED background command from a loaded session's list. A running process
   * is refused — stopping is killProcess's job, and a bare removal must never
   * surprise-signal a live process group. "not_found" covers an unloaded session and an
   * unknown id alike. The only race (an entry observed running that exits before a retry)
   * is benign: the caller refreshes and sees it exited.
   *
   * What leaves with the row: the registry entry owns that process's captured output, so
   * afterwards input_command on the same process_id answers "unknown process_id".
   * Removal is a deliberate discard, which the Web App says at the button and in the docs.
   */
  removeProcess(sessionId: string, processId: string): "removed" | "running" | "not_found" {
    const agent = this.agents.get(sessionId);
    if (!agent) return "not_found";
    const info = agent.session?.listBackgroundCommands?.().find((p) => p.processId === processId);
    if (!info) return "not_found";
    if (info.running) return "running";
    if (!(agent.session?.killBackgroundCommand?.(processId) ?? false)) return "not_found";
    agent.lastActivityMs = Date.now();
    return "removed";
  }

  /**
   * Converge and drop every agent matching `match`, returning their in-flight activity
   * promises. Deletion callers await these before removing files, so interrupt-cleanup
   * Trace writes cannot recreate what was just deleted. Disposal is sequenced after the
   * activity settles, and takes the Session's background processes with it.
   */
  private dropAgents(match: (agent: HmrAgent) => boolean): Promise<void>[] {
    const runnings: Promise<void>[] = [];
    for (const [key, agent] of [...this.agents]) {
      if (!match(agent)) continue;
      agent.queue.length = 0;
      agent.interrupt();
      if (agent.running) runnings.push(agent.running);
      this.agents.delete(key);
      agent.disposeWhenSettled();
    }
    return runnings;
  }

  abortProject(projectId: string): Promise<void>[] {
    return this.dropAgents((a) => a.projectId === projectId);
  }

  /**
   * Before deleting an Agent: converge its runs, and mark it deleting so Tasks entering
   * during the deletion are rejected with 409 — closing the window where a new task
   * recreates the directory and revives an already-deleted Agent. The caller must call
   * endAgentDeletion when deletion finishes, success or failure.
   */
  beginAgentDeletion(projectId: string, agentId: string): Promise<void>[] {
    this.deletingAgents.add(agentKey(projectId, agentId));
    return this.dropAgents((a) => a.projectId === projectId && a.agentId === agentId);
  }

  endAgentDeletion(projectId: string, agentId: string): void {
    this.deletingAgents.delete(agentKey(projectId, agentId));
  }

  /** Before deleting a Session: same contract as beginAgentDeletion, scoped to one Session. */
  beginSessionDeletion(sessionId: string): Promise<void>[] {
    this.deletingSessions.add(sessionId);
    return this.dropAgents((a) => a.sessionId === sessionId);
  }

  endSessionDeletion(sessionId: string): void {
    this.deletingSessions.delete(sessionId);
  }

  /**
   * Hot-swap exit: the counterpart of shutdown() for a platform swap. New work is refused
   * from here (requests route to the successor anyway), but running Tasks are NOT
   * aborted — the successor adopts each agent and takes the next turn of the very same
   * run. Only goals and compactions, which have no turn boundary, are hard-aborted; their
   * promises gate the successor's boot exactly as shutdown's wait did.
   *
   * Returns immediately: the in-flight turns deliberately outlive this call.
   */
  quiesce(): QuiesceResult {
    this.closed = true;
    clearInterval(this.sweepTimer);
    const aborted: Promise<void>[] = [];
    for (const agent of this.agents.values()) {
      if (agent.activeKind !== "goal" && agent.activeKind !== "compact") continue;
      agent.interrupt();
      if (agent.running) aborted.push(agent.running);
    }
    return { aborted };
  }

  /** Graceful shutdown: reject new Tasks (503), interrupt everything, and wait for it (default ≤5s). */
  async shutdown(timeoutMs = 5000): Promise<void> {
    this.closed = true;
    clearInterval(this.sweepTimer);
    const pending = this.dropAgents(() => true);
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
    ]);
  }

  /**
   * Idle eviction: drops agents that are idle and unpinned past the timeout, releasing
   * the Session's in-memory history. Pure memory reclamation — the next access recreates
   * the agent and re-resumes via the loader. `now` / `idleMs` are injectable for tests.
   */
  sweepIdle(now: number = Date.now(), idleMs: number = ENTRY_IDLE_MS): void {
    for (const [key, agent] of this.agents) {
      if (agent.evictable(now, idleMs)) this.agents.delete(key);
    }
  }

  // —— AgentImpl: one turn of the head event, invoked by the pump ——

  async process(agent: HmrAgent, event: AgentEvent): Promise<"more" | "done"> {
    try {
      // An open run — including one adopted from the previous generation mid-run —
      // continues on its own Session; everything around the turn is this generation's.
      if (agent.activeRun !== null) return await this.stepRun(agent, agent.activeRun);
      if (this.refusesStart(agent.sessionId)) {
        if (event.type === "task") event.started?.();
        return "done";
      }
      return event.type === "task"
        ? await this.beginTask(agent, event)
        : await this.beginNotices(agent);
    } catch (err) {
      // Queued work has no HTTP caller to surface to (an immediate task loads at
      // submission): log, leave nothing half-open, retire the event.
      this.log(
        `[session] queued event failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (event.type === "task") event.started?.();
      if (agent.activeRun !== null) this.finishRun(agent, agent.activeRun);
      else if (agent.status !== "idle") {
        agent.status = "idle";
        agent.abort = null;
        this.publishState(agent, "idle");
      }
      return "done";
    }
  }

  /** First call of a `task` event: publish the input, open the run, take its first turn. */
  private async beginTask(
    agent: HmrAgent,
    event: Extract<AgentEvent, { type: "task" }>,
  ): Promise<"more" | "done"> {
    await this.ensureSession(agent);
    const open = this.openRun(
      agent,
      "running",
      this.runThinkingLevel(agent.sessionId, event.thinkingLevel),
    );
    // Publish the input first (the Trace is the SDK's job), then flip to running. The
    // same envelopes are held as pendingInputs until the engine's Trace write catches up.
    // APPEND, don't replace: input from a run aborted mid-bootstrap never reached the
    // Trace, core carries it into this run, and it must stay served until persisted. The
    // previous attempt's bootstrap records are dropped instead — this run streams its own
    // connect phase, and a stale aborted pair would render as an extra row.
    agent.pendingInputs = [...agent.pendingInputs, ...event.input];
    agent.pendingBootstrap = [];
    const channel = this.deps.channels.get(agent.sessionId);
    for (const msg of event.input) channel.publish(msg);
    this.publishState(agent, "running");
    // Visibly started: release the submission BEFORE the first turn, whose first-run
    // bootstrap (MCP connect) can take seconds the caller must not wait out.
    event.started?.();
    // The input's user text is the whole title source: the fallback is persisted at once
    // and the LLM replacement requested without waiting for any model output.
    const userExcerpt = event.input
      .filter(isPlainText("user"))
      .map((msg) => msg.payload.text)
      .join("\n");
    this.beginRunBookkeeping(agent, open, { userExcerpt });
    const runOpts = {
      approve: this.makeRunApprove(agent, open.session),
      signal: open.ac.signal,
      ...(open.thinkingLevel !== undefined ? { thinkingLevel: open.thinkingLevel } : {}),
    };
    if (open.session.beginRun === undefined) {
      // No stepped surface (test fakes, older embedders): one whole, un-swappable run.
      await this.consume(agent, open, open.session.run(event.input, runOpts));
      this.finishRun(agent, open);
      return "done";
    }
    const step = await this.consume(agent, open, open.session.beginRun(event.input, runOpts));
    return this.verdict(agent, open, step);
  }

  /** First call of a `notices` event: deliver queued background completion notices as a task. */
  private async beginNotices(agent: HmrAgent): Promise<"more" | "done"> {
    // The notices live in the loaded Session object; with none loaded they left with it.
    const input = agent.session?.takeBackgroundNotices?.() ?? [];
    if (input.length === 0) return "done";
    return this.beginTask(agent, { type: "task", id: randomUUID(), input });
  }

  /** A later call: one turn of the open run. */
  private async stepRun(agent: HmrAgent, open: OpenRun): Promise<"more" | "done"> {
    return this.verdict(agent, open, await this.consume(agent, open, open.session.stepRun!()));
  }

  /** Closes the run unless the step asked for another turn. */
  private verdict(agent: HmrAgent, open: OpenRun, step: "continue" | "done"): "more" | "done" {
    if (step === "continue") return "more";
    this.finishRun(agent, open);
    return "done";
  }

  // —— Run mechanics ——

  /** Opens the run bundle and flips the agent's live-control fields. */
  private openRun(
    agent: HmrAgent,
    status: SessionStatus,
    thinkingLevel: ThinkingLevelName | undefined,
  ): OpenRun {
    const ac = new AbortController();
    let settle: () => void = () => {};
    agent.running = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const open: OpenRun = {
      session: agent.session!,
      ac,
      ctx: this.usageContext(agent),
      thinkingLevel,
      settle,
    };
    agent.activeRun = open;
    agent.status = status;
    agent.abort = ac;
    agent.lastActivityMs = Date.now();
    return open;
  }

  /** Per-run start bookkeeping, shared by tasks, goals and compactions. */
  private beginRunBookkeeping(
    agent: HmrAgent,
    open: OpenRun,
    titleSource?: { userExcerpt: string },
  ): void {
    if (titleSource?.userExcerpt.trim()) {
      this.deps.titles?.maybeGenerate(open.ctx, open.session, {
        fallbackText: titleSource.userExcerpt,
        material: { userText: titleSource.userExcerpt, assistantText: "" },
      });
    }
    // Every run writes Trace lines: flip the row's has_trace cache at this single choke
    // point so listing serves it from the DB without a directory walk. The same statement
    // stamps last_active_at, so a run costs one row write here and one at its end — never
    // one per streamed message. Guarded, so a DB failure cannot strand the run.
    this.touchRow(open.ctx, (repo, at) => repo.markDriven(open.ctx.sessionId, at));
  }

  /** Runs a whole immediate activity (goal, compaction) to its end and releases the queue. */
  private runActivity(
    agent: HmrAgent,
    open: OpenRun,
    gen: AsyncGenerator<OmniMessage>,
    titleSource?: { userExcerpt: string },
  ): void {
    void (async () => {
      this.beginRunBookkeeping(agent, open, titleSource);
      await this.consume(agent, open, gen);
      this.finishRun(agent, open);
      agent.finishActivity();
    })();
  }

  /**
   * Consumes one step generator (or a whole activity), running the message pipeline on
   * every message. Never throws: core converges failures into the stream, so a throw here
   * is a defect — recorded, and the step reads as done.
   */
  private async consume<R>(
    agent: HmrAgent,
    open: OpenRun,
    gen: AsyncGenerator<OmniMessage, R>,
  ): Promise<R | "done"> {
    try {
      for (;;) {
        const n = await gen.next();
        if (n.done) return n.value;
        await this.stream.observe(agent, open, n.value);
      }
    } catch (err) {
      this.log(
        `[session] Run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      this.deps.errors?.record({
        source: "session",
        err,
        ctx: open.ctx,
        code: "session_run_failed",
      });
      return "done";
    }
  }

  /** The run-end wrap-up, shared by every run kind. */
  private finishRun(agent: HmrAgent, open: OpenRun): void {
    // Pair every begin with an end: the steering window shuts and core's idle-arrival
    // signals resume. Idempotent, and a no-op for the whole-run path.
    open.session.endRun?.();
    this.stream.close(agent, open);
    // The pending holds are NOT cleared: a run aborted mid-bootstrap wrote nothing to the
    // Trace, so its held input is the only copy a reload can show until the next run
    // carries it forward. Runs that issued a request cleared them at request_begin.
    agent.approvals.denyAll();
    agent.status = "idle";
    agent.abort = null;
    agent.activeRun = null;
    agent.running = null;
    // Retired here, atomically with the idle flip: an observer that sees idle must also
    // see the agent available, not one microtask later.
    agent.activeEvent = null;
    agent.activeKind = null;
    // The run is over, so core discarded any undelivered steering — drop the mirror with
    // it, and let the idle publish broadcast the now-empty state.
    agent.pendingSteering = [];
    agent.lastActivityMs = Date.now();
    // Guarded like every write here: the idle broadcast must not be skippable by a DB
    // failure, or SSE clients would sit on "running" forever. A no-op UPDATE when the row
    // is already gone, which only happens once a deletion's 5s wait times out.
    this.touchRow(open.ctx, (repo, at) => repo.touchLastActive(open.ctx.sessionId, at));
    this.publishState(agent, "idle");
    open.settle();
    // Notices that raced this run's exit (arrived after its last input-assembly boundary):
    // queue their delivery unless queued work will drain the same queue anyway.
    if (agent.queue.length === 0 && (agent.session?.hasPendingBackgroundNotices?.() ?? false)) {
      agent.post({ type: "notices" });
    }
  }

  /** The per-run approval callback; re-reads approval_mode on every decision, so a PATCH takes effect immediately. */
  private makeRunApprove(agent: HmrAgent, session: RuntimeSession): ApproveFn {
    return makeApprove({
      getMode: () => this.deps.sessions.findById(agent.sessionId)?.approvalMode ?? "always-ask",
      toolPermission: (name) => session.toolPermission(name),
      registry: agent.approvals,
      publishRequest: (pending) =>
        this.publishEvent(agent, {
          type: "approval_request",
          toolCall: pending.toolCall,
          ...(pending.origin !== undefined ? { origin: pending.origin } : {}),
        }),
    });
  }

  // —— Internal ——

  private usageContext(agent: HmrAgent): UsageContext {
    return {
      projectId: agent.projectId,
      agentId: agent.agentId,
      sessionId: agent.sessionId,
      provider: agent.provider,
      modelId: agent.modelId,
    };
  }

  /** Whether a queued event's start must be skipped: shutting down, or a deletion window is open. */
  private refusesStart(sessionId: string): boolean {
    if (this.closed || this.deletingSessions.has(sessionId)) return true;
    const row = this.deps.sessions.findById(sessionId);
    if (!row) return true;
    return this.deletingAgents.has(agentKey(row.projectId, row.agentId));
  }

  /** Whether new immediate work must be refused or queued: an activity in flight, or events waiting. */
  private isBusy(agent: HmrAgent): boolean {
    return agent.status !== "idle" || agent.activeKind !== null || agent.queue.length > 0;
  }

  /** The session's agent, or a fresh one from its index row; 404 when the row does not exist. */
  private requireAgent(sessionId: string): HmrAgent {
    const agent = this.agentFor(sessionId);
    if (agent === null) throw sessionNotFound();
    return agent;
  }

  /** Get-or-create WITHOUT loading a Session (that happens in the submission or the pump); null when no index row exists. */
  private agentFor(sessionId: string): HmrAgent | null {
    const existing = this.agents.get(sessionId);
    if (existing) return existing;
    const row = this.deps.sessions.findById(sessionId);
    if (!row) return null;
    const agent = new HmrAgent(this, row);
    this.agents.set(sessionId, agent);
    return agent;
  }

  /** The three refusals every submission opens with: shutting down, Agent deleting, Session deleting. */
  private assertAccepting(sessionId: string): void {
    if (this.closed) {
      throw new HttpError(
        503,
        "shutting_down",
        "Server is shutting down; not accepting new Tasks.",
      );
    }
    if (this.deletingSessions.has(sessionId)) {
      throw new HttpError(
        409,
        "session_deleting",
        "This Session is being deleted; not accepting new Tasks.",
      );
    }
    const row = this.deps.sessions.findById(sessionId);
    if (row && this.deletingAgents.has(agentKey(row.projectId, row.agentId))) {
      throw new HttpError(
        409,
        "agent_deleting",
        "This Agent is being deleted; not accepting new Tasks.",
      );
    }
  }

  /** Busy → the specific 409 (queued-but-not-started work counts as a Task in progress). */
  private assertAvailable(agent: HmrAgent): void {
    if (agent.status === "compacting" || agent.activeKind === "compact") {
      throw new HttpError(
        409,
        "compacting",
        "This Session is compacting its context; not accepting new input.",
      );
    }
    if (this.isBusy(agent)) {
      throw new HttpError(409, "task_in_progress", "This Session already has a Task in progress.");
    }
  }

  private generationOf(projectId: string, agentId: string): number {
    return this.agentGenerations.get(agentKey(projectId, agentId)) ?? 0;
  }

  /**
   * get-or-resume-or-heal: reuse the loaded Session while it is current; reload when none
   * is held (fresh agent, evicted) or when it went stale — a vault/model update, or a
   * platform swap marking the previous generation's Session (STALE_SESSION). A stale
   * Session is kept while busy: the in-flight run finishes with the values it started
   * with, and the reload happens at the next idle access. Self-heal may produce a new
   * session_id, which the index's primary key and the agents table follow.
   */
  private async ensureSession(agent: HmrAgent): Promise<void> {
    if (agent.session !== null) {
      if (agent.generation === this.generationOf(agent.projectId, agent.agentId)) return;
      if (agent.status !== "idle" || agent.running !== null || agent.approvals.size !== 0) return;
      agent.session.dispose?.();
      agent.session = null;
    }
    const row = this.deps.sessions.findById(agent.sessionId);
    if (!row) throw sessionNotFound();
    // Captured before the awaited load: an update racing it leaves this Session stale, so
    // the access after next rebuilds it with the new values.
    const generation = this.generationOf(row.projectId, row.agentId);
    const session = await this.deps.loader.load(row);
    // Marked for deletion while loading: discard the result rather than reviving an
    // orphaned Trace.
    this.assertAccepting(row.sessionId);
    if (session.sessionId !== row.sessionId) {
      // Self-heal produced a new session_id: move the index's primary key and re-key the
      // shared table. The SSE channel and pending state are naturally empty for it.
      this.deps.sessions.replaceId(row.sessionId, session.sessionId);
      this.agents.delete(agent.sessionId);
      agent.sessionId = session.sessionId;
      this.agents.set(agent.sessionId, agent);
    }
    agent.session = session;
    agent.generation = generation;
    agent.lastActivityMs = Date.now();
    this.registerSessionHooks(agent, session);
  }

  /**
   * Thinking level for one run: the request's own level wins, else the level pinned on the
   * Session row (the Web App's in-chat picker), else undefined so core falls back to the
   * Agent config. Resolved at START time, so a queued follow-up picks up the pin as it
   * stands when it finally starts, and a pin set mid-run applies from the next run.
   */
  private runThinkingLevel(
    sessionId: string,
    requested?: ThinkingLevelName,
  ): ThinkingLevelName | undefined {
    return requested ?? this.deps.sessions.findById(sessionId)?.thinkingLevel ?? undefined;
  }

  /**
   * One `sessions` row write for a run's bookkeeping, swallowing failures the way the
   * per-message recorder call does: bookkeeping must never take down a run's lifecycle.
   * The realistic failure is the DatabaseSync handle closed by shutdown while a run
   * outlived its drain window (ERR_INVALID_STATE).
   */
  private touchRow(ctx: UsageContext, write: (repo: SessionsRepo, at: string) => void): void {
    try {
      write(this.deps.sessions, this.now().toISOString());
    } catch (err) {
      this.log(
        `[session] last-active bookkeeping failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.deps.errors?.record({ source: "session", err, ctx, code: "session_touch_failed" });
    }
  }

  private publishState(agent: HmrAgent, state: SessionStatus): void {
    // Every flip carries the queued-follow-up and steering hints, so subscribers render
    // both without a dedicated event type.
    const followUps = this.pendingFollowUpsOf(agent.sessionId);
    this.publishEvent(agent, {
      type: "task_state",
      state,
      queued: followUps.length,
      ...(agent.pendingSteering.length > 0
        ? { pendingSteering: agent.pendingSteering.map((p) => p.info) }
        : {}),
      ...(followUps.length > 0 ? { pendingFollowUps: followUps } : {}),
    });
    // The same flip on the user channel, carrying the Session id: a tab subscribes to the
    // ONE conversation it has open, so the event above can never move another row's badge.
    // The queued/steering hints stay session-scoped — they belong to the composer.
    const notify = this.deps.notifyProjectUsers;
    if (!notify) return;
    let lastActiveAt: string;
    let hasTrace: boolean;
    try {
      // Read the stamp back rather than reconstruct it: the run-end flip is published
      // right after the write that stamps it, so this is what a list fetch would return
      // and no clock of ours has to agree with the one that wrote it.
      const row = this.deps.sessions.findById(agent.sessionId);
      if (!row) return; // Row already deleted: no list row left to light up.
      lastActiveAt = row.lastActiveAt;
      // A running Session has by definition started a Task, whatever the row cache says
      // yet: markDriven runs at the run's start, after the first "running" is published.
      // Reporting the raw flag there would tell a client the Session never ran at the
      // exact moment it visibly is running.
      hasTrace = row.hasTrace === true || state !== "idle";
    } catch {
      // The failure touchRow guards against; a list badge is never worth breaking a run's
      // wrap-up over.
      return;
    }
    notify(agent.projectId, {
      type: "session_state",
      sessionId: agent.sessionId,
      state,
      lastActiveAt,
      hasTrace,
    });
  }

  private publishEvent(agent: HmrAgent, event: ServerEvent): void {
    this.deps.channels.get(agent.sessionId).publish(event, "server_event");
  }
}
