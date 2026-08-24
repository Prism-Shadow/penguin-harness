/**
 * Active Session runtime — the facade and per-generation code behind the HmrAgent event
 * loop (see ./hmr-agent.ts, the ownership model's spec).
 *
 * All per-session cross-generation state lives in an HmrAgent: the event queue, run
 * status, pending approvals, the interrupt controller, display mirrors. This class holds
 * none of it. What it owns is generation-scoped:
 *   - the AgentImpl the agents' pump calls (`process`: open the head event's run and
 *     advance it one TURN per call; `suspend`: close the open run at a swap boundary) —
 *     policy code a hot swap replaces wholesale through the agent's pointer swap;
 *   - the submission surface (startTask/startGoal/startCompact and the query/control
 *     facade the routes call), serialized per agent by HmrAgent.submit;
 *   - cross-session guards (graceful shutdown, Agent/Session deletion windows), the
 *     per-Agent config generations behind vault invalidation, the idle sweep, and the
 *     live-tail cache of runs THIS generation drives.
 *
 * Responsibilities inherited from the pre-event-loop design, unchanged in meaning:
 *   - get-or-resume-or-heal (ensureSession): recover via Trace, or self-heal rebuild
 *     with a new session_id (the index's primary key and the agents table follow);
 *   - Vault effectiveness: a vault update bumps the Agent's config generation; sessions
 *     loaded earlier are reloaded at their next idle access;
 *   - Per-Session mutual exclusion: one Task/compaction at a time (the agent's queue and
 *     activity slot);
 *   - Streaming: every message a run yields is published to the SSE channel and handed
 *     to usage-recorder; run completion resets to idle and pushes task_state;
 *   - Approvals and interrupts: each decision re-reads approval_mode from the DB; an
 *     interrupt converges pending approvals to deny, then aborts.
 *
 * The underlying implementation of get-or-resume-or-heal is injected via
 * `SessionLoader`: production uses the core SDK (createCoreSessionLoader), tests inject
 * a fake Session (issuing no real LLM requests).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createAgent,
  findLatestTraceFile,
  goalFinishedOf,
  goalTokenDelta,
  isGoalRoundInput,
  isSessionMeta,
  parseUserSteeringText,
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
  SessionMetaPayload,
  SessionTitleResult,
  TextPayload,
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
import { HmrAgent } from "./hmr-agent.js";
import type { AgentEvent, AgentImpl } from "./hmr-agent.js";
import { LiveTailTracker } from "./live-tail.js";
import { asSessionSource } from "./session-sources.js";
import type { SessionSources } from "./session-sources.js";
import { StreamErrorWatcher } from "./stream-error-watcher.js";
import type { TitleNotifier } from "./title-generator.js";
import type { UsageContext } from "./usage-recorder.js";

/**
 * 409 for when there's nothing to compact: give the specific reason rather than a
 * one-size-fits-none message.
 *
 * Each reason carries its **own code**, not just its own message. Clients localize by code
 * (the Web's `apiErrorText` looks the code up in a table and falls back to the raw English
 * message), so one shared code leaves exactly two bad options: flatten three unrelated
 * explanations into one vague sentence, or let English prose reach a non-English UI. One code
 * per sub-reason is how the rest of this API splits a refusal — `dir_not_absolute` /
 * `dir_not_found` / `not_a_dir` are three codes for three ways of rejecting one directory.
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
   * The stepped run (core Session.beginRun/stepRun/endRun): begin opens the run and the
   * driver takes one turn per stepRun until "done", pairing every beginRun with endRun.
   * This is what gives the HmrAgent pump its turn-boundary swap points. Optional: a
   * session without it (test fakes, older embedders) is driven through `run` in one
   * un-swappable piece instead.
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
   * Withdraws a steering input queued via `steer` before core delivers it (core
   * `Session.unsteer`, matched by input-list identity); false when it is no longer queued —
   * already delivered, or the run exited. Optional: test fakes may omit it, in which case
   * every recall reports "already delivered".
   */
  unsteer?(input: OmniMessage[]): boolean;
  /** Skips the in-progress reconnect backoff, firing the next retry immediately (core `Session.skipReconnectWait`); false when no wait is in progress. */
  skipReconnectWait(): boolean;
  toolPermission(name: string): "r" | "rw" | undefined;
  /**
   * Out-of-band one-shot request for title generation (core `Session.generateTitle`,
   * writes no history/Trace). Material defaults to what the Session collects itself
   * (the first Task's text gathered during run); `material` overrides this for
   * subagents.
   */
  generateTitle(args?: {
    material?: { userText: string; assistantText: string };
    signal?: AbortSignal;
  }): Promise<SessionTitleResult>;
  /**
   * Subscribes the idle-arrival signal for background-task completion notices (core
   * `Session.onBackgroundNotice`): fired when a `run_in_background` launch settles while no
   * Task is running — delivery is then queued as a `notices` event. Optional: test fakes
   * may omit it.
   */
  onBackgroundNotice?(listener: () => void): void;
  /** Takes the queued background completion notices as task input (core `Session.takeBackgroundNotices`). Optional, like onBackgroundNotice. */
  takeBackgroundNotices?(): OmniMessage[];
  /** Whether completion notices are still queued (core `Session.hasPendingBackgroundNotices`); pins the agent against idle eviction. Optional, like onBackgroundNotice. */
  hasPendingBackgroundNotices?(): boolean;
  /** Refreshes the listen-port probes behind the process list's `serviceUrl` (core `Session.probeBackgroundCommandServices`). Optional: test fakes may omit it. */
  probeBackgroundCommandServices?(): Promise<void>;
  /** Subscribes live-forwarded background-subagent messages (core `Session.onBackgroundMessage`); the manager publishes them to the session channel. Optional: test fakes may omit it. */
  onBackgroundMessage?(listener: (msg: OmniMessage) => void): void;
  /** Background command processes owned by the Session's environment (core `Session.listBackgroundCommands`). Optional: test fakes may omit it. */
  listBackgroundCommands?(): BackgroundCommandInfo[];
  /** Kills one background command process (core `Session.killBackgroundCommand`); false when the id is unknown. Optional, like listBackgroundCommands. */
  killBackgroundCommand?(processId: string): boolean;
  /** Whether a background subagent is mid-round (core `Session.hasRunningBackgroundSubagents`); pins the agent against idle eviction. Optional, like listBackgroundCommands. */
  hasRunningBackgroundSubagents?(): boolean;
  /** Releases environment resources — kills the remaining background processes (core `Session.dispose`). Optional, idempotent. */
  dispose?(): void;
}

/** The underlying loader behind get-or-resume-or-heal. */
export interface SessionLoader {
  /**
   * Load a runtime Session from an index row: recover (with a Trace) or self-heal
   * rebuild (no Trace, session_id will change). Throws HttpError(409) for unrecoverable
   * cases such as a missing Workspace.
   */
  load(row: SessionRow): Promise<RuntimeSession>;
}

/**
 * Production loader: the core SDK's resumeSession / createSession. `sources` (when given)
 * lets the no-Trace self-heal rebuild re-record a known origin into the fresh session_meta;
 * with no registry entry (e.g. the process restarted and no Trace was ever written) the
 * rebuilt Session is unsourced — session_meta is the single source of truth, and none survived.
 * `opts.proxyEnv` threads the admin proxy settings into core (a live getter returning the
 * agent-command-subprocess policy: strip the proxy variables, inject the explicit proxy
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
        // With a Trace: rebuild via "Session Recovery" (history injected via setHistory,
        // carrying over any residual state).
        // core's recognizable recovery failures (Workspace deleted / Model removed from
        // config / Trace missing session_meta, etc.) are converged to 409, preserving
        // the original message rather than bubbling up as 500.
        try {
          return await agent.resumeSession({ sessionId: row.sessionId });
        } catch (err) {
          // The credential key was deleted after the Session was created: only caught
          // here at recovery time; give the same actionable message.
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
          // The rebuilt Session re-records a known origin in its fresh session_meta.
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
  /** Error persistence (optional: without it, only logs — same as before this was wired up). */
  errors?: ErrorSink;
  log?: (line: string) => void;
  /** Goal run-state persistence (optional like `titles`: without it, goals run but leave no restorable record). */
  goals?: GoalsRepo;
  /**
   * Publishes a Session-scoped event on the user-level channel of everyone who can see the
   * Project. The audience lookup (owner + members) and the `user:<id>` channel binding stay in
   * the app layer, the same split the scheduler's `notify` uses — this class holds no Project
   * membership repos. Optional: without it only the per-Session channel is served, which is
   * what unit tests that don't wire it get.
   */
  notifyProjectUsers?: (projectId: string, event: ServerEvent) => void;
  /**
   * Clock for persisted timestamps (last_active_at). Injected like the other services' so a
   * stubbed clock moves this and `usage_records.ts` together — the pairing the legacy
   * backfill assumes when it reads MAX(ts) as a session's last activity.
   */
  now?: () => Date;
  /**
   * The shared per-session agents table (see ./hmr-agent.ts): ONE map for the whole
   * process, riding the hot-resource registry when the platform wires it so the agents —
   * with the queues, runs and mirrors they hold — survive a platform swap. This manager
   * attaches itself to every agent at construction (setPending). Optional: tests and
   * standalone embedders get a private table.
   */
  agents?: Map<string, HmrAgent>;
}

/**
 * A queued message's original content, held while it waits in a queue so a recall (DELETE
 * /steer/:id, DELETE /follow-ups/:id) can hand it back to the composer for editing (#287).
 * `text` and `images` are the same strings the queued input already references (no extra
 * copy); files stay on disk in the Session scratchpad and are read back only at recall.
 */
export interface RecallStore {
  text: string;
  images: string[];
  files: RecallableFile[];
}

/** What quiesce() hands the swap's drain: hard-aborted work the successor's boot should still wait out. */
export interface QuiesceResult {
  /** Activity promises of hard-aborted goals/compactions: suspended Task runs deliberately outlive the swap and are not listed. */
  aborted: Promise<void>[];
}

/** Agent idle eviction: same convention as the SSE channel (an idle agent with no activity for 30 minutes releases its memory). */
const ENTRY_IDLE_MS = 30 * 60 * 1000;
const ENTRY_SWEEP_INTERVAL_MS = 60 * 1000;

/** Composite Agent key (used as a Set key, avoiding projectId/agentId concatenation ambiguity). */
function agentKey(projectId: string, agentId: string): string {
  return `${projectId}\0${agentId}`;
}

/** If msg is a run_subagent tool call carrying a `prompt`, return its id and prompt (for use as the subagent's title); otherwise null. */
/** Whether this main-stream message is a delivered `[user_steering]` user text (one per queued steering entry, see core's steeringMessages). */
function isDeliveredSteering(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; role?: string; text?: string };
  if (msg.type !== "model_msg" || p.type !== "text" || p.role !== "user") return false;
  return typeof p.text === "string" && parseUserSteeringText(p.text) !== null;
}

function runSubagentCall(msg: OmniMessage): { toolCallId: string; prompt: string } | null {
  const p = msg.payload as {
    type?: string;
    name?: string;
    arguments?: string;
    tool_call_id?: string;
  };
  if (msg.type !== "model_msg" || p.type !== "tool_call" || p.name !== "run_subagent") return null;
  if (typeof p.arguments !== "string" || typeof p.tool_call_id !== "string") return null;
  try {
    const args = JSON.parse(p.arguments) as { prompt?: unknown };
    if (typeof args.prompt !== "string" || !args.prompt.trim()) return null;
    return { toolCallId: p.tool_call_id, prompt: args.prompt };
  } catch {
    return null; // Arguments were truncated/malformed: this call is doomed, no subagent will result
  }
}

/** The denied tool_call_id (approval_decision with decision ≠ allow); otherwise null. */
function deniedToolCallId(msg: OmniMessage): string | null {
  const p = msg.payload as { type?: string; decision?: string; tool_call_id?: string };
  if (msg.type !== "event_msg" || p.type !== "approval_decision") return null;
  if (p.decision === "allow" || typeof p.tool_call_id !== "string") return null;
  return p.tool_call_id;
}

/** The tool_call_id of a parent-level tool call that has settled (a complete tool_call_output); otherwise null. */
function settledToolCallId(msg: OmniMessage): string | null {
  const p = msg.payload as { type?: string; tool_call_id?: string };
  if (msg.type !== "model_msg" || p.type !== "tool_call_output") return null;
  return typeof p.tool_call_id === "string" ? p.tool_call_id : null;
}

/** A subagent registered during this run, plus its title material. */
interface ChildSession {
  sessionId: string;
  agentId: string;
  /** The prompt of the run_subagent call that spawned it (user material for title generation, and the fallback title). */
  prompt: string;
}

/** Predicate for a plain-text message on the main session (no origin): title material is drawn only from user/model text. */
function isPlainText(role: "user" | "assistant") {
  return (msg: OmniMessage): msg is OmniMessage<TextPayload> => {
    const payload = msg.payload as { type?: string; role?: string };
    return (
      msg.type === "model_msg" &&
      payload.type === "text" &&
      payload.role === role &&
      (!msg.origin || msg.origin.length === 0)
    );
  };
}

/**
 * The open run of one activity: everything a run spans turns with, created at begin and
 * closed at finish or suspend. Generation-owned and generation-bound — a run never
 * crosses a swap (see HmrAgent), so none of this needs to be adoptable.
 */
interface OpenRun {
  session: RuntimeSession;
  ac: AbortController;
  ctx: UsageContext;
  thinkingLevel: ThinkingLevelName | undefined;
  /** Stream-error persistence for this run (core converges failures into the stream, not throws). */
  watcher: StreamErrorWatcher | null;
  /** Subagents registered during this run (keyed by session id); each gets its title at registration. */
  children: Map<string, ChildSession>;
  /** Unclaimed run_subagent prompts, in call order (see observeMessage's pairing notes). */
  subagentPrompts: Map<string, string>;
  /** Resolves `agent.running` when the run closes (finish or suspend); what deletion/shutdown paths await. */
  settle: () => void;
}

export class SessionManager implements AgentImpl {
  /** The shared agents table (see SessionManagerDeps.agents). */
  private readonly agents: Map<string, HmrAgent>;
  private readonly log: (line: string) => void;
  /** Graceful-shutdown flag: once set, new Tasks/compactions are rejected (503). */
  private closed = false;
  /** Agents currently being deleted (key = agentKey): new Tasks/compactions are always rejected with 409 during this window. */
  private readonly deletingAgents = new Set<string>();
  /** Sessions currently being deleted (guards against the agent/Trace file being rebuilt and reviving it inside the deletion race window). */
  private readonly deletingSessions = new Set<string>();
  /** Per-Agent config generation (key = agentKey), bumped by invalidateAgentRuntimes on vault updates. */
  private readonly agentGenerations = new Map<string, number>();
  /** Open streaming fragments of runs THIS generation drives (fed by the run paths, served to GET /messages; see live-tail.ts). */
  private readonly liveTail = new LiveTailTracker();
  private readonly sweepTimer: NodeJS.Timeout;
  /** Clock for persisted timestamps (see SessionManagerDeps.now); wall clock unless injected. */
  private readonly now: () => Date;

  constructor(private readonly deps: SessionManagerDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
    this.now = deps.now ?? (() => new Date());
    this.agents = deps.agents ?? new Map();
    // Adoption: attach this generation to every surviving agent. An idle agent swaps its
    // code pointer at the pump's next boundary check — immediately; one with a run in
    // flight swaps at its next turn boundary, where the old generation suspends the run
    // and THIS generation finishes it from the Trace (the `continue` event).
    for (const a of this.agents.values()) a.setPending(this);
    this.sweepTimer = setInterval(() => this.sweepIdle(), ENTRY_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  // —— Query surface (used by Session listing / Agent active-count / SSE subscription replay) ——

  statusOf(sessionId: string): SessionStatus {
    return this.agents.get(sessionId)?.status ?? "idle";
  }

  pendingApprovalCount(sessionId: string): number {
    return this.agents.get(sessionId)?.approvals.size ?? 0;
  }

  pendingApprovals(sessionId: string): PendingApproval[] {
    return this.agents.get(sessionId)?.approvals.list() ?? [];
  }

  /** Queued follow-up tasks: `task` events waiting in the agent's queue (the active event is never in the queue). */
  private queuedFollowUps(agent: HmrAgent): Extract<AgentEvent, { type: "task" }>[] {
    return agent.queue.filter((e): e is Extract<AgentEvent, { type: "task" }> => e.type === "task");
  }

  /** Number of queued follow-up tasks (`queueIfBusy`) awaiting auto-start. */
  pendingFollowUpCount(sessionId: string): number {
    const agent = this.agents.get(sessionId);
    return agent ? this.queuedFollowUps(agent).length : 0;
  }

  /** Steering messages queued but not yet delivered to the model (display mirror; see HmrAgent.pendingSteering). */
  pendingSteeringOf(sessionId: string): PendingSteeringInfo[] {
    return (this.agents.get(sessionId)?.pendingSteering ?? []).map((p) => p.info);
  }

  /** Queued follow-up tasks awaiting auto-start, as their display/recall info (id + content summary). */
  pendingFollowUpsOf(sessionId: string): PendingFollowUpInfo[] {
    const agent = this.agents.get(sessionId);
    if (!agent) return [];
    return this.queuedFollowUps(agent).map((f) => ({
      id: f.id,
      text: f.recall?.text ?? "",
      images: f.recall?.images.length ?? 0,
      files: f.recall?.files.length ?? 0,
    }));
  }

  /**
   * Live tail of a running session: one synthetic `partial_* start` OmniMessage per open
   * streaming fragment, carrying the full accumulated content so far (see live-tail.ts).
   * Empty when idle or when nothing is streaming. GET /messages attaches this (with a
   * channel cursor) so a client joining mid-stream can render the in-progress message.
   * Scoped to runs this generation drives: a suspended run's tail died with its driver.
   */
  liveFragments(sessionId: string): OmniMessage[] {
    return this.liveTail.fragments(sessionId);
  }

  /**
   * The running Task's input messages as published at launch; empty when idle. The engine
   * writes these exact envelopes to the Trace only after the first run's bootstrap (MCP
   * connect + discovery), so GET /messages appends whichever of them the Trace read has
   * not caught up to yet — without this, a client rebuilding history during the connect
   * (the draft flow subscribes only after the input publish) loses the user's own message.
   */
  pendingInputs(sessionId: string): OmniMessage[] {
    return this.agents.get(sessionId)?.pendingInputs ?? [];
  }

  /** The running Task's streamed bootstrap records (see HmrAgent.pendingBootstrap); empty when idle. */
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

  /** Add a newly created Session's agent (status idle), avoiding a redundant load on the next Task. */
  adopt(row: SessionRow, session: RuntimeSession): void {
    const agent = new HmrAgent(this, row);
    agent.session = session;
    agent.generation = this.generationOf(row.projectId, row.agentId);
    this.agents.set(row.sessionId, agent);
    // Same wiring as ensureSession: adopt IS the load path for a session created in this
    // process (POST /sessions), and a listener registered only on the loader path left
    // freshly created sessions unable to deliver idle-arrival completion reports.
    this.registerNoticeListener(agent, session);
  }

  /**
   * Subscribes the background hooks on a runtime Session entering an agent — every load
   * path must call it (ensureSession's loads, adopt's fresh creations):
   * - the idle-arrival signal for completion notices (mid-run arrivals are delivered inside
   *   the run by core; this signal is the only trigger left when the session sits idle) —
   *   queued as a `notices` event, delivered in turn by the pump;
   * - live-forwarded background-subagent messages, published to the session channel (the
   *   same feed SSE relays) and recorded for usage — a background child streams to the
   *   frontend in real time past the launching turn's end, until its terminal state.
   */
  private registerNoticeListener(agent: HmrAgent, session: RuntimeSession): void {
    session.onBackgroundNotice?.(() => agent.post({ type: "notices" }));
    session.onBackgroundMessage?.((msg) => this.forwardBackgroundMessage(agent, msg));
  }

  /** Publishes one live background-subagent message and records its usage (fire-and-forget; the child's own Trace is the durable record). */
  private forwardBackgroundMessage(agent: HmrAgent, msg: OmniMessage): void {
    // A child producing messages IS session activity: without this stamp the idle sweep
    // measures only the launching task, and a long background run ages into eviction.
    agent.lastActivityMs = Date.now();
    this.deps.channels.get(agent.sessionId).publish(msg);
    const ctx = this.usageContext(agent);
    void this.deps.recorder.record(ctx, msg).catch((err: unknown) => {
      this.log(`[usage] Insert failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({ source: "usage", err, ctx, code: "usage_insert_failed" });
    });
  }

  /**
   * After an Agent's vault is updated: bump the Agent's config generation so every
   * session loaded before the update is reloaded on its next idle access via the loader
   * — resume re-reads agent_state/.vault.toml, so the next Task on any of this Agent's
   * Sessions runs with the new values (history is preserved through the Trace). A Task
   * already in flight is neither aborted nor hot-swapped: it keeps the values it started
   * with, and its session is reloaded on the first access after it returns to idle (see
   * ensureSession).
   */
  invalidateAgentRuntimes(projectId: string, agentId: string): void {
    const key = agentKey(projectId, agentId);
    this.agentGenerations.set(key, this.generationOf(projectId, agentId) + 1);
  }

  /**
   * After a Project's models/credentials change: invalidate every cached runtime in this
   * Project, so the next Task re-resumes with the new api_key / base_url. Same
   * effective-value semantics as invalidateAgentRuntimes — no hot swap into a Task already
   * in flight. Iterating the agents table is complete here, not a shortcut: the
   * generation map only matters for sessions that are already loaded, and an Agent with
   * no loaded session builds fresh through the loader anyway.
   */
  invalidateProjectRuntimes(projectId: string): void {
    const agentIds = new Set<string>();
    for (const a of this.agents.values()) {
      if (a.projectId === projectId) agentIds.add(a.agentId);
    }
    for (const agentId of agentIds) this.invalidateAgentRuntimes(projectId, agentId);
  }

  // —— Submission surface (each serialized per agent by HmrAgent.submit) ——

  /**
   * Cheap, lock-free rehearsal of the 409/503 conditions startTask checks, throwing exactly the
   * same HttpErrors. **Advisory only**: it neither takes the submission lock nor loads a
   * session, so a status change racing this call is not caught — the authoritative check is
   * still the one inside the submission.
   *
   * It exists so a caller that has irreversible work to do first (POST /tasks writes the
   * message's file attachments to disk) can find out about the ordinary "a Task is already
   * running" rejection before doing it, instead of undoing it afterwards.
   */
  assertCanAcceptTask(sessionId: string, opts?: { queueIfBusy?: boolean }): void {
    this.assertOpen();
    this.assertAgentNotDeleting(sessionId);
    this.assertSessionNotDeleting(sessionId);
    const agent = this.agents.get(sessionId);
    if (agent && !opts?.queueIfBusy) this.assertAvailable(agent);
  }

  /**
   * Run a metadata operation at an idle Session boundary under the same submission lock
   * as Task and compaction starts. Session fork uses this to snapshot an append-only
   * Trace without a Task beginning between its status check and final read. A session
   * with no agent and no index row has nothing to serialize against (startTask would
   * 404) and runs the operation directly; this path deliberately does not load a
   * heavyweight runtime either way.
   */
  async atIdleBoundary<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const agent = this.agentFor(sessionId);
    if (agent === null) {
      this.assertOpen();
      this.assertAgentNotDeleting(sessionId);
      this.assertSessionNotDeleting(sessionId);
      return operation();
    }
    return agent.submit(async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(agent.sessionId);
      this.assertSessionNotDeleting(agent.sessionId);
      this.assertAvailable(agent);
      return operation();
    });
  }

  /**
   * Start a Task: accept → the agent's queue → the pump opens the run (publishing the
   * input first) and advances it turn by turn. Returns the current actual session_id
   * (the new id after self-heal — the load happens here, before acceptance, so the
   * response can carry it). `opts.thinkingLevel` (optional, validated by the route)
   * rides this run only. With `queueIfBusy`, a busy session enqueues the input as a
   * follow-up instead of 409: the pump auto-starts it once the queue reaches it
   * (`queued: true` in the result), keeping its thinkingLevel for that start.
   */
  async startTask(
    sessionId: string,
    input: OmniMessage[],
    opts?: { thinkingLevel?: ThinkingLevelName; queueIfBusy?: boolean; recall?: RecallStore },
  ): Promise<{ sessionId: string; queued: boolean }> {
    const agent = this.requireAgent(sessionId);
    return agent.submit(async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(agent.sessionId);
      this.assertSessionNotDeleting(agent.sessionId);
      const event: AgentEvent = {
        type: "task",
        id: randomUUID(),
        input,
        ...(opts?.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
        // The original content rides the queue so a recall can hand it back (see recallFollowUp).
        ...(opts?.recall !== undefined ? { recall: opts.recall } : {}),
      };
      if (this.isBusy(agent)) {
        if (!opts?.queueIfBusy) this.assertAvailable(agent); // throws the specific 409
        agent.post(event);
        agent.lastActivityMs = Date.now();
        // Re-publish the current state so subscribers pick up the new queued count (the
        // input itself is published when the follow-up actually starts).
        this.publishState(agent, agent.status);
        return { sessionId: agent.sessionId, queued: true };
      }
      // Loaded (and healed) BEFORE acceptance, so the response carries the actual id and
      // load failures surface to the caller instead of dying in the pump.
      await this.ensureSession(agent);
      // The historical contract: startTask resolves once the run has visibly begun
      // (status running, input published) — not merely been accepted into the queue.
      const started = new Promise<void>((resolve) => {
        event.started = resolve;
      });
      agent.post(event);
      await started;
      return { sessionId: agent.sessionId, queued: false };
    });
  }

  /**
   * Start a goal run: an immediate activity outside the event queue — one
   * `session.run(input, { goal })` call loops rounds until a terminal state, and the
   * Session stays `running` for the whole goal, so the existing abort endpoint
   * interrupts the entire loop as usual. Goals have no turn-boundary contract with the
   * swap: a platform push hard-aborts them (see quiesce). Round inputs are yielded by
   * core and published like any streamed message; progress additionally goes out as
   * goal_* server events and into goal_state (when a repo is wired).
   */
  async startGoal(
    sessionId: string,
    args: {
      /** Round-1 input (route-validated to carry text; images may ride along); its marker-stripped text is the objective. */
      input: OmniMessage[];
      budget: number;
      /** Optional per-goal thinking level: rides every round's Task (route-validated). */
      thinkingLevel?: ThinkingLevelName;
    },
  ): Promise<{ sessionId: string }> {
    const agent = this.requireAgent(sessionId);
    return agent.submit(async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(agent.sessionId);
      this.assertSessionNotDeleting(agent.sessionId);
      this.assertAvailable(agent);
      await this.ensureSession(agent);
      // The objective is the user's own text (leading skill-invocation blocks stripped) —
      // the same derivation core records in GOAL.yaml; used for the run-state row, the
      // goal_started event, and as title material.
      // `isPlainText` leaves attached images out, so this copy carries no
      // `[attached image: <path>]` lines — which suits its readers, since a status card and a
      // generated title read better without absolute scratchpad paths. Core keeps its own
      // folded copy (Session.runGoal) for what the rounds actually re-inject.
      const text = args.input
        .filter(isPlainText("user"))
        .map((msg) => msg.payload.text)
        .join("\n");
      const objective = stripLeadingMarkerBlocks(text).trim() || text.trim();
      agent.beginActivity("goal");
      const open = this.openRun(agent, "running", args.thinkingLevel);
      // Round-1 objective input: same pendingInputs hold as tasks (core yields round
      // inputs onto the stream, but the Trace write still waits for the bootstrap).
      agent.pendingInputs = [...agent.pendingInputs, ...args.input];
      agent.pendingBootstrap = [];
      this.publishState(agent, "running");
      const approve = this.makeRunApprove(agent, open.session);
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
      // Same fallback chain as a task: the goal's own level, else the Session's pinned one.
      const thinkingLevel = this.runThinkingLevel(agent.sessionId, args.thinkingLevel);
      const gen = this.goalStream(agent, {
        input: args.input,
        budget: args.budget,
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        approve,
        signal: open.ac.signal,
        ...(goalId !== undefined ? { goalId } : {}),
      });
      // The whole goal is ONE continuous activity: consumed to the end, then finished
      // and the queue released. The objective doubles as the title material.
      void (async () => {
        this.beginRunBookkeeping(agent, open, { userExcerpt: objective });
        await this.consume(agent, open, gen);
        this.finishRun(agent, open);
        agent.finishActivity();
      })();
      return { sessionId: agent.sessionId };
    });
  }

  /** Manually compact the context: 409 if busy; compaction output also flows into the SSE channel. An immediate activity like goals (hard-aborted by a swap). */
  async startCompact(sessionId: string): Promise<{ sessionId: string }> {
    const agent = this.requireAgent(sessionId);
    return agent.submit(async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(agent.sessionId);
      this.assertSessionNotDeleting(agent.sessionId);
      this.assertAvailable(agent);
      await this.ensureSession(agent);
      // When there's nothing to compact, core's compact() yields no messages at all: we
      // can't just return 202 and walk away, or the frontend would wait forever for a
      // compaction banner that never comes (this is exactly the "/compact does nothing
      // after an interrupt" complaint). Reject explicitly, and **say why** clearly —
      // "just compacted" and "haven't talked yet" share the same internal state
      // (sessionTurns === 0), but are two completely different messages to the user:
      // telling someone who just compacted that there's "no completed conversation turn
      // yet" tells them nothing.
      const why = agent.session!.compactability();
      if (why !== "ok") throw compactUnavailable(why);
      agent.beginActivity("compact");
      const open = this.openRun(agent, "compacting", undefined);
      this.publishState(agent, "compacting");
      const gen = agent.session!.compact({ signal: open.ac.signal });
      void (async () => {
        this.beginRunBookkeeping(agent, open);
        await this.consume(agent, open, gen);
        this.finishRun(agent, open);
        agent.finishActivity();
      })();
      return { sessionId: agent.sessionId };
    });
  }

  /** Submit an approval decision; returns false if the pending approval doesn't exist (already decided/unknown). */
  decideApproval(sessionId: string, toolCallId: string, decision: "allow" | "deny"): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    return agent.approvals.decide(toolCallId, decision);
  }

  /**
   * Mid-run steering: forward the message to the running Session (core delivers it between
   * turns as a standalone `[user_steering]` user message followed by its images — no SSE
   * event of its own; the messages arrive through the stream the run already publishes).
   * 409 when the Session isn't running a Task (idle / compacting / not loaded) or the run
   * finished in the race window — the caller falls back to submitting a normal task,
   * which carries the same text and images.
   *
   * `recall` is the queued message's original content: its summary (with a fresh id) is
   * mirrored on the agent and broadcast via `task_state` (and the SSE subscribe snapshot)
   * until the delivered `[user_steering]` message is observed on the stream — that is what
   * keeps the composer's "steering queued" hint, content included, alive across reloads —
   * and the content itself is what a recall (recallSteering) hands back to the composer.
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
   * Recall an undelivered steering message (#287): withdraw it from core's queue and the
   * display mirror, re-broadcast state, and hand back its original content for the composer
   * to restore. 409 `not_pending` when the entry is no longer queued — already delivered to
   * the model (core's `unsteer` says so authoritatively; the mirror can lag behind delivery
   * until the `[user_steering]` message is observed on the stream), the run exited, or the
   * id is unknown — all the same outcome for the caller: nothing left to take back.
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
   * Recall a queued follow-up task (#287): remove it from the queue before the pump
   * reaches it, re-broadcast state, and hand back its original content (plus the
   * thinking level it was queued with). 409 `not_pending` when the id is not waiting in
   * the queue — it already started (or the agent was evicted/restarted, which empties
   * the queue) — or the entry has no recall store to give back.
   */
  recallFollowUp(
    sessionId: string,
    followUpId: string,
  ): { recall: RecallStore; thinkingLevel?: ThinkingLevelName } {
    const agent = this.agents.get(sessionId);
    const queued = agent ? this.queuedFollowUps(agent).find((f) => f.id === followUpId) : undefined;
    if (!agent || !queued?.recall) {
      throw new HttpError(
        409,
        "not_pending",
        "This follow-up message already started and can no longer be recalled.",
      );
    }
    agent.queue.splice(agent.queue.indexOf(queued), 1);
    agent.lastActivityMs = Date.now();
    this.publishState(agent, agent.status);
    return {
      recall: queued.recall,
      ...(queued.thinkingLevel !== undefined ? { thinkingLevel: queued.thinkingLevel } : {}),
    };
  }

  /**
   * "Retry now" on the reconnect countdown: skip the in-progress backoff wait and fire
   * the next retry immediately (the attempt counter is unchanged — the skipped wait does
   * not consume an extra attempt). Returns false as a benign no-op when the session has
   * no active runtime or no reconnect wait is in progress — timing races (the wait
   * elapsed right before the click) must not surface as errors. Mirrors the steer seam:
   * manager → RuntimeSession → core Session → engine.
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
   * Interrupt the current Task/compaction: pending approvals converge to deny first,
   * then the AbortSignal fires. Returns false if nothing is in progress (the route
   * treats this as a 204 no-op). The controller lives on the agent, so this reaches a
   * run whichever generation drives it.
   */
  abortTask(sessionId: string): boolean {
    return this.agents.get(sessionId)?.interrupt() ?? false;
  }

  /**
   * Background command processes of a LOADED session (empty when no session object is
   * held — a reloaded session starts with a fresh environment and can only ever report
   * an empty list, so nothing is resurrected just to answer a poll).
   */
  listProcesses(sessionId: string): BackgroundCommandInfo[] {
    return this.agents.get(sessionId)?.session?.listBackgroundCommands?.() ?? [];
  }

  /**
   * Refreshes the listen-port probes behind the process list's `serviceUrl` (core
   * `Session.probeBackgroundCommandServices`): called by the processes route before
   * listing, so the first fetch already carries probed URLs. Bounded by core's own probe
   * timeout and TTL; a session that isn't loaded has no processes to probe.
   */
  async probeProcessServices(sessionId: string): Promise<void> {
    await this.agents.get(sessionId)?.session?.probeBackgroundCommandServices?.();
  }

  /** Kills one background command process of a loaded session; false when the session isn't loaded or the id is unknown. */
  killProcess(sessionId: string, processId: string): boolean {
    const agent = this.agents.get(sessionId);
    if (!agent) return false;
    const killed = agent.session?.killBackgroundCommand?.(processId) ?? false;
    if (killed) agent.lastActivityMs = Date.now();
    return killed;
  }

  /**
   * Removes one EXITED background command entry from a loaded session's process list.
   * A running process is refused ("running") — stopping is killProcess's job, and a
   * bare removal must never surprise-signal a live process group. "not_found" covers
   * an unloaded session and an unknown id alike: the entry is gone either way. The
   * removal itself reuses the kill path — core's registry removal signals the (dead)
   * group defensively and drops the row, exactly like input_command's post-exit reap.
   * The only race, an entry observed running that exits before a retry, is benign:
   * the caller gets "running", refreshes, and sees the row exited on the next look.
   *
   * Note what leaves with the row: the registry entry owns the ManagedSession holding
   * that process's captured output, so after a removal input_command on the same
   * process_id answers "unknown process_id". Removal is a deliberate discard, not just
   * a list tidy-up — the Web App says so at the button and in the docs.
   */
  removeProcess(sessionId: string, processId: string): "removed" | "running" | "not_found" {
    const agent = this.agents.get(sessionId);
    if (!agent) return "not_found";
    const info = agent.session?.listBackgroundCommands?.().find((p) => p.processId === processId);
    if (!info) return "not_found";
    if (info.running) return "running";
    const removed = agent.session?.killBackgroundCommand?.(processId) ?? false;
    if (!removed) return "not_found";
    agent.lastActivityMs = Date.now();
    return "removed";
  }

  /**
   * Before deleting a Project, converge all its active runs and clear their agents.
   * Returns the in-flight activity Promises of the affected sessions: the caller
   * (deleteProject) should await them before removing the directory, so that
   * interrupt-cleanup Trace writes don't recreate the directory after deletion.
   */
  abortProject(projectId: string): Promise<void>[] {
    const runnings: Promise<void>[] = [];
    for (const [key, agent] of [...this.agents]) {
      if (agent.projectId !== projectId) continue;
      agent.queue.length = 0;
      agent.interrupt();
      if (agent.running) runnings.push(agent.running);
      this.agents.delete(key);
      agent.disposeWhenSettled();
    }
    return runnings;
  }

  /**
   * Before deleting an Agent, converge all its active runs and clear their agents
   * (same semantics as abortProject). Also marks this Agent as "being deleted": new
   * Tasks/compactions entering during the deletion process are always rejected with 409
   * (assertAgentNotDeleting), closing the race window where a new task recreates the
   * directory and revives an already-deleted Agent between the abortAgent snapshot and
   * the directory removal. The caller must call endAgentDeletion once deletion finishes
   * (success or failure).
   */
  beginAgentDeletion(projectId: string, agentId: string): Promise<void>[] {
    this.deletingAgents.add(agentKey(projectId, agentId));
    const runnings: Promise<void>[] = [];
    for (const [key, agent] of [...this.agents]) {
      if (agent.projectId !== projectId || agent.agentId !== agentId) continue;
      agent.queue.length = 0;
      agent.interrupt();
      if (agent.running) runnings.push(agent.running);
      this.agents.delete(key);
      agent.disposeWhenSettled();
    }
    return runnings;
  }

  endAgentDeletion(projectId: string, agentId: string): void {
    this.deletingAgents.delete(agentKey(projectId, agentId));
  }

  /**
   * Before deleting a single Session, converge its active run and clear its agent
   * (same semantics as beginAgentDeletion). Also marks this Session as "being deleted":
   * new Tasks/compactions entering during the deletion process are always rejected with
   * 409 (assertSessionNotDeleting), closing the race window where a new task recreates
   * the agent and Trace file, reviving an already-deleted Session between the abort
   * snapshot and the file removal. The caller must call endSessionDeletion once deletion
   * finishes (success or failure). Returns the in-flight activity Promise: the caller
   * should await it before deleting the Trace file, so cleanup writes don't recreate the
   * file.
   */
  beginSessionDeletion(sessionId: string): Promise<void>[] {
    this.deletingSessions.add(sessionId);
    const agent = this.agents.get(sessionId);
    if (!agent) return [];
    agent.queue.length = 0;
    agent.interrupt();
    this.agents.delete(sessionId);
    agent.disposeWhenSettled();
    return agent.running ? [agent.running] : [];
  }

  endSessionDeletion(sessionId: string): void {
    this.deletingSessions.delete(sessionId);
  }

  /**
   * Hot-swap exit: the counterpart of shutdown() for a platform swap. New work is
   * rejected from here on (requests route to the successor App anyway), but running Task
   * events are NOT aborted: the agents' pump suspends each open run at its next turn
   * boundary and the successor finishes it from the Trace — the agent object itself is
   * shared state the successor adopts, so approvals, interrupts and status keep working
   * throughout. Goals and compactions have no boundary contract and are hard-aborted;
   * their activity promises are returned for the swap's drain to wait out, exactly as
   * shutdown's wait did.
   *
   * Returns immediately: the in-flight turns deliberately outlive this call.
   */
  quiesce(): QuiesceResult {
    this.closed = true;
    clearInterval(this.sweepTimer);
    const aborted: Promise<void>[] = [];
    for (const agent of this.agents.values()) {
      if (agent.activeKind === "goal" || agent.activeKind === "compact") {
        agent.interrupt();
        if (agent.running) aborted.push(agent.running);
      }
    }
    return { aborted };
  }

  /** Graceful shutdown: reject new tasks (503), interrupt all active runs, and wait for them to finish (default ≤5s). */
  async shutdown(timeoutMs = 5000): Promise<void> {
    this.closed = true;
    clearInterval(this.sweepTimer);
    const pending: Promise<void>[] = [];
    for (const agent of this.agents.values()) {
      agent.queue.length = 0;
      agent.interrupt();
      if (agent.running) pending.push(agent.running);
      // Suspend means the environment too: dispose kills the Session's remaining
      // background processes (a dev server the conversation started, etc.), sequenced
      // after the in-flight activity settles.
      agent.disposeWhenSettled();
    }
    this.agents.clear();
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
    ]);
  }

  /**
   * Agent idle eviction: removes agents that are idle (nothing in flight, nothing
   * queued or pinned — see HmrAgent.evictable) and inactive past the timeout, releasing
   * the core Session's full in-memory history. This is purely memory reclamation: the
   * next access recreates the agent and re-resumes via the loader, so correctness is
   * unaffected. `now` / `idleMs` are injectable for tests and timers.
   */
  sweepIdle(now: number = Date.now(), idleMs: number = ENTRY_IDLE_MS): void {
    for (const [key, agent] of this.agents) {
      if (agent.evictable(now, idleMs)) this.agents.delete(key);
    }
  }

  // —— AgentImpl: the pump-invoked generation code ——

  /** One turn of the head event (see AgentImpl.process). */
  async process(agent: HmrAgent, event: AgentEvent): Promise<"more" | "done"> {
    try {
      const open = agent.activeRun as OpenRun | null;
      if (open !== null) return await this.stepOpenRun(agent, open);
      switch (event.type) {
        case "task":
          return await this.beginTask(agent, event);
        case "continue":
          return await this.beginContinue(agent, event);
        case "notices":
          return await this.beginNotices(agent);
      }
    } catch (err) {
      // Load/heal failures of queued work have no HTTP caller to surface to (immediate
      // tasks load at submission): log, make sure nothing is left half-open, and retire
      // the event.
      this.log(
        `[session] queued event failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // A submission may be awaiting the start signal (see startTask): never strand it.
      if (event.type === "task") event.started?.();
      const open = agent.activeRun as OpenRun | null;
      if (open !== null) this.finishRun(agent, open);
      else if (agent.status !== "idle") {
        agent.status = "idle";
        agent.abort = null;
        this.publishState(agent, "idle");
      }
      agent.activeRun = null;
      agent.activeEvent = null;
      agent.activeKind = null;
      return "done";
    }
  }

  /** Swap-out of the open run at a turn boundary (see AgentImpl.suspend). */
  suspend(agent: HmrAgent): { thinkingLevel?: ThinkingLevelName } {
    const open = agent.activeRun as OpenRun | null;
    if (open === null) return {};
    // Graceful close: the run's durable state is the Trace (everything real is written
    // as produced; replay reconstructs the pending turn input positionally), so nothing
    // is saved in memory. The status deliberately stays "running" — the continuation is
    // the very next event, and the conversation never reads idle in between.
    open.session.endRun?.();
    open.watcher?.close();
    this.liveTail.clear(agent.sessionId);
    open.session.dispose?.();
    agent.session = null;
    agent.abort = null;
    // Core discarded undelivered steering at endRun — drop the mirror with it.
    agent.pendingSteering = [];
    open.settle();
    return {
      ...(open.thinkingLevel !== undefined ? { thinkingLevel: open.thinkingLevel } : {}),
    };
  }

  /** First process call of a `task` event: publish the input and open the run. */
  private async beginTask(
    agent: HmrAgent,
    event: Extract<AgentEvent, { type: "task" }>,
  ): Promise<"more" | "done"> {
    if (this.refusesAutoStart(agent.sessionId)) {
      event.started?.();
      return "done";
    }
    await this.ensureSession(agent);
    const thinkingLevel = this.runThinkingLevel(agent.sessionId, event.thinkingLevel);
    const channel = this.deps.channels.get(agent.sessionId);
    const open = this.openRun(agent, "running", thinkingLevel);
    // Publish the input messages first (visible to other subscribers; the Trace is
    // persisted by the SDK), then flip the running status. The same envelopes are held as
    // pendingInputs so GET /messages can serve them before the engine's Trace write
    // catches up (delayed by the first run's MCP connect). APPEND, don't replace: inputs
    // of a run aborted mid-bootstrap are still held (nothing reached the Trace; core
    // carries them into this run) and must stay served until this run persists them.
    // The previous attempt's bootstrap records are dropped instead — this run streams
    // its own connect phase, and a stale aborted pair would render as an extra row.
    agent.pendingInputs = [...agent.pendingInputs, ...event.input];
    agent.pendingBootstrap = [];
    for (const msg of event.input) channel.publish(msg);
    this.publishState(agent, "running");
    // The run is visibly started: release the submission (see startTask's contract) —
    // deliberately before the begin step below, whose first-run bootstrap (MCP connect)
    // can take seconds the caller must not wait out.
    event.started?.();
    // This call's input user text is the whole title source: the run start persists its
    // first words as the immediate fallback and hands it to the LLM as the generation
    // material (user input only — generation never waits for model output).
    const userExcerpt = event.input
      .filter(isPlainText("user"))
      .map((msg) => msg.payload.text)
      .join("\n");
    this.beginRunBookkeeping(agent, open, { userExcerpt });
    return this.driveBegin(agent, open, event.input);
  }

  /** First process call of a `continue` event: reload from the Trace and finish the suspended run. */
  private async beginContinue(
    agent: HmrAgent,
    event: Extract<AgentEvent, { type: "continue" }>,
  ): Promise<"more" | "done"> {
    const finishIdle = (): "done" => {
      agent.status = "idle";
      agent.activeEvent = null;
      agent.activeKind = null;
      agent.lastActivityMs = Date.now();
      this.publishState(agent, "idle");
      return "done";
    };
    if (agent.interruptRequested) {
      agent.interruptRequested = false;
      return finishIdle();
    }
    if (this.refusesAutoStart(agent.sessionId)) return finishIdle();
    await this.ensureSession(agent);
    // Re-checked after the await: an interrupt landing during the reload has no
    // controller to fire yet and parks in the flag — it must cancel this relaunch, not
    // leak into a run that then ignores it.
    if (agent.interruptRequested) {
      agent.interruptRequested = false;
      return finishIdle();
    }
    const open = this.openRun(agent, "running", event.thinkingLevel);
    this.beginRunBookkeeping(agent, open);
    // Empty input: the suspended turn's pending messages ride in as the reloaded
    // Session's Trace-replayed carry-over; core ends the run without a request if
    // nothing was reconstructed.
    return this.driveBegin(agent, open, []);
  }

  /** First process call of a `notices` event: deliver queued background completion notices as a task. */
  private async beginNotices(agent: HmrAgent): Promise<"more" | "done"> {
    if (this.refusesAutoStart(agent.sessionId)) return "done";
    // Only an idle agent with a loaded Session delivers — a busy one never gets here
    // (the pump is serial), and with no session object loaded the notices left with it.
    const input = agent.session?.takeBackgroundNotices?.() ?? [];
    if (input.length === 0) return "done";
    return this.beginTask(agent, { type: "task", id: randomUUID(), input });
  }

  /**
   * Opens the run's step generator and consumes it (the bootstrap phase / the whole run
   * for a session without the stepped surface), returning the pump verdict.
   */
  private async driveBegin(
    agent: HmrAgent,
    open: OpenRun,
    input: OmniMessage[],
  ): Promise<"more" | "done"> {
    const approve = this.makeRunApprove(agent, open.session);
    const runOpts = {
      approve,
      signal: open.ac.signal,
      ...(open.thinkingLevel !== undefined ? { thinkingLevel: open.thinkingLevel } : {}),
    };
    if (open.session.beginRun === undefined) {
      // No stepped surface (test fakes, older embedders): the whole run is one
      // un-swappable piece, consumed here.
      await this.consume(agent, open, open.session.run(input, runOpts));
      this.finishRun(agent, open);
      return "done";
    }
    const verdict = await this.consume(agent, open, open.session.beginRun(input, runOpts));
    if (verdict !== "continue") {
      this.finishRun(agent, open);
      return "done";
    }
    return "more";
  }

  /** A subsequent process call: one turn of the open stepped run. */
  private async stepOpenRun(agent: HmrAgent, open: OpenRun): Promise<"more" | "done"> {
    const verdict = await this.consume(agent, open, open.session.stepRun!());
    if (verdict !== "continue") {
      this.finishRun(agent, open);
      return "done";
    }
    return "more";
  }

  /** Creates the open-run bundle and flips the agent's live-control fields. */
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
      watcher: this.deps.errors
        ? new StreamErrorWatcher(this.deps.errors, {
            projectId: agent.projectId,
            agentId: agent.agentId,
            sessionId: agent.sessionId,
          })
        : null,
      children: new Map(),
      subagentPrompts: new Map(),
      settle,
    };
    agent.activeRun = open;
    agent.status = status;
    agent.abort = ac;
    agent.lastActivityMs = Date.now();
    return open;
  }

  /** Per-run start bookkeeping shared by tasks, continuations, goals and compactions. */
  private beginRunBookkeeping(
    agent: HmrAgent,
    open: OpenRun,
    titleSource?: { userExcerpt: string },
  ): void {
    // Title policy fires at run start, from the user input alone: the generator persists
    // the input's first words as an immediate fallback and issues the LLM replacement
    // request without waiting for any model output (maybeGenerate self-guards: manual
    // renames are final, one generation in flight per session).
    if (titleSource?.userExcerpt.trim()) {
      this.deps.titles?.maybeGenerate(open.ctx, open.session, {
        fallbackText: titleSource.userExcerpt,
        material: { userText: titleSource.userExcerpt, assistantText: "" },
      });
    }
    // Every run (a Task, a compaction, or a whole goal loop) writes Trace lines: flip
    // the row's has_trace cache here, the single choke point, so listing can serve it
    // from the DB without a directory walk (see SessionService.listSessions). The same
    // statement stamps last_active_at, so a run costs one row write here and one more
    // when it ends (see finishRun) — never one per streamed message. Guarded: an
    // unexpected DB failure must not strand the run before its first step.
    this.touchRow(open.ctx, (repo, at) => repo.markDriven(open.ctx.sessionId, at));
  }

  /**
   * Consumes ONE step generator (or a whole legacy run), publishing every message and
   * running the per-message observers. Never throws: core converges failures into the
   * stream; a genuine defect is logged and recorded, and the step reads as done.
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
        await this.observeMessage(agent, open, n.value);
      }
    } catch (err) {
      // The SDK doesn't normally throw (errors are converged into the message stream);
      // this is a defensive record here to avoid crashing the runtime.
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

  /** The per-message pipeline every streamed message goes through (the former drive loop body). */
  private async observeMessage(agent: HmrAgent, open: OpenRun, msg: OmniMessage): Promise<void> {
    // A parent-level (no origin) run_subagent call: record its prompt for the child
    // session_meta that arrives later to use as its title.
    if (!msg.origin || msg.origin.length === 0) {
      const call = runSubagentCall(msg);
      if (call) open.subagentPrompts.set(call.toolCallId, call.prompt);
      const denied = deniedToolCallId(msg);
      if (denied) open.subagentPrompts.delete(denied);
      const settled = settledToolCallId(msg);
      if (settled) open.subagentPrompts.delete(settled);
      // Steering delivery: core emits exactly one `[user_steering]` user text per queued
      // entry, in queue order — shift the display mirror and re-broadcast so the
      // composer's "steering queued" hint retires the moment the message is on stream.
      if (agent.pendingSteering.length > 0 && isDeliveredSteering(msg)) {
        agent.pendingSteering.shift();
        this.publishState(agent, agent.status);
      }
    } else if (isSessionMeta(msg)) {
      // Subagent registration is only a "side effect" — it must never interrupt the
      // main run flow on error: wrap the whole thing in a defensive try/catch.
      try {
        const child = this.registerChildSession(agent, msg, open.children);
        // Only a **direct** subagent (origin length 1) claims a queued parent-level
        // run_subagent prompt; deeper sessions are spawned by their own parent and
        // shouldn't consume from this queue. Pairing is FIFO by call order (a single
        // round may spawn several in parallel and session_meta carries no tool_call_id,
        // so out-of-order arrivals can swap two displayed titles — title-only impact);
        // denied and settled calls were dequeued above so their prompts never mismatch.
        if (child && msg.origin!.length === 1) {
          const [pendingId] = open.subagentPrompts.keys();
          if (pendingId !== undefined) {
            child.prompt = open.subagentPrompts.get(pendingId) ?? "";
            open.subagentPrompts.delete(pendingId); // Consumed by this session_meta
          }
          // The subagent's title is generated right here at registration, from the
          // spawning prompt alone (its "user input") — never waiting for the
          // subagent's own output. It piggybacks a one-shot request on the parent
          // Session's bare LLM (the child Session object never leaves the SDK):
          // Session/Agent record the subagent (the title belongs to it), but the
          // model reference keeps ctx's parent-Session (provider, modelId) pair —
          // a subagent may switch models via run_subagent's model_id.
          if (child.prompt.trim()) {
            this.deps.titles?.maybeGenerate(
              { ...open.ctx, agentId: child.agentId, sessionId: child.sessionId },
              open.session,
              {
                fallbackText: child.prompt,
                material: { userText: child.prompt, assistantText: "" },
                notifyOn: agent.sessionId, // Notify the frontend via the parent Session's SSE channel
              },
            );
          }
        }
      } catch (err) {
        this.log(
          `[subagent] Failed to register child session: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.deps.errors?.record({
          source: "subagent",
          err,
          ctx: open.ctx,
          code: "subagent_register_failed",
        });
      }
    }
    // Bootstrap records (first-run MCP connect + toolset): held for GET /messages
    // until the engine's deferred Trace write catches up (see pendingBootstrap).
    if (!msg.origin || msg.origin.length === 0) {
      const bt = (msg.payload as { type?: string }).type;
      if (bt === "mcp_connect_begin" || bt === "mcp_connect_end" || bt === "tool_list_ready") {
        agent.pendingBootstrap.push(msg);
      }
      // First request of the run: the engine writes input → bootstrap records → tool
      // list to the Trace BEFORE issuing the request, so both holds are persisted by
      // now — end them here rather than at idle. Holding for the whole run would
      // outlive the messages endpoint's tail-window dedup: once the Task appends
      // more records than the window, the input would be judged "not yet in the
      // Trace" and served a second time at the end of history.
      if (bt === "request_begin") {
        agent.pendingInputs = [];
        agent.pendingBootstrap = [];
      }
    }
    // Live-tail bookkeeping in the same synchronous tick as the publish below: the
    // messages endpoint captures "channel cursor + open fragments" between two
    // publishes, so the pair is always a consistent snapshot (see live-tail.ts).
    this.liveTail.observe(agent.sessionId, msg);
    // Re-fetch the channel before every publish (matches publishEvent): the channel
    // may have been recycled and recreated during a long wait on approval, and
    // holding a stale reference would send output to an orphaned, detached channel.
    this.deps.channels.get(agent.sessionId).publish(msg);
    open.watcher?.observe(msg);
    try {
      await this.deps.recorder.record(open.ctx, msg);
    } catch (err) {
      this.log(`[usage] Insert failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({
        source: "usage",
        err,
        ctx: open.ctx,
        code: "usage_insert_failed",
      });
    }
  }

  /** The run-end wrap-up (the former drive finally), shared by every run kind. */
  private finishRun(agent: HmrAgent, open: OpenRun): void {
    // Close the stepped run first: every beginRun is paired with endRun (the steering
    // window shuts, and core's idle-arrival signals resume). Idempotent for the legacy
    // whole-run path, whose facade already closed itself.
    open.session.endRun?.();
    // Persist any still-pending LLM failure and clear the tool-name cache (the watcher's state doesn't carry across runs).
    open.watcher?.close();
    // The run is over: no fragment will ever continue, so drop the live tail before the
    // idle flip (GET /messages stops attaching `live` the moment status reads idle).
    this.liveTail.clear(agent.sessionId);
    // The pending holds are NOT cleared here: a run aborted mid-bootstrap wrote nothing
    // to the Trace, so its held input (and the aborted connect pair) are the only copy
    // a reload can show until the next run carries the input forward and persists it.
    // Runs that issued a request already cleared them at their first request_begin.
    agent.approvals.denyAll();
    agent.status = "idle";
    agent.abort = null;
    agent.activeRun = null;
    // Retired HERE, atomically with the idle flip, not in the pump's continuation a few
    // microtasks later: an observer that saw idle must also see the agent available.
    agent.activeEvent = null;
    agent.activeKind = null;
    // The run is over, so core has discarded any undelivered steering (see ContextEngine's
    // steeringQueue) — drop the mirror with it; the idle publish below broadcasts the
    // now-empty state.
    agent.pendingSteering = [];
    agent.lastActivityMs = Date.now();
    // Run-end stamp (see the run-start counterpart in beginRunBookkeeping). Guarded like
    // every write here: the idle broadcast must not be skippable by a DB failure, or SSE
    // clients would sit on "running" forever. A no-op UPDATE when the row is already
    // gone: deletion normally awaits the activity first, so that only happens once its
    // 5s wait times out.
    this.touchRow(open.ctx, (repo, at) => repo.touchLastActive(open.ctx.sessionId, at));
    this.publishState(agent, "idle");
    open.settle();
    agent.running = null;
    // Background completion notices that raced this run's exit (arrived after its last
    // input-assembly boundary): queue their delivery unless queued work handles it
    // anyway (the next run's engine drains the same queue at its own boundaries).
    if (agent.queue.length <= 1 && (agent.session?.hasPendingBackgroundNotices?.() ?? false)) {
      agent.post({ type: "notices" });
    }
  }

  /** The per-run approval callback (re-reads approval_mode from the DB on every decision — a PATCH takes effect immediately). */
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

  /** Whether an auto-start (a queued event's begin) must be skipped: shutting down, or a deletion window is open. */
  private refusesAutoStart(sessionId: string): boolean {
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
    if (agent === null) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    return agent;
  }

  /** Get-or-create WITHOUT loading a session (the load happens inside the submission/pump — see ensureSession); null when no index row exists. */
  private agentFor(sessionId: string): HmrAgent | null {
    const existing = this.agents.get(sessionId);
    if (existing) return existing;
    const row = this.deps.sessions.findById(sessionId);
    if (!row) return null;
    const agent = new HmrAgent(this, row);
    this.agents.set(sessionId, agent);
    return agent;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new HttpError(
        503,
        "shutting_down",
        "Server is shutting down; not accepting new Tasks.",
      );
    }
  }

  /** The Agent owning this Session is being deleted → 409 (guards against directory recreation inside the deletion race window). */
  private assertAgentNotDeleting(sessionId: string): void {
    const row = this.deps.sessions.findById(sessionId);
    if (row && this.deletingAgents.has(agentKey(row.projectId, row.agentId))) {
      throw new HttpError(
        409,
        "agent_deleting",
        "This Agent is being deleted; not accepting new Tasks.",
      );
    }
  }

  /** This Session is being deleted → 409 (guards against the agent/Trace being rebuilt and reviving it inside the deletion race window). */
  private assertSessionNotDeleting(sessionId: string): void {
    if (this.deletingSessions.has(sessionId)) {
      throw new HttpError(
        409,
        "session_deleting",
        "This Session is being deleted; not accepting new Tasks.",
      );
    }
  }

  /** Busy → the specific 409 (running vs compacting; queued-but-not-started work counts as a Task in progress). */
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
   * get-or-resume-or-heal on the agent: reuse the loaded session when it is current;
   * reload via the loader when none is held (fresh agent, post-swap, evicted) or when
   * a vault update staled it (discarded only once idle — an in-flight run keeps its
   * values and is rebuilt on the first access after it finishes). Self-heal may produce
   * a new session_id: the index's primary key and the agents table follow it.
   */
  private async ensureSession(agent: HmrAgent): Promise<void> {
    if (agent.session !== null) {
      if (agent.generation === this.generationOf(agent.projectId, agent.agentId)) return;
      if (agent.status !== "idle" || agent.running !== null || agent.approvals.size !== 0) return;
      agent.session = null;
    }
    const row = this.deps.sessions.findById(agent.sessionId);
    if (!row) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    // Captured before the (awaited) load: a vault update racing with the load leaves
    // this session stale, so the access after next rebuilds it with the new values.
    const generation = this.generationOf(row.projectId, row.agentId);
    const session = await this.deps.loader.load(row);
    // The Session/Agent was marked for deletion while loading: discard the load result,
    // don't attach it (avoids reviving an orphaned Trace).
    this.assertSessionNotDeleting(row.sessionId);
    this.assertAgentNotDeleting(row.sessionId);
    if (session.sessionId !== row.sessionId) {
      // Self-heal produced a new session_id: update the index's primary key and re-key
      // the shared agents table; the SSE channel and pending state are naturally empty
      // for the new id.
      this.deps.sessions.replaceId(row.sessionId, session.sessionId);
      this.agents.delete(agent.sessionId);
      agent.sessionId = session.sessionId;
      this.agents.set(agent.sessionId, agent);
    }
    agent.session = session;
    agent.generation = generation;
    agent.lastActivityMs = Date.now();
    this.registerNoticeListener(agent, session);
  }

  /**
   * Taps core's goal-mode stream: round boundaries (the injected `[goal]` inputs) become
   * goal_round events + goal_state refreshes, and the terminal `goal_finished` event
   * message becomes the goal_finished server event + the run-state row's final status.
   * Token numbers mirror core's own accounting (same `goalTokenDelta`), so the UI shows
   * exactly what the budget check uses.
   */
  private async *goalStream(
    agent: HmrAgent,
    args: {
      input: OmniMessage[];
      budget: number;
      thinkingLevel?: ThinkingLevelName;
      approve: ApproveFn;
      signal: AbortSignal;
      goalId?: number;
    },
  ): AsyncGenerator<OmniMessage> {
    const gen = agent.session!.run(args.input, {
      approve: args.approve,
      signal: args.signal,
      ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
      goal: { budget: args.budget },
    });
    let round = 0;
    let used = 0;
    let finished = false;
    try {
      for await (const msg of gen) {
        used += goalTokenDelta(msg);
        if (isGoalRoundInput(msg)) {
          round++;
          if (args.goalId !== undefined) this.deps.goals?.progress(args.goalId, round, used);
          this.publishEvent(agent, {
            type: "goal_round",
            sessionId: agent.sessionId,
            round,
            used,
            budget: args.budget,
          });
        }
        const outcome = goalFinishedOf(msg);
        if (outcome) {
          finished = true;
          if (args.goalId !== undefined) {
            this.deps.goals?.finish(
              args.goalId,
              outcome.outcome,
              outcome.rounds,
              outcome.tokensUsed,
            );
          }
          this.publishEvent(agent, {
            type: "goal_finished",
            sessionId: agent.sessionId,
            outcome: outcome.outcome,
            rounds: outcome.rounds,
            used: outcome.tokensUsed,
          });
        }
        yield msg;
      }
      if (!finished) {
        // Defensive: core always ends a goal stream with goal_finished; a stream that
        // didn't is a cut-off run — close the row so the UI never shows a forever-active
        // goal.
        this.finishGoalAborted(agent, args.goalId, round, used);
      }
    } catch (err) {
      // Core throws only on infrastructure failures (e.g. GOAL.yaml writes): close the
      // run state as aborted, then let the consumer's defensive catch record the error.
      // Guarded on `finished`: a throw after the terminal event must not overwrite the
      // row's real outcome (repo.finish is an unconditional UPDATE) or publish a
      // contradicting event.
      if (!finished) this.finishGoalAborted(agent, args.goalId, round, used);
      throw err;
    }
  }

  /** Closes a goal's run state as aborted (stream cut off / infrastructure failure). */
  private finishGoalAborted(
    agent: HmrAgent,
    goalId: number | undefined,
    round: number,
    used: number,
  ): void {
    if (goalId !== undefined) this.deps.goals?.finish(goalId, "aborted", round, used);
    this.publishEvent(agent, {
      type: "goal_finished",
      sessionId: agent.sessionId,
      outcome: "aborted",
      rounds: round,
      used,
    });
  }

  /**
   * Thinking level for one run: the level the request carried wins, else the level pinned
   * on the Session row (PATCH /api/sessions/:id — the Web App's in-chat picker), else
   * undefined so core keeps falling back to the Agent config. Resolved at START time, so
   * a queued follow-up that carried no level of its own picks up the pin as it stands when
   * it finally starts, and a pin set mid-run applies from the next run.
   */
  private runThinkingLevel(
    sessionId: string,
    requested?: ThinkingLevelName,
  ): ThinkingLevelName | undefined {
    return requested ?? this.deps.sessions.findById(sessionId)?.thinkingLevel ?? undefined;
  }

  /**
   * Register a subagent: persisted only when the origin message is session_meta
   * (agentId is derived from the agent_state path: `<…>/<agentId>/agent_state`).
   * **The title is left blank here** — the registration site in observeMessage generates
   * it right away from the spawning prompt (fallback first words + LLM replacement), so
   * it never waits for the subagent's own output. Idempotent (children dedup +
   * insertOrIgnore); a subagent has its own Trace, so it's visible in both the list
   * and the trace view. On successful registration, the entry is put into `children`
   * and returned; a duplicate session_meta returns null.
   */
  private registerChildSession(
    agent: HmrAgent,
    msg: OmniMessage,
    children: Map<string, ChildSession>,
  ): ChildSession | null {
    if (!isSessionMeta(msg)) return null;
    const childSid = msg.origin![msg.origin!.length - 1]!;
    if (children.has(childSid)) return null;
    const p = msg.payload as SessionMetaPayload;
    const agentId = path.basename(path.dirname(p.agent_state));
    if (!agentId || agentId === "." || agentId === "..") return null;
    // The forwarded session_meta records the origin at the source (core's spawn site); fall
    // back to inferring "subagent" from the registration path for older metas (narrowed —
    // a junk value also falls back). It goes into the in-process registry only — the index
    // row deliberately stores no source column.
    const source = asSessionSource(p.source) ?? "subagent";
    this.deps.sources.set(childSid, source);
    const createdAt = this.now().toISOString();
    this.deps.sessions.insertOrIgnore({
      sessionId: childSid,
      projectId: agent.projectId,
      agentId,
      provider: p.provider,
      modelId: p.model_id,
      workspace: p.workspace,
      // A subagent's approvals are inherited from the parent Session; the index row is
      // inserted with defaults (matches the convention for Sessions discovered by the CLI).
      approvalMode: "allow-all",
      title: null,
      // Spawned by this server's run (client NULL = web); its Trace exists by construction.
      hasTrace: true,
      // A subagent's own runs are driven through the PARENT session's stream, so nothing
      // ever stamps this row: it stays at its registration time (see SessionRow.lastActiveAt).
      lastActiveAt: createdAt,
      createdAt,
    });
    // Make the subagent appear immediately in the sidebar: notify via the parent
    // Session's channel (a frontend currently watching the parent run refreshes its list in place).
    this.publishEvent(agent, {
      type: "session_created",
      projectId: agent.projectId,
      agentId,
      sessionId: childSid,
      source,
    });
    const child: ChildSession = {
      sessionId: childSid,
      agentId,
      prompt: "",
    };
    children.set(childSid, child);
    return child;
  }

  /**
   * Runs one `sessions` row write for a run's bookkeeping (has_trace / last_active_at),
   * swallowing failures the same way the per-message `recorder.record` call does:
   * bookkeeping must never take down a run's lifecycle. The realistic failure (the
   * DatabaseSync handle closed by shutdown while a run outlived its drain window)
   * throws ERR_INVALID_STATE.
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
    // Every state flip also reports the queued follow-up count and the undelivered steering
    // mirror, so subscribers can render both hints without a dedicated event type.
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
    // The same flip again, this time on the user channel and carrying the Session id: a tab
    // subscribes to the ONE conversation it has open, so the event above can never move any
    // other row's badge. Only the queued/steering hints stay session-scoped — they belong to
    // the composer of the conversation being watched, not to a list row.
    const notify = this.deps.notifyProjectUsers;
    if (!notify) return;
    let lastActiveAt: string;
    let hasTrace: boolean;
    try {
      // Read the stamp back rather than reconstruct it: the run-end flip is published right
      // after the write that stamps it (touchLastActive in finishRun), so this is what a
      // list fetch would return right now and no clock of ours has to agree with the one that
      // wrote it.
      const row = this.deps.sessions.findById(agent.sessionId);
      if (!row) return; // Row already deleted: no list row left to light up.
      lastActiveAt = row.lastActiveAt;
      // A running Session has by definition started a Task, whatever the row cache says yet:
      // markDriven (which sets has_trace) runs at the run's start, and the first "running"
      // is published by then. Reporting the raw flag there would tell a client the Session
      // has never run at the exact moment it visibly is running — and a client that
      // believed it would draw the hourglass, then nothing at all once the run settled.
      hasTrace = row.hasTrace === true || state !== "idle";
    } catch {
      // Same failure touchRow guards against (DB handle closed by shutdown while a run
      // outlives its drain window). A list badge is never worth breaking a run's wrap-up over.
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
