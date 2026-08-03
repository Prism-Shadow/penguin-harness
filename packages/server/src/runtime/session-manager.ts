/**
 * Active Session runtime.
 *
 * Responsibilities:
 *   - get-or-resume-or-heal: use it directly on an active-table hit; with a Trace,
 *     recover via `agent.resumeSession`; a stale Session that was created but never run
 *     and survived a process restart (no Trace) **self-heals** — recreated via
 *     createSession using the index row's workspace/modelId, yielding a new session_id
 *     and updating the index's primary key; the Task response body always returns the
 *     current actual id;
 *   - Vault effectiveness: a vault update bumps the Agent's config generation
 *     (invalidateAgentRuntimes); runtimes built earlier are discarded on their next
 *     idle access and re-resumed, so the next Task always runs with current values;
 *   - Per-Session mutual exclusion: only one Task/compaction may be in progress at a
 *     time;
 *   - run/compact drive: consumes the output stream in the background, publishing each
 *     message to the SSE channel and handing it to usage-recorder for persistence;
 *     on completion (including errors) resets to idle and pushes a `task_state` server
 *     event;
 *   - Approval registration and interrupt convergence: each approval decision re-reads
 *     approval_mode from the DB (takes effect immediately); an interrupt first
 *     converges pending approvals to deny, then aborts.
 *
 * The underlying implementation of get-or-resume-or-heal is injected via
 * `SessionLoader`: production uses the core SDK (createCoreSessionLoader), tests inject
 * a fake Session (issuing no real LLM requests).
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  createAgent,
  findLatestTraceFile,
  goalFinishedOf,
  goalTokenDelta,
  isGoalRoundInput,
  isSessionMeta,
  stripLeadingMarkerBlocks,
  tracesDir,
} from "@prismshadow/penguin-core";
import type {
  ApproveFn,
  CompactAvailability,
  OmniMessage,
  SessionMetaPayload,
  SessionTitleResult,
  TextPayload,
  ThinkingLevelName,
} from "@prismshadow/penguin-core";
import type { ServerEvent, SessionStatus } from "../api/types.js";
import { HttpError, isMissingCredential, modelCredentialMissing } from "../http/errors.js";
import type { GoalsRepo } from "../db/repos/goals.js";
import type { SessionRow, SessionsRepo } from "../db/repos/sessions.js";
import { ApprovalRegistry, makeApprove } from "./approvals.js";
import type { PendingApproval } from "./approvals.js";
import type { ChannelHub } from "./channel.js";
import type { ErrorSink } from "./error-recorder.js";
import { LiveTailTracker } from "./live-tail.js";
import { asSessionSource } from "./session-sources.js";
import type { SessionSources } from "./session-sources.js";
import { StreamErrorWatcher } from "./stream-error-watcher.js";
import type { TitleNotifier } from "./title-generator.js";
import type { UsageContext } from "./usage-recorder.js";

/** 409 for when there's nothing to compact: give the specific reason rather than a one-size-fits-none message. */
function compactUnavailable(why: Exclude<CompactAvailability, "ok">): HttpError {
  const messages: Record<typeof why, string> = {
    unsupported: "This Agent does not have context compaction configured.",
    empty: "The current context has nothing to compact (no completed conversation turns yet).",
    just_compacted:
      "The context was just compacted and there is no new conversation since; no need to compact again.",
  };
  return new HttpError(409, "nothing_to_compact", messages[why]);
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
  compact(opts: { signal: AbortSignal }): AsyncGenerator<OmniMessage>;
  /** Whether compaction is possible and why; when not ok, compact() yields no messages (see core ContextEngine.compactability). */
  compactability(): CompactAvailability;
  /** Queues a mid-run steering input (core `Session.steer`); false when no Task is running. */
  steer(input: OmniMessage[]): boolean;
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
 */
export function createCoreSessionLoader(root: string, sources?: SessionSources): SessionLoader {
  return {
    async load(row: SessionRow): Promise<RuntimeSession> {
      const agent = await createAgent({
        root,
        projectId: row.projectId,
        agentId: row.agentId,
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
}

/** One queued follow-up task (`queueIfBusy`): the task input plus the per-turn thinking level it was posted with. */
interface QueuedFollowUp {
  input: OmniMessage[];
  thinkingLevel?: ThinkingLevelName;
}

/** Active-table entry: a loaded runtime Session plus its running state. */
interface RuntimeEntry {
  sessionId: string;
  projectId: string;
  agentId: string;
  /** Vendor grouping for the Session's model (paired with modelId to form a model reference). */
  provider: string;
  modelId: string;
  session: RuntimeSession;
  status: SessionStatus;
  approvals: ApprovalRegistry;
  abort: AbortController | null;
  /** The in-flight drive Promise (awaited during graceful shutdown). */
  running: Promise<void> | null;
  /**
   * Agent config generation this runtime was built under (see
   * invalidateAgentRuntimes): once it falls behind the Agent's current generation,
   * the entry is discarded on its next idle access and re-resumed via the loader.
   */
  generation: number;
  /**
   * Queued follow-up tasks (`queueIfBusy`): task inputs accepted while a Task/compaction was
   * in progress, auto-started one at a time (in order) once the session returns to idle —
   * ordinary tasks with normal semantics, unlike the mid-run steering queue. Each entry
   * keeps the per-turn thinkingLevel it was posted with (applied at auto-start).
   * Deliberately NOT discarded on abort: they are future tasks the user explicitly queued.
   */
  followUps: QueuedFollowUp[];
  /** Timestamp of last activity (refreshed on load / status flip / drive completion), used for idle-eviction checks. */
  lastActivityMs: number;
}

/** Active-table idle eviction: same convention as the SSE channel (an idle entry with no activity for 30 minutes releases its memory). */
const ENTRY_IDLE_MS = 30 * 60 * 1000;
const ENTRY_SWEEP_INTERVAL_MS = 60 * 1000;

/** Cap on collected model text for title material (accumulation stops beyond this; the generator side also truncates further). */
const TITLE_EXCERPT_LIMIT = 4000;
/**
 * Early title trigger: once this many characters of main-session body text have streamed,
 * title generation starts right away instead of waiting for the Task to finish — the core
 * Session has captured its (capped) material by then, and a long answer would only overrun
 * it. Short conversations are still covered by the completion trigger in drive's finally.
 */
const EARLY_TITLE_BODY_CHARS = 1000;

/** Composite Agent key (used as a Set key, avoiding projectId/agentId concatenation ambiguity). */
function agentKey(projectId: string, agentId: string): string {
  return `${projectId}\0${agentId}`;
}

/** If msg is a run_subagent tool call carrying a `prompt`, return its id and prompt (for use as the subagent's title); otherwise null. */
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
  modelId: string;
  /** The prompt of the run_subagent call that spawned it (user material for title generation, and the fallback title). */
  prompt: string;
  /** The model text the subagent itself produced (assistant material for title generation). */
  assistantExcerpt: string;
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

/** For a nested message, the owning Session (end of the origin chain) and text of the model reply; null if it isn't model text. */
function nestedAssistantText(msg: OmniMessage): { sessionId: string; text: string } | null {
  const p = msg.payload as { type?: string; role?: string; text?: string };
  if (msg.type !== "model_msg" || p.type !== "text" || p.role !== "assistant") return null;
  if (!msg.origin || msg.origin.length === 0 || typeof p.text !== "string") return null;
  return { sessionId: msg.origin[msg.origin.length - 1]!, text: p.text };
}

export class SessionManager {
  private readonly entries = new Map<string, RuntimeEntry>();
  /** Per-Session mutex (serializes get-or-load and status flips); auto-cleaned once the chain drains. */
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly log: (line: string) => void;
  /** Graceful-shutdown flag: once set, new Tasks/compactions are rejected (503). */
  private closed = false;
  /** Agents currently being deleted (key = agentKey): new Tasks/compactions are always rejected with 409 during this window. */
  private readonly deletingAgents = new Set<string>();
  /** Sessions currently being deleted (guards against the entry/Trace file being rebuilt and reviving it inside the deletion race window). */
  private readonly deletingSessions = new Set<string>();
  /** Per-Agent config generation (key = agentKey), bumped by invalidateAgentRuntimes on vault updates. */
  private readonly agentGenerations = new Map<string, number>();
  /** Open streaming fragments of running sessions (fed by drive, served to GET /messages; see live-tail.ts). */
  private readonly liveTail = new LiveTailTracker();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly deps: SessionManagerDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
    this.sweepTimer = setInterval(() => this.sweepIdle(), ENTRY_SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  // —— Query surface (used by Session listing / Agent active-count / SSE subscription replay) ——

  statusOf(sessionId: string): SessionStatus {
    return this.entries.get(sessionId)?.status ?? "idle";
  }

  pendingApprovalCount(sessionId: string): number {
    return this.entries.get(sessionId)?.approvals.size ?? 0;
  }

  pendingApprovals(sessionId: string): PendingApproval[] {
    return this.entries.get(sessionId)?.approvals.list() ?? [];
  }

  /** Number of queued follow-up tasks (`queueIfBusy`) awaiting auto-start. */
  pendingFollowUpCount(sessionId: string): number {
    return this.entries.get(sessionId)?.followUps.length ?? 0;
  }

  /**
   * Live tail of a running session: one synthetic `partial_* start` OmniMessage per open
   * streaming fragment, carrying the full accumulated content so far (see live-tail.ts).
   * Empty when idle or when nothing is streaming. GET /messages attaches this (with a
   * channel cursor) so a client joining mid-stream can render the in-progress message.
   */
  liveFragments(sessionId: string): OmniMessage[] {
    return this.liveTail.fragments(sessionId);
  }

  /** Number of Sessions for this Agent that are currently running / compacting. */
  activeCountForAgent(projectId: string, agentId: string): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.projectId === projectId && e.agentId === agentId && e.status !== "idle") n++;
    }
    return n;
  }

  /** Add a newly created Session to the active table (status idle), avoiding a redundant load on the next Task. */
  adopt(row: SessionRow, session: RuntimeSession): void {
    this.entries.set(row.sessionId, {
      sessionId: row.sessionId,
      projectId: row.projectId,
      agentId: row.agentId,
      provider: row.provider,
      modelId: row.modelId,
      session,
      status: "idle",
      approvals: new ApprovalRegistry(),
      abort: null,
      running: null,
      generation: this.generationOf(row.projectId, row.agentId),
      followUps: [],
      lastActivityMs: Date.now(),
    });
  }

  /**
   * After an Agent's vault is updated: bump the Agent's config generation so every
   * runtime built before the update is discarded on its next idle access and
   * re-resumed via the loader — resume re-reads agent_state/.vault.toml, so the next
   * Task on any of this Agent's Sessions runs with the new values (history is
   * preserved through the Trace). A Task already in flight is neither aborted nor
   * hot-swapped: it keeps the values it started with, and its entry is rebuilt on
   * the first access after it returns to idle (see ensureEntry).
   */
  invalidateAgentRuntimes(projectId: string, agentId: string): void {
    const key = agentKey(projectId, agentId);
    this.agentGenerations.set(key, this.generationOf(projectId, agentId) + 1);
  }

  /**
   * After a Project's models/credentials change: invalidate every cached runtime in this
   * Project, so the next Task re-resumes with the new api_key / base_url. Same
   * effective-value semantics as invalidateAgentRuntimes — no hot swap into a Task already
   * in flight. Iterating the active table is complete here, not a shortcut: the generation
   * map only matters for runtimes that are already cached, and an Agent with no cached
   * entry builds fresh through the loader anyway.
   */
  invalidateProjectRuntimes(projectId: string): void {
    const agentIds = new Set<string>();
    for (const e of this.entries.values()) {
      if (e.projectId === projectId) agentIds.add(e.agentId);
    }
    for (const agentId of agentIds) this.invalidateAgentRuntimes(projectId, agentId);
  }

  // —— Task / compaction drive ——

  /**
   * Cheap, lock-free rehearsal of the 409/503 conditions startTask checks, throwing exactly the
   * same HttpErrors. **Advisory only**: it neither takes the Session lock nor loads an entry, so
   * a session that isn't in the active table reads as acceptable and a status change racing this
   * call is not caught — the authoritative check is still the one inside startTask.
   *
   * It exists so a caller that has irreversible work to do first (POST /tasks writes the
   * message's file attachments to disk) can find out about the ordinary "a Task is already
   * running" rejection before doing it, instead of undoing it afterwards.
   */
  assertCanAcceptTask(sessionId: string, opts?: { queueIfBusy?: boolean }): void {
    this.assertOpen();
    this.assertAgentNotDeleting(sessionId);
    this.assertSessionNotDeleting(sessionId);
    const entry = this.entries.get(sessionId);
    if (entry && !opts?.queueIfBusy) this.assertIdle(entry);
  }

  /**
   * Start a Task: get-or-load → 409
   * mutual-exclusion check → publish the input messages first → drive run in the
   * background. Returns the current actual session_id (the new id after self-heal).
   * `opts.thinkingLevel` (optional, validated by the route) rides into this run's
   * `session.run` options — a per-turn parameter, applied to this Task only.
   * With `queueIfBusy`, a busy session (running/compacting) enqueues the input as a
   * follow-up instead of 409: it auto-starts as an ordinary next task once the session
   * returns to idle (`queued: true` in the result; see startQueuedFollowUp), keeping its
   * thinkingLevel for that auto-start.
   */
  async startTask(
    sessionId: string,
    input: OmniMessage[],
    opts?: { thinkingLevel?: ThinkingLevelName; queueIfBusy?: boolean },
  ): Promise<{ sessionId: string; queued: boolean }> {
    return this.withLock(sessionId, async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(sessionId);
      this.assertSessionNotDeleting(sessionId);
      const entry = await this.ensureEntry(sessionId);
      if (entry.status !== "idle" && opts?.queueIfBusy) {
        entry.followUps.push({
          input,
          ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
        });
        entry.lastActivityMs = Date.now();
        // Re-publish the current state so subscribers pick up the new queued count (the
        // input itself is published when the follow-up actually starts).
        this.publishState(entry, entry.status);
        return { sessionId: entry.sessionId, queued: true };
      }
      this.assertIdle(entry);
      this.launchTask(entry, input, opts?.thinkingLevel);
      return { sessionId: entry.sessionId, queued: false };
    });
  }

  /**
   * Start a goal run: like startTask, but the run is core goal mode — one
   * `session.run(input, { goal })` call loops rounds until a terminal state, and the
   * Session stays `running` for the whole goal (every round), so the existing abort
   * endpoint interrupts the entire loop and schedules queue behind it as usual. Round
   * inputs are yielded by core and published like any streamed message; progress
   * additionally goes out as goal_* server events and into goal_state (when a repo is
   * wired).
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
    return this.withLock(sessionId, async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(sessionId);
      this.assertSessionNotDeleting(sessionId);
      const entry = await this.ensureEntry(sessionId);
      this.assertIdle(entry);
      // The objective is the user's own text (leading skill-invocation blocks stripped) —
      // the same derivation core records in GOAL.yaml; used for the run-state row, the
      // goal_started event, and as title material.
      // `isPlainText` leaves attached images out, so this copy carries no
      // `[attached image: <path>]` lines — which suits its readers, since a status card and a
      // generated title read better without absolute scratchpad paths. Core keeps its own
      // folded copy (Session.runGoal) for what the rounds actually re-inject.
      const text = args.input
        .filter(isPlainText("user"))
        .map((m) => m.payload.text)
        .join("\n");
      const objective = stripLeadingMarkerBlocks(text).trim() || text.trim();
      const ac = new AbortController();
      entry.status = "running";
      entry.abort = ac;
      entry.lastActivityMs = Date.now();
      this.publishState(entry, "running");
      const approve = makeApprove({
        getMode: () => this.deps.sessions.findById(entry.sessionId)?.approvalMode ?? "always-ask",
        toolPermission: (name) => entry.session.toolPermission(name),
        registry: entry.approvals,
        publishRequest: (pending) =>
          this.publishEvent(entry, {
            type: "approval_request",
            toolCall: pending.toolCall,
            ...(pending.origin !== undefined ? { origin: pending.origin } : {}),
          }),
      });
      const goalId = this.deps.goals?.create({
        sessionId: entry.sessionId,
        projectId: entry.projectId,
        agentId: entry.agentId,
        objective,
        budget: args.budget,
      });
      this.publishEvent(entry, {
        type: "goal_started",
        sessionId: entry.sessionId,
        objective,
        budget: args.budget,
      });
      const gen = this.goalStream(entry, {
        input: args.input,
        budget: args.budget,
        ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
        approve,
        signal: ac.signal,
        ...(goalId !== undefined ? { goalId } : {}),
      });
      // The objective doubles as the title material (same role as a task's input text).
      entry.running = this.drive(entry, gen, { userExcerpt: objective });
      return { sessionId: entry.sessionId };
    });
  }

  /**
   * Taps core's goal-mode stream for `drive`: round boundaries (the injected `[goal]`
   * inputs) become goal_round events + goal_state refreshes, and the terminal
   * `goal_finished` event message becomes the goal_finished server event + the run-state
   * row's final status. Token numbers mirror core's own accounting (same
   * `goalTokenDelta`), so the UI shows exactly what the budget check uses.
   */
  private async *goalStream(
    entry: RuntimeEntry,
    args: {
      input: OmniMessage[];
      budget: number;
      thinkingLevel?: ThinkingLevelName;
      approve: ApproveFn;
      signal: AbortSignal;
      goalId?: number;
    },
  ): AsyncGenerator<OmniMessage> {
    const gen = entry.session.run(args.input, {
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
          this.publishEvent(entry, {
            type: "goal_round",
            sessionId: entry.sessionId,
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
          this.publishEvent(entry, {
            type: "goal_finished",
            sessionId: entry.sessionId,
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
        this.finishAborted(entry, args.goalId, round, used);
      }
    } catch (err) {
      // Core throws only on infrastructure failures (e.g. GOAL.yaml writes): close the
      // run state as aborted, then let drive's defensive catch record the error. Guarded on
      // `finished`: a throw after the terminal event must not overwrite the row's real
      // outcome (repo.finish is an unconditional UPDATE) or publish a contradicting event.
      if (!finished) this.finishAborted(entry, args.goalId, round, used);
      throw err;
    }
  }

  /** Closes a goal's run state as aborted (stream cut off / infrastructure failure). */
  private finishAborted(
    entry: RuntimeEntry,
    goalId: number | undefined,
    round: number,
    used: number,
  ): void {
    if (goalId !== undefined) this.deps.goals?.finish(goalId, "aborted", round, used);
    this.publishEvent(entry, {
      type: "goal_finished",
      sessionId: entry.sessionId,
      outcome: "aborted",
      rounds: round,
      used,
    });
  }

  /** Shared task launch (fresh tasks and auto-started follow-ups): flips to running, publishes the input, and drives the run with the per-turn thinking level (if any). Caller holds the session lock and has verified idle. */
  private launchTask(
    entry: RuntimeEntry,
    input: OmniMessage[],
    thinkingLevel?: ThinkingLevelName,
  ): void {
    const channel = this.deps.channels.get(entry.sessionId);
    const ac = new AbortController();
    entry.status = "running";
    entry.abort = ac;
    entry.lastActivityMs = Date.now();
    // Publish the input messages first (visible to other subscribers; the Trace is
    // persisted by the SDK), then flip the running status.
    for (const msg of input) channel.publish(msg);
    this.publishState(entry, "running");

    const approve = makeApprove({
      // Re-reads approval_mode from the DB on every decision (a PATCH takes effect immediately).
      getMode: () => this.deps.sessions.findById(entry.sessionId)?.approvalMode ?? "always-ask",
      toolPermission: (name) => entry.session.toolPermission(name),
      registry: entry.approvals,
      publishRequest: (pending) =>
        this.publishEvent(entry, {
          type: "approval_request",
          toolCall: pending.toolCall,
          ...(pending.origin !== undefined ? { origin: pending.origin } : {}),
        }),
    });
    const gen = entry.session.run(input, {
      approve,
      signal: ac.signal,
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    });
    // Title material is collected by the core Session itself during run; here we only
    // keep this call's input user text, used both as the "material present → attempt
    // generation" criterion and as the fallback title source if the LLM call fails.
    const userExcerpt = input
      .filter(isPlainText("user"))
      .map((m) => m.payload.text)
      .join("\n");
    entry.running = this.drive(entry, gen, { userExcerpt });
  }

  /**
   * Auto-start of queued follow-ups: called from drive's finally whenever a Task or
   * compaction finishes (abort included — follow-ups are future tasks the user queued, so
   * an abort of the current run does not discard them). Re-validates everything under the
   * session lock (another task may have snuck in, the server may be shutting down, the
   * session may be getting deleted) and launches exactly one queued input — the next
   * finish picks up the one after, keeping order and one-at-a-time semantics.
   */
  private async startQueuedFollowUp(sessionId: string): Promise<void> {
    try {
      await this.withLock(sessionId, async () => {
        if (this.closed || this.deletingSessions.has(sessionId)) return;
        const row = this.deps.sessions.findById(sessionId);
        if (row && this.deletingAgents.has(agentKey(row.projectId, row.agentId))) return;
        const entry = this.entries.get(sessionId);
        if (!entry || entry.status !== "idle" || entry.followUps.length === 0) return;
        const next = entry.followUps.shift()!;
        this.launchTask(entry, next.input, next.thinkingLevel);
      });
    } catch (err) {
      this.log(`[followup] auto-start failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Manually compact the context: 409 if already running; compaction output also flows into the SSE channel. */
  async startCompact(sessionId: string): Promise<{ sessionId: string }> {
    return this.withLock(sessionId, async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(sessionId);
      this.assertSessionNotDeleting(sessionId);
      const entry = await this.ensureEntry(sessionId);
      this.assertIdle(entry);
      // When there's nothing to compact, core's compact() yields no messages at all: we
      // can't just return 202 and walk away, or the frontend would wait forever for a
      // compaction banner that never comes (this is exactly the "/compact does nothing
      // after an interrupt" complaint). Reject explicitly, and **say why** clearly —
      // "just compacted" and "haven't talked yet" share the same internal state
      // (sessionTurns === 0), but are two completely different messages to the user:
      // telling someone who just compacted that there's "no completed conversation turn
      // yet" tells them nothing.
      const why = entry.session.compactability();
      if (why !== "ok") throw compactUnavailable(why);
      const ac = new AbortController();
      entry.status = "compacting";
      entry.abort = ac;
      entry.lastActivityMs = Date.now();
      this.publishState(entry, "compacting");
      const gen = entry.session.compact({ signal: ac.signal });
      entry.running = this.drive(entry, gen);
      return { sessionId: entry.sessionId };
    });
  }

  /** Submit an approval decision; returns false if the pending approval doesn't exist (already decided/unknown). */
  decideApproval(sessionId: string, toolCallId: string, decision: "allow" | "deny"): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    return entry.approvals.decide(toolCallId, decision);
  }

  /**
   * Mid-run steering: forward the message to the running Session (core delivers it between
   * turns as a standalone `[user_steering]` user message followed by its images — no SSE
   * event of its own; the messages arrive through the stream the drive loop already
   * publishes). 409 when the Session isn't running a Task (idle / compacting / not loaded)
   * or the run finished in the race window — the caller falls back to submitting a normal
   * task, which carries the same text and images.
   */
  steer(sessionId: string, input: OmniMessage[]): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.status !== "running" || !entry.session.steer(input)) {
      throw new HttpError(
        409,
        "not_running",
        "This Session has no Task in progress; send the message as a new task instead.",
      );
    }
    entry.lastActivityMs = Date.now();
  }

  /**
   * Advisory steering preflight used before a route writes file attachments. The authoritative
   * check remains `steer`: a Task can finish while the files are being written, in which case
   * the route removes them and returns the same 409.
   */
  assertCanSteer(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.status !== "running") {
      throw new HttpError(
        409,
        "not_running",
        "This Session has no Task in progress; send the message as a new task instead.",
      );
    }
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
    const entry = this.entries.get(sessionId);
    // Both running Tasks and compactions can be parked in a reconnect backoff.
    if (!entry || entry.status === "idle") return false;
    const skipped = entry.session.skipReconnectWait();
    if (skipped) entry.lastActivityMs = Date.now();
    return skipped;
  }

  /**
   * Interrupt the current Task/compaction: pending approvals converge to deny first,
   * then the AbortSignal fires. Returns false if nothing is in progress (the route
   * treats this as a 204 no-op).
   */
  abortTask(sessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry || !entry.abort) return false;
    entry.approvals.denyAll();
    entry.abort.abort();
    return true;
  }

  /**
   * Before deleting a Project, converge all its active runs and clear them out of the
   * active table. Returns the in-flight drive Promises of the affected entries: the
   * caller (deleteProject) should await them before removing the directory, so that
   * interrupt-cleanup Trace writes don't recreate the directory after deletion.
   */
  abortProject(projectId: string): Promise<void>[] {
    const runnings: Promise<void>[] = [];
    for (const [key, entry] of [...this.entries]) {
      if (entry.projectId !== projectId) continue;
      entry.approvals.denyAll();
      entry.abort?.abort();
      if (entry.running) runnings.push(entry.running);
      this.entries.delete(key);
    }
    return runnings;
  }

  /**
   * Before deleting an Agent, converge all its active runs and clear them out of the
   * active table (same semantics as abortProject). Also marks this Agent as "being
   * deleted": new Tasks/compactions entering during the deletion process are always
   * rejected with 409 (assertAgentNotDeleting), closing the race window where a new
   * task recreates the directory and revives an already-deleted Agent between the
   * abortAgent snapshot and the directory removal. The caller must call
   * endAgentDeletion once deletion finishes (success or failure).
   */
  beginAgentDeletion(projectId: string, agentId: string): Promise<void>[] {
    this.deletingAgents.add(agentKey(projectId, agentId));
    const runnings: Promise<void>[] = [];
    for (const [key, entry] of [...this.entries]) {
      if (entry.projectId !== projectId || entry.agentId !== agentId) continue;
      entry.approvals.denyAll();
      entry.abort?.abort();
      if (entry.running) runnings.push(entry.running);
      this.entries.delete(key);
    }
    return runnings;
  }

  endAgentDeletion(projectId: string, agentId: string): void {
    this.deletingAgents.delete(agentKey(projectId, agentId));
  }

  /**
   * Before deleting a single Session, converge its active run and clear it out of the
   * active table (same semantics as beginAgentDeletion). Also marks this Session as
   * "being deleted": new Tasks/compactions entering during the deletion process are
   * always rejected with 409 (assertSessionNotDeleting), closing the race window where
   * a new task recreates the entry and Trace file, reviving an already-deleted Session
   * between the abort snapshot and the file removal. The caller must call
   * endSessionDeletion once deletion finishes (success or failure). Returns the
   * in-flight drive Promise: the caller should await it before deleting the Trace file,
   * so cleanup writes don't recreate the file.
   */
  beginSessionDeletion(sessionId: string): Promise<void>[] {
    this.deletingSessions.add(sessionId);
    const entry = this.entries.get(sessionId);
    if (!entry) return [];
    entry.approvals.denyAll();
    entry.abort?.abort();
    this.entries.delete(sessionId);
    return entry.running ? [entry.running] : [];
  }

  endSessionDeletion(sessionId: string): void {
    this.deletingSessions.delete(sessionId);
  }

  /** Graceful shutdown: reject new tasks (503), interrupt all active runs, and wait for them to finish (default ≤5s). */
  async shutdown(timeoutMs = 5000): Promise<void> {
    this.closed = true;
    clearInterval(this.sweepTimer);
    const pending: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.abort) continue;
      entry.approvals.denyAll();
      entry.abort.abort();
      if (entry.running) pending.push(entry.running);
    }
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
    ]);
  }

  /**
   * Active-table idle eviction: removes entries that are idle (idle status, no pending
   * approvals, no in-flight drive) and have been inactive past the timeout, releasing
   * the core Session's full in-memory history. This is purely memory reclamation: the
   * next access re-resumes via the loader, so correctness is unaffected. Lock-table
   * entries are auto-cleaned by withLock once their chain drains (including leftover
   * entries under the old id after self-heal). `now` / `idleMs` are injectable for
   * tests and timers.
   */
  sweepIdle(now: number = Date.now(), idleMs: number = ENTRY_IDLE_MS): void {
    for (const [key, entry] of this.entries) {
      if (entry.status !== "idle" || entry.approvals.size !== 0 || entry.running !== null) continue;
      if (entry.followUps.length > 0) continue; // queued follow-ups must not be evicted with the entry
      if (now - entry.lastActivityMs <= idleMs) continue;
      this.entries.delete(key);
    }
  }

  // —— Internal ——

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

  /** This Session is being deleted → 409 (guards against the entry/Trace being rebuilt and reviving it inside the deletion race window). */
  private assertSessionNotDeleting(sessionId: string): void {
    if (this.deletingSessions.has(sessionId)) {
      throw new HttpError(
        409,
        "session_deleting",
        "This Session is being deleted; not accepting new Tasks.",
      );
    }
  }

  private assertIdle(entry: RuntimeEntry): void {
    if (entry.status === "running") {
      throw new HttpError(409, "task_in_progress", "This Session already has a Task in progress.");
    }
    if (entry.status === "compacting") {
      throw new HttpError(
        409,
        "compacting",
        "This Session is compacting its context; not accepting new input.",
      );
    }
  }

  private generationOf(projectId: string, agentId: string): number {
    return this.agentGenerations.get(agentKey(projectId, agentId)) ?? 0;
  }

  /** get-or-resume-or-heal: use directly on an active-table hit; otherwise load via the loader, updating the index's primary key on self-heal. */
  private async ensureEntry(sessionId: string): Promise<RuntimeEntry> {
    const existing = this.entries.get(sessionId);
    if (existing) {
      if (existing.generation === this.generationOf(existing.projectId, existing.agentId)) {
        return existing;
      }
      // Built before the last vault update: discard once idle and fall through to a
      // fresh load (resume re-reads the vault). A busy entry is returned as-is — the
      // in-flight run keeps its values and assertIdle rejects the new Task anyway;
      // it is rebuilt on the first access after it finishes.
      if (
        existing.status !== "idle" ||
        existing.running !== null ||
        existing.approvals.size !== 0
      ) {
        return existing;
      }
      this.entries.delete(sessionId);
    }
    const row = this.deps.sessions.findById(sessionId);
    if (!row) {
      throw new HttpError(
        404,
        "session_not_found",
        "Session does not exist or you do not have access.",
      );
    }
    // Captured before the (awaited) load: a vault update racing with the load leaves
    // this entry stale, so the access after next rebuilds it with the new values.
    const generation = this.generationOf(row.projectId, row.agentId);
    const session = await this.deps.loader.load(row);
    // The Session/Agent was marked for deletion while loading: discard the load result,
    // don't rebuild the entry (avoids reviving an orphaned Trace).
    this.assertSessionNotDeleting(row.sessionId);
    this.assertAgentNotDeleting(row.sessionId);
    let currentId = row.sessionId;
    if (session.sessionId !== row.sessionId) {
      // Self-heal produced a new session_id: update the index's primary key; the SSE
      // channel and pending state are naturally empty for it.
      this.deps.sessions.replaceId(row.sessionId, session.sessionId);
      currentId = session.sessionId;
    }
    const entry: RuntimeEntry = {
      sessionId: currentId,
      projectId: row.projectId,
      agentId: row.agentId,
      provider: row.provider,
      modelId: row.modelId,
      session,
      status: "idle",
      approvals: new ApprovalRegistry(),
      abort: null,
      running: null,
      generation,
      followUps: [],
      lastActivityMs: Date.now(),
    };
    this.entries.set(currentId, entry);
    return entry;
  }

  /**
   * Drive the output stream in the background: publish each message + persist usage +
   * persist LLM/tool errors; on completion (including errors) resets to idle and pushes
   * the status. `titleSource` is passed only for Task runs (compaction doesn't generate
   * a title): it collects model text for automatic title generation.
   */
  private async drive(
    entry: RuntimeEntry,
    gen: AsyncGenerator<OmniMessage>,
    titleSource?: { userExcerpt: string },
  ): Promise<void> {
    let earlyTitleFired = false;
    let mainBodyChars = 0;
    const ctx: UsageContext = {
      projectId: entry.projectId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      provider: entry.provider,
      modelId: entry.modelId,
    };
    // LLM request failures and tool execution failures aren't expressed via throw (core
    // converges them into the message stream), so the try/catch below can't catch them:
    // the watcher inspects messages one by one and fishes them out for persistence
    // (subagent failures flow through this same stream too; see stream-error-watcher).
    const watcher = this.deps.errors
      ? new StreamErrorWatcher(this.deps.errors, {
          projectId: entry.projectId,
          agentId: entry.agentId,
          sessionId: entry.sessionId,
        })
      : null;
    // Subagent (origin) registration: as soon as session_meta arrives, the child Session
    // is persisted so it appears immediately in the sidebar (the frontend picks it up
    // when it refreshes the list at task completion). The title material is "the prompt
    // of the run_subagent call that spawned this subagent" — the subagent's user input
    // is never replayed onto the parent stream (ContextEngine writes the Trace but never
    // yields it), so we can't rely on the subagent's first user message; instead we use
    // the run_subagent tool_call arguments immediately preceding it on the parent stream
    // (depth limited to 1, spawned in order, so taking the most recent one suffices).
    /** Subagents registered during this run (keyed by session id); titles are generated for each on completion. */
    const children = new Map<string, ChildSession>();
    // Unclaimed run_subagent prompts, queued in call order: a single round may spawn
    // multiple subagents in parallel, and a subagent's session_meta only carries the
    // session id (no tool_call_id), so pairing can only be approximated via FIFO (when
    // spawned in parallel and session_meta arrives out of order, two subagents' titles
    // may end up swapped — this only affects the displayed title). A call that will
    // never produce a subagent must be dequeued, or its prompt would be mismatched onto
    // the next subagent: this covers denied calls (approval_decision ≠ allow), and calls
    // that were approved but failed before spawning the subagent (e.g. agent_id doesn't
    // exist) — the latter is cleaned up when the parent-level tool_call_output settles;
    // if the call is still in the queue at that point, it never produced a session_meta.
    const subagentPrompts = new Map<string, string>();
    try {
      for await (const msg of gen) {
        // A parent-level (no origin) run_subagent call: record its prompt for the child
        // session_meta that arrives later to use as its title.
        if (!msg.origin || msg.origin.length === 0) {
          const call = runSubagentCall(msg);
          if (call) subagentPrompts.set(call.toolCallId, call.prompt);
          const denied = deniedToolCallId(msg);
          if (denied) subagentPrompts.delete(denied);
          const settled = settledToolCallId(msg);
          if (settled) subagentPrompts.delete(settled);
        } else if (isSessionMeta(msg)) {
          // Subagent registration is only a "side effect" — it must never interrupt the
          // main run flow on error: wrap the whole thing in a defensive try/catch.
          try {
            const child = this.registerChildSession(entry, msg, children);
            // Only a **direct** subagent (origin length 1) claims a queued parent-level
            // run_subagent prompt; deeper sessions are spawned by their own parent and
            // shouldn't consume from this queue.
            if (child && msg.origin!.length === 1) {
              const [pendingId] = subagentPrompts.keys();
              if (pendingId !== undefined) {
                child.prompt = subagentPrompts.get(pendingId) ?? "";
                subagentPrompts.delete(pendingId); // Consumed by this session_meta
              }
            }
          } catch (err) {
            this.log(
              `[subagent] Failed to register child session: ${err instanceof Error ? err.message : String(err)}`,
            );
            this.deps.errors?.record({
              source: "subagent",
              err,
              ctx,
              code: "subagent_register_failed",
            });
          }
        } else {
          // A subagent's model text: its title is generated from the subagent's **own
          // conversation**, so the material is accumulated here.
          const nested = nestedAssistantText(msg);
          const child = nested ? children.get(nested.sessionId) : undefined;
          if (nested && child && child.assistantExcerpt.length < TITLE_EXCERPT_LIMIT) {
            child.assistantExcerpt += (child.assistantExcerpt ? "\n" : "") + nested.text;
          }
        }
        // Early title trigger (see EARLY_TITLE_BODY_CHARS): fire as soon as enough main-
        // session body text has streamed; maybeGenerate self-guards (NULL title, single
        // flight), so the completion trigger in finally stays as the short-answer fallback.
        if (!earlyTitleFired && titleSource?.userExcerpt.trim()) {
          const p = msg.payload as { type?: string; role?: string; text?: string };
          if (
            (!msg.origin || msg.origin.length === 0) &&
            msg.type === "model_msg" &&
            p.type === "text" &&
            p.role === "assistant" &&
            p.text
          ) {
            mainBodyChars += p.text.length;
            if (mainBodyChars >= EARLY_TITLE_BODY_CHARS) {
              earlyTitleFired = true;
              this.deps.titles?.maybeGenerate(ctx, entry.session, {
                fallbackText: titleSource.userExcerpt,
              });
            }
          }
        }
        // Live-tail bookkeeping in the same synchronous tick as the publish below: the
        // messages endpoint captures "channel cursor + open fragments" between two
        // publishes, so the pair is always a consistent snapshot (see live-tail.ts).
        this.liveTail.observe(entry.sessionId, msg);
        // Re-fetch the channel before every publish (matches publishEvent): the channel
        // may have been recycled and recreated during a long wait on approval, and
        // holding a stale reference would send output to an orphaned, detached channel.
        this.deps.channels.get(entry.sessionId).publish(msg);
        watcher?.observe(msg);
        try {
          await this.deps.recorder.record(ctx, msg);
        } catch (err) {
          this.log(`[usage] Insert failed: ${err instanceof Error ? err.message : String(err)}`);
          this.deps.errors?.record({ source: "usage", err, ctx, code: "usage_insert_failed" });
        }
      }
    } catch (err) {
      // The SDK doesn't normally throw (errors are converged into the message stream);
      // this is a defensive record here to avoid crashing the runtime.
      this.log(
        `[session] Run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
      );
      this.deps.errors?.record({ source: "session", err, ctx, code: "session_run_failed" });
    } finally {
      // Wrap-up: persist any still-pending LLM failure and clear the tool-name cache (the watcher's state doesn't carry across runs).
      watcher?.close();
      // The run is over: no fragment will ever continue, so drop the live tail before the
      // idle flip (GET /messages stops attaching `live` the moment status reads idle).
      this.liveTail.clear(entry.sessionId);
      entry.approvals.denyAll();
      entry.status = "idle";
      entry.abort = null;
      entry.running = null;
      entry.lastActivityMs = Date.now();
      this.publishState(entry, "idle");
      if (titleSource && titleSource.userExcerpt.trim()) {
        // Attempt generation whenever there's user material; whether generation is
        // actually needed (title still NULL, etc.) is decided by the generator itself.
        // Material is collected by the core Session during run; here we only pass the
        // fallback text.
        this.deps.titles?.maybeGenerate(ctx, entry.session, {
          fallbackText: titleSource.userExcerpt,
        });
      }
      // Queued follow-ups: whenever a run finishes (Task or compaction, abort included),
      // the next queued input auto-starts as an ordinary task. Fire-and-forget — it
      // revalidates under the session lock.
      if (entry.followUps.length > 0) void this.startQueuedFollowUp(entry.sessionId);
      // A subagent's title is likewise generated by the model, with material being the
      // subagent's **own conversation**: the prompt that spawned it plus its own reply
      // (material the parent Session collects belongs to the parent, hence the explicit
      // override here). It piggybacks a one-shot request on the parent Session's bare
      // LLM (the child Session object never leaves the SDK); on failure/empty result the
      // generator falls back to the prompt's first line.
      for (const child of children.values()) {
        if (!child.prompt.trim()) continue;
        this.deps.titles?.maybeGenerate(
          // Bookkeeping: Session/Agent record the subagent (the title belongs to it),
          // but the model reference still uses ctx's **parent-Session** pair
          // (provider, modelId) — this one-shot request really does run on the parent
          // Session's bare LLM (a subagent may switch models via run_subagent's
          // model_id).
          { ...ctx, agentId: child.agentId, sessionId: child.sessionId },
          entry.session,
          {
            fallbackText: child.prompt,
            material: { userText: child.prompt, assistantText: child.assistantExcerpt },
            notifyOn: entry.sessionId, // Notify the frontend via the parent Session's SSE channel
          },
        );
      }
    }
  }

  /**
   * Register a subagent: persisted only when the origin message is session_meta
   * (agentId is derived from the agent_state path: `<…>/<agentId>/agent_state`).
   * **The title is left blank** — it's generated at the end of this run by the model
   * from the subagent's own conversation (see drive's finally), falling back to the
   * first line of the run_subagent prompt if generation fails. Idempotent (children
   * dedup + insertOrIgnore); a subagent has its own Trace, so it's visible in both the
   * list and the trace view. On successful registration, the entry is put into
   * `children` and returned; a duplicate session_meta returns null.
   */
  private registerChildSession(
    entry: RuntimeEntry,
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
    this.deps.sessions.insertOrIgnore({
      sessionId: childSid,
      projectId: entry.projectId,
      agentId,
      provider: p.provider,
      modelId: p.model_id,
      workspace: p.workspace,
      // A subagent's approvals are inherited from the parent Session; the index row is
      // inserted with defaults (matches the convention for Sessions discovered by the CLI).
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
    });
    // Make the subagent appear immediately in the sidebar: notify via the parent
    // Session's channel (a frontend currently watching the parent run refreshes its list in place).
    this.publishEvent(entry, {
      type: "session_created",
      projectId: entry.projectId,
      agentId,
      sessionId: childSid,
      source,
    });
    const child: ChildSession = {
      sessionId: childSid,
      agentId,
      modelId: p.model_id,
      prompt: "",
      assistantExcerpt: "",
    };
    children.set(childSid, child);
    return child;
  }

  private publishState(entry: RuntimeEntry, state: SessionStatus): void {
    // Every state flip also reports the queued follow-up count, so subscribers can render
    // the "N queued" hint without a dedicated event type.
    this.publishEvent(entry, { type: "task_state", state, queued: entry.followUps.length });
  }

  private publishEvent(entry: RuntimeEntry, event: ServerEvent): void {
    this.deps.channels.get(entry.sessionId).publish(event, "server_event");
  }

  /** Serialize (mutually exclude) execution by sessionId; cleans up the lock-table entry once its chain drains (avoids unbounded growth). */
  private async withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    // What's stored in the chain is the already-caught version (used only for
    // sequencing, never propagates errors); the caller gets the original result from `next`.
    const prev = this.locks.get(sessionId) ?? Promise.resolve();
    const next = prev.then(fn);
    const settled: Promise<void> = next
      .then(
        () => undefined,
        () => undefined,
      )
      .then(() => {
        // Only delete if still the tail of the chain (no later waiter): preserves mutual-exclusion semantics.
        if (this.locks.get(sessionId) === settled) this.locks.delete(sessionId);
      });
    this.locks.set(sessionId, settled);
    return next;
  }
}
