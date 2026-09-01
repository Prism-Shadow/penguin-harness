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
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createAgent,
  findLatestTraceFile,
  isSessionMeta,
  parseUserSteeringText,
  stripLeadingMarkerBlocks,
  tracesDir,
} from "@prismshadow/penguin-core";
import type {
  ApproveFn,
  BackgroundCommandInfo,
  BackgroundSubagentInfo,
  CompactAvailability,
  ControlEnvContext,
  OmniMessage,
  ProxyEnvPolicy,
  SessionMetaPayload,
  SessionTitleResult,
  SubagentMessageOptions,
  SubagentMessageOutcome,
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
import type { SessionRow, SessionsRepo } from "../db/repos/sessions.js";
import { ApprovalRegistry, makeApprove } from "./approvals.js";
import { goalOutcomeOf, goalProgressOf, isGoalRoundInput } from "./goal-events.js";
import type { PendingApproval } from "./approvals.js";
import type { ChannelHub } from "./channel.js";
import type { ErrorSink } from "./error-recorder.js";
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
    },
  ): AsyncGenerator<OmniMessage>;
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
  /**
   * Runs the named package's `user_prompt` hook (core `Session.runUserPromptHook` — hooks
   * run in core and nowhere else); null = the package is not installed or names no such
   * command. Optional: test fakes may omit it, reading as not installed.
   */
  runUserPromptHook?(
    name: string,
    prompt: string,
    extras?: Record<string, string | number | boolean>,
  ): Promise<{ context?: string } | null>;
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
   * Task is running — the manager then takes the queue and submits it as an ordinary task.
   * Optional: test fakes may omit it.
   */
  onBackgroundNotice?(listener: () => void): void;
  /** Takes the queued background completion notices as task input (core `Session.takeBackgroundNotices`). Optional, like onBackgroundNotice. */
  takeBackgroundNotices?(): OmniMessage[];
  /** Whether completion notices are still queued (core `Session.hasPendingBackgroundNotices`); pins the entry against idle eviction. Optional, like onBackgroundNotice. */
  hasPendingBackgroundNotices?(): boolean;
  /** Refreshes the listen-port probes behind the process list's `serviceUrl` (core `Session.probeBackgroundCommandServices`). Optional: test fakes may omit it. */
  probeBackgroundCommandServices?(): Promise<void>;
  /** Subscribes live-forwarded background-subagent messages (core `Session.onBackgroundMessage`); the manager publishes them to the session channel. Optional: test fakes may omit it. */
  onBackgroundMessage?(listener: (msg: OmniMessage) => void): void;
  /** Background command processes owned by the Session's environment (core `Session.listBackgroundCommands`). Optional: test fakes may omit it. */
  listBackgroundCommands?(): BackgroundCommandInfo[];
  /** Kills one background command process (core `Session.killBackgroundCommand`); false when the id is unknown. Optional, like listBackgroundCommands. */
  killBackgroundCommand?(processId: string): boolean;
  /** Whether a background subagent is mid-round (core `Session.hasRunningBackgroundSubagents`); pins the entry against idle eviction. Optional, like listBackgroundCommands. */
  hasRunningBackgroundSubagents?(): boolean;
  /** All live subagent child sessions of the Session's environment (core `Session.listBackgroundSubagents`). Optional, like listBackgroundCommands. */
  listBackgroundSubagents?(): BackgroundSubagentInfo[];
  /** Host message to one child session — steering mid-run, a follow-up run when idle, a revival when released (core `Session.sendToBackgroundSubagent`). Optional. */
  sendToBackgroundSubagent?(
    childSessionId: string,
    messages: OmniMessage[],
    opts?: SubagentMessageOptions,
  ): Promise<SubagentMessageOutcome>;
  /** Subscribes the host's session-lifetime fallback approval sink for child sessions (core `Session.setSubagentApprovalFallback`). Optional. */
  setSubagentApprovalFallback?(approve: ApproveFn): void;
  /** Aborts one child session's current run, keeping the session (core `Session.abortBackgroundSubagentRun`); false when unknown or idle. Optional. */
  abortBackgroundSubagentRun?(childSessionId: string): boolean;
  /** Subscribes subagent run-state changes (core `Session.onSubagentState`): the manager republishes `task_state` with the fresh live listing. Optional. */
  onSubagentState?(listener: () => void): void;
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
 * address, or null = pass the environment through). `opts.controlEnv` threads the
 * harness-control injection the same way (the server's API URL/token plus the Session's
 * coordinates; core evaluates it per Session — see CreateAgentOptions.controlEnv).
 */
export function createCoreSessionLoader(
  root: string,
  sources?: SessionSources,
  opts: {
    proxyEnv?: () => ProxyEnvPolicy | null;
    controlEnv?: (ctx: ControlEnvContext) => Record<string, string>;
  } = {},
): SessionLoader {
  return {
    async load(row: SessionRow): Promise<RuntimeSession> {
      const agent = await createAgent({
        root,
        projectId: row.projectId,
        agentId: row.agentId,
        ...(opts.proxyEnv ? { proxyEnv: opts.proxyEnv } : {}),
        ...(opts.controlEnv ? { controlEnv: opts.controlEnv } : {}),
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

/** One queued follow-up task (`queueIfBusy`): the task input plus the per-turn thinking level it was posted with. */
interface QueuedFollowUp {
  /** Recall handle (PendingFollowUpInfo.id), assigned at queue time. */
  id: string;
  input: OmniMessage[];
  thinkingLevel?: ThinkingLevelName;
  /**
   * Original content for recall, and the content `task_state` shows on the queued line.
   * Always present: a caller that knows more than the input carries (the HTTP route, which
   * also knows where the file attachments landed on disk) supplies it, and every other
   * queueing path gets it derived from the input — what can be recalled must not depend on
   * which door the message came through.
   */
  recall: RecallStore;
}

/** One undelivered steering entry: the display info broadcast on task_state, plus what a recall needs — the exact input list core queued (its unsteer handle) and the original content. */
interface PendingSteeringEntry {
  info: PendingSteeringInfo;
  input: OmniMessage[];
  recall: RecallStore;
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
  /**
   * The running Task's input messages, held from launch until the run ends. The engine
   * writes these exact envelopes to the Trace only after the session bootstrap (MCP
   * connect + discovery on the first run), so a history read during that window would
   * miss the user's own message — and the draft flow subscribes to the stream only after
   * the input publish, so the live channel cannot backfill it either. GET /messages
   * appends the ones the Trace has not caught up to yet (exact-envelope dedup).
   */
  pendingInputs: OmniMessage[];
  /**
   * The running Task's streamed bootstrap records (mcp_connect begin/end,
   * tool_list_ready), held until the run ends. Their Trace writes are deferred by the
   * engine until after the input lands (turn attribution), and the draft flow subscribes
   * only after they were published — so a history rebuild during the MCP connect would
   * otherwise show nothing at all (a silent blank while a slow server times out).
   * GET /messages appends whichever of them the Trace has not caught up to.
   */
  pendingBootstrap: OmniMessage[];
  /**
   * Steering messages queued on core but not yet delivered to the model — a display mirror
   * of core's steering queue (same FIFO order), so the composer's "steering queued" hint and
   * its content survive reloads: pushed on `steer`, shifted as each `[user_steering]`
   * message appears on the drive stream, dropped wholesale when the run exits (core
   * discards undelivered steering on abort/completion). The `info` halves are broadcast on
   * every `task_state`; the rest is the recall handle (see recallSteering).
   */
  pendingSteering: PendingSteeringEntry[];
  /** Timestamp of last activity (refreshed on load / status flip / drive completion), used for idle-eviction checks. */
  lastActivityMs: number;
}

/** Active-table idle eviction: same convention as the SSE channel (an idle entry with no activity for 30 minutes releases its memory). */
const ENTRY_IDLE_MS = 30 * 60 * 1000;
const ENTRY_SWEEP_INTERVAL_MS = 60 * 1000;

/** Composite Agent key (used as a Set key, avoiding projectId/agentId concatenation ambiguity). */
function agentKey(projectId: string, agentId: string): string {
  return `${projectId}\0${agentId}`;
}

/** The `task_state` display info of one queued follow-up (see PendingFollowUpInfo). */
function followUpInfo(f: QueuedFollowUp): PendingFollowUpInfo {
  return {
    id: f.id,
    text: f.recall.text,
    images: f.recall.images.length,
    files: f.recall.files.length,
  };
}

/**
 * The recall store of a queued input whose caller supplied none: everything recallable is
 * already in the input itself — the user's text and the inline image URLs, the only two
 * shapes a task input is ever built from.
 *
 * `files` is empty because the path a written attachment landed on is known only to
 * whoever wrote it. A caller that wrote some therefore builds its store on top of this one
 * instead of leaving it to be derived, and passes the input as it stood BEFORE the
 * `[attached file: …]` lines were folded in — derived from the folded input, `text` would
 * hand a recall back a raw scratchpad path in place of the chip it was meant to restore.
 */
export function recallStoreOf(input: OmniMessage[]): RecallStore {
  const text = input
    .filter(isPlainText("user"))
    .map((m) => m.payload.text)
    .join("\n");
  const images: string[] = [];
  for (const msg of input) {
    const payload = msg.payload as { type?: string; image_url?: unknown };
    if (
      msg.type === "model_msg" &&
      payload.type === "image_url" &&
      typeof payload.image_url === "string"
    ) {
      images.push(payload.image_url);
    }
  }
  return { text, images, files: [] };
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
  /** Clock for persisted timestamps (see SessionManagerDeps.now); wall clock unless injected. */
  private readonly now: () => Date;

  constructor(private readonly deps: SessionManagerDeps) {
    this.log = deps.log ?? ((line) => console.error(line));
    this.now = deps.now ?? (() => new Date());
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

  /** Steering messages queued but not yet delivered to the model (display mirror; see RuntimeEntry.pendingSteering). */
  pendingSteeringOf(sessionId: string): PendingSteeringInfo[] {
    return (this.entries.get(sessionId)?.pendingSteering ?? []).map((p) => p.info);
  }

  /**
   * Live subagent children of an ACTIVE runtime entry (empty when the session is not loaded
   * — after a restart there is no in-process child left to report, so empty is the truth).
   * Rides `task_state` events and the SSE subscribe snapshot; the panel renders child
   * running marks from this instead of parsing tool-output text.
   */
  subagentsOf(sessionId: string): BackgroundSubagentInfo[] {
    return this.entries.get(sessionId)?.session.listBackgroundSubagents?.() ?? [];
  }

  /**
   * Host message to one child session — a user input on the child, whatever its state:
   * steering while it runs, a follow-up run while it is idle, a revival (resume-session
   * semantics) when it is no longer live (core `Session.sendToBackgroundSubagent`). The
   * parent runtime itself is loaded on demand (ensureEntry — the same get-or-resume path a
   * task uses), so messaging a child of a long-idle conversation works after a restart too;
   * the resume fallback names the child's owning Agent from its own session row, which must
   * belong to the parent's project.
   */
  async sendToSubagent(
    sessionId: string,
    childSessionId: string,
    messages: OmniMessage[],
    thinkingLevel?: ThinkingLevelName,
  ): Promise<SubagentMessageOutcome> {
    const entry = await this.ensureEntry(sessionId);
    entry.lastActivityMs = Date.now();
    const childRow = this.deps.sessions.findById(childSessionId);
    const resume =
      childRow && childRow.projectId === entry.projectId
        ? { agentId: childRow.agentId }
        : undefined;
    return (
      (await entry.session.sendToBackgroundSubagent?.(childSessionId, messages, {
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(resume ? { resume } : {}),
      })) ?? "gone"
    );
  }

  /** Host abort of one child session's current run (core `Session.abortBackgroundSubagentRun`); false when the parent runtime is not loaded, the child is unknown, or it is idle. */
  abortSubagentRun(sessionId: string, childSessionId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    entry.lastActivityMs = Date.now();
    return entry.session.abortBackgroundSubagentRun?.(childSessionId) ?? false;
  }

  /** Queued follow-up tasks awaiting auto-start, as their display/recall info (id + content summary). */
  pendingFollowUpsOf(sessionId: string): PendingFollowUpInfo[] {
    return (this.entries.get(sessionId)?.followUps ?? []).map(followUpInfo);
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

  /**
   * The running Task's input messages as published at launch; empty when idle. The engine
   * writes these exact envelopes to the Trace only after the first run's bootstrap (MCP
   * connect + discovery), so GET /messages appends whichever of them the Trace read has
   * not caught up to yet — without this, a client rebuilding history during the connect
   * (the draft flow subscribes only after the input publish) loses the user's own message.
   */
  pendingInputs(sessionId: string): OmniMessage[] {
    return this.entries.get(sessionId)?.pendingInputs ?? [];
  }

  /** The running Task's streamed bootstrap records (see RuntimeEntry.pendingBootstrap); empty when idle. */
  pendingBootstrap(sessionId: string): OmniMessage[] {
    return this.entries.get(sessionId)?.pendingBootstrap ?? [];
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
      pendingInputs: [],
      pendingBootstrap: [],
      pendingSteering: [],
      lastActivityMs: Date.now(),
    });
    // Same wiring as ensureEntry: adopt IS the entry path for a session created in this
    // process (POST /sessions), and a listener registered only on the loader path left
    // freshly created sessions unable to deliver idle-arrival completion reports.
    this.registerNoticeListener(row.sessionId, session);
  }

  /**
   * Subscribes the background hooks on a runtime Session entering the active table — every
   * insertion path must call it (ensureEntry's loads, adopt's fresh creations):
   * - the idle-arrival signal for completion notices (mid-run arrivals are delivered inside
   *   the run by core; this signal is the only trigger left when the session sits idle);
   * - live-forwarded background-subagent messages, published to the session channel (the
   *   same feed SSE relays) and recorded for usage — a background child streams to the
   *   frontend in real time past the launching turn's end, until its terminal state;
   * - subagent run-state changes, republished as `task_state` so the panel's running
   *   marks track child rounds structurally instead of parsing tool-output text.
   */
  private registerNoticeListener(sessionId: string, session: RuntimeSession): void {
    session.onBackgroundNotice?.(() => void this.startBackgroundNoticeTask(sessionId));
    session.onBackgroundMessage?.((msg) => this.forwardBackgroundMessage(sessionId, msg));
    session.onSubagentState?.(() => {
      const entry = this.entries.get(sessionId);
      if (entry) this.publishState(entry, entry.status);
    });
    // The entry-lifetime approve doubles as the children's fallback approval sink: a child
    // approval with no window and no background-launch standing sink escalates to the user
    // (SSE approval_request) instead of parking until the model's next poll — the parent
    // session idle included.
    const entry = this.entries.get(sessionId);
    if (entry) session.setSubagentApprovalFallback?.(this.entryApprove(entry));
  }

  /**
   * The entry-lifetime approval callback: the registry, the per-decision approval-mode
   * re-read, and the SSE escalation are all entry-scoped, so one instance serves every run
   * of the entry and the children's session-lifetime fallback sink alike.
   */
  private entryApprove(entry: RuntimeEntry): ApproveFn {
    return makeApprove({
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
  }

  /** Publishes one live background-subagent message and records its usage (fire-and-forget; the child's own Trace is the durable record). */
  private forwardBackgroundMessage(sessionId: string, msg: OmniMessage): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    // A child producing messages IS session activity: without this stamp the idle sweep
    // measures only the launching task, and a long background run ages into eviction.
    entry.lastActivityMs = Date.now();
    this.deps.channels.get(entry.sessionId).publish(msg);
    const ctx: UsageContext = {
      projectId: entry.projectId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      provider: entry.provider,
      modelId: entry.modelId,
    };
    void this.deps.recorder.record(ctx, msg).catch((err: unknown) => {
      this.log(`[usage] Insert failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({ source: "usage", err, ctx, code: "usage_insert_failed" });
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
   * Run a metadata operation at an idle Session boundary under the same mutex as Task and
   * compaction starts. Session fork uses this to snapshot an append-only Trace without a Task
   * beginning between its status check and final read. An uncached Session is idle by definition;
   * unlike startTask this path deliberately does not load a heavyweight runtime.
   */
  async atIdleBoundary<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    return this.withLock(sessionId, async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(sessionId);
      this.assertSessionNotDeleting(sessionId);
      const entry = this.entries.get(sessionId);
      if (entry) this.assertIdle(entry);
      return operation();
    });
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
   * thinkingLevel for that auto-start. `opts.recall` is that queued message's original
   * content — optional, because only the HTTP route knows the parts of it the input does
   * not carry (the pre-attachment text and where each file landed on disk); every other
   * caller's store is read off the input, so a queued follow-up is recallable and shows
   * its content whichever path queued it.
   */
  async startTask(
    sessionId: string,
    input: OmniMessage[],
    opts?: { thinkingLevel?: ThinkingLevelName; queueIfBusy?: boolean; recall?: RecallStore },
  ): Promise<{ sessionId: string; queued: boolean }> {
    return this.withLock(sessionId, async () => {
      this.assertOpen();
      this.assertAgentNotDeleting(sessionId);
      this.assertSessionNotDeleting(sessionId);
      const entry = await this.ensureEntry(sessionId);
      if (entry.status !== "idle" && opts?.queueIfBusy) {
        entry.followUps.push({
          id: randomUUID(),
          input,
          ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
          // The original content rides the queue so a recall can hand it back, and so the
          // queued line shows what is waiting (see recallFollowUp). Callers that know more
          // than the input carries pass their own; the rest get it read off the input.
          recall: opts.recall ?? recallStoreOf(input),
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
   * Runs the named package's `user_prompt` hook on a Session — the core-owned execution
   * behind a host flow's prompt expansion (the goal route calls it before startGoal).
   * Ensures the runtime entry so the core Session exists; null = not installed (the
   * route's 409 cue).
   */
  async runUserPromptHook(
    sessionId: string,
    name: string,
    prompt: string,
    extras?: Record<string, string | number | boolean>,
  ): Promise<{ context?: string } | null> {
    // The entry is resolved under the lock; the script itself runs outside it, so a slow
    // hook (up to its timeout) never blocks the session's other operations.
    const session = await this.withLock(sessionId, async () => {
      this.assertOpen();
      return (await this.ensureEntry(sessionId)).session;
    });
    return (await session.runUserPromptHook?.(name, prompt, extras)) ?? null;
  }

  /**
   * Start a goal run: like startTask, but the input is the round-1 message the goal plugin's
   * start script composed (the route ran it and wrote the Session's goal file), and the
   * plugin's stop hook drives every later round inside this one `session.run` call — so the
   * Session stays `running` for the whole goal (every round), the existing abort endpoint
   * interrupts the entire loop and schedules queue behind it as usual. Round inputs are
   * yielded by core and published like any streamed message; progress additionally goes out
   * as goal_* server events (the run state itself is the goal file the plugin maintains).
   */
  async startGoal(
    sessionId: string,
    args: {
      /** Round-1 input: the user's own message(s), then the plugin's protocol message stamped `sender: "harness"`. */
      input: OmniMessage[];
      /** The user's own objective text (leading marker blocks stripped): the goal_started event and the title material. */
      objective: string;
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
      const objective = args.objective;
      const ac = new AbortController();
      entry.status = "running";
      entry.abort = ac;
      entry.lastActivityMs = Date.now();
      // Round-1 input: same publish + pendingInputs hold as launchTask. Core never yields
      // a run's own initial input (only the stop hook's later injections), so without this
      // publish the round-1 messages reach only the Trace — a page already subscribed (a
      // second goal on the session) would not see the user's message or the protocol
      // message until a reload. Append + bootstrap reset for the same abort-mid-bootstrap
      // reasons as launchTask.
      entry.pendingInputs = [...entry.pendingInputs, ...args.input];
      entry.pendingBootstrap = [];
      const channel = this.deps.channels.get(entry.sessionId);
      for (const msg of args.input) channel.publish(msg);
      this.publishState(entry, "running");
      const approve = this.entryApprove(entry);
      this.publishEvent(entry, {
        type: "goal_started",
        sessionId: entry.sessionId,
        objective,
        budget: args.budget,
      });
      // Same fallback chain as a task: the goal's own level, else the Session's pinned one.
      const thinkingLevel = this.runThinkingLevel(entry.sessionId, args.thinkingLevel);
      const gen = this.goalStream(entry, {
        input: args.input,
        budget: args.budget,
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        approve,
        signal: ac.signal,
      });
      // The objective doubles as the title material (same role as a task's input text).
      entry.running = this.drive(entry, gen, { userExcerpt: objective });
      return { sessionId: entry.sessionId };
    });
  }

  /**
   * Taps a goal run's stream for `drive`: round boundaries become goal_round events —
   * round 1 from the seeded input (core never yields a run's initial input, so it is
   * counted here, where startGoal published it), later rounds from the stop-hook continues
   * core yields — and the goal hook's `stop` event becomes the
   * goal_finished server event. `used` is what the hook last recorded in its event's
   * `output` — the same number its budget check used — so the UI never shows a different
   * figure. A stream that ends without the hook's terminal event (a cut-off run, an
   * infrastructure failure) closes as `aborted`.
   */
  private async *goalStream(
    entry: RuntimeEntry,
    args: {
      input: OmniMessage[];
      budget: number;
      thinkingLevel?: ThinkingLevelName;
      approve: ApproveFn;
      signal: AbortSignal;
    },
  ): AsyncGenerator<OmniMessage> {
    const gen = entry.session.run(args.input, {
      approve: args.approve,
      signal: args.signal,
      ...(args.thinkingLevel !== undefined ? { thinkingLevel: args.thinkingLevel } : {}),
    });
    let round = 0;
    let used = 0;
    let finished = false;
    // Round 1's boundary is the seeded input itself: it never comes back out of `gen`.
    for (const msg of args.input) {
      if (isGoalRoundInput(msg)) {
        round++;
        this.publishEvent(entry, {
          type: "goal_round",
          sessionId: entry.sessionId,
          round,
          used,
          budget: args.budget,
        });
      }
    }
    try {
      for await (const msg of gen) {
        if (isGoalRoundInput(msg)) {
          round++;
          this.publishEvent(entry, {
            type: "goal_round",
            sessionId: entry.sessionId,
            round,
            used,
            budget: args.budget,
          });
        }
        const progress = goalProgressOf(msg);
        if (progress) used = progress.tokensUsed;
        const outcome = goalOutcomeOf(msg);
        if (outcome) {
          finished = true;
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
      if (!finished) this.finishAborted(entry, round, used);
    } catch (err) {
      // Core throws only on infrastructure failures: close the goal
      // as aborted, then let drive's defensive catch record the error. Guarded on
      // `finished`: a throw after the terminal event must not publish a contradicting event.
      if (!finished) this.finishAborted(entry, round, used);
      throw err;
    }
  }

  /** Closes a goal as aborted for the UI (stream cut off / infrastructure failure). */
  private finishAborted(entry: RuntimeEntry, round: number, used: number): void {
    this.publishEvent(entry, {
      type: "goal_finished",
      sessionId: entry.sessionId,
      outcome: "aborted",
      rounds: round,
      used,
    });
  }

  /** Shared task launch (fresh tasks and auto-started follow-ups): flips to running, publishes the input, and drives the run with the per-turn thinking level (if any). Caller holds the session lock and has verified idle. */
  /**
   * Thinking level for one run: the level the request carried wins, else the level pinned
   * on the Session row (PATCH /api/sessions/:id — the Web App's in-chat picker), else
   * undefined so core keeps falling back to the Agent config. Resolved at LAUNCH time, so
   * a queued follow-up that carried no level of its own picks up the pin as it stands when
   * it finally starts, and a pin set mid-run applies from the next run.
   */
  private runThinkingLevel(
    sessionId: string,
    requested?: ThinkingLevelName,
  ): ThinkingLevelName | undefined {
    return requested ?? this.deps.sessions.findById(sessionId)?.thinkingLevel ?? undefined;
  }

  private launchTask(
    entry: RuntimeEntry,
    input: OmniMessage[],
    requestedThinkingLevel?: ThinkingLevelName,
  ): void {
    const thinkingLevel = this.runThinkingLevel(entry.sessionId, requestedThinkingLevel);
    const channel = this.deps.channels.get(entry.sessionId);
    const ac = new AbortController();
    entry.status = "running";
    entry.abort = ac;
    entry.lastActivityMs = Date.now();
    // Publish the input messages first (visible to other subscribers; the Trace is
    // persisted by the SDK), then flip the running status. The same envelopes are held as
    // pendingInputs so GET /messages can serve them before the engine's Trace write
    // catches up (delayed by the first run's MCP connect). APPEND, don't replace: inputs
    // of a run aborted mid-bootstrap are still held (nothing reached the Trace; core
    // carries them into this run) and must stay served until this run persists them.
    // The previous attempt's bootstrap records are dropped instead — this run streams
    // its own connect phase, and a stale aborted pair would render as an extra row.
    entry.pendingInputs = [...entry.pendingInputs, ...input];
    entry.pendingBootstrap = [];
    for (const msg of input) channel.publish(msg);
    this.publishState(entry, "running");

    const approve = this.entryApprove(entry);
    const gen = entry.session.run(input, {
      approve,
      signal: ac.signal,
      ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    });
    // This call's input user text is the whole title source: drive persists its first
    // words as the immediate fallback and hands it to the LLM as the generation material
    // (user input only — generation never waits for model output).
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
   *
   * `recall` is the queued message's original content: its summary (with a fresh id) is
   * mirrored on the entry and broadcast via `task_state` (and the SSE subscribe snapshot)
   * until the delivered `[user_steering]` message is observed on the stream — that is what
   * keeps the composer's "steering queued" hint, content included, alive across reloads —
   * and the content itself is what a recall (recallSteering) hands back to the composer.
   */
  steer(sessionId: string, input: OmniMessage[], recall: RecallStore): void {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.status !== "running" || !entry.session.steer(input)) {
      throw new HttpError(
        409,
        "not_running",
        "This Session has no Task in progress; send the message as a new task instead.",
      );
    }
    entry.pendingSteering.push({
      info: {
        id: randomUUID(),
        text: recall.text,
        images: recall.images.length,
        files: recall.files.length,
      },
      input,
      recall,
    });
    entry.lastActivityMs = Date.now();
    this.publishState(entry, entry.status);
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
    const entry = this.entries.get(sessionId);
    const i = entry?.pendingSteering.findIndex((p) => p.info.id === steerId) ?? -1;
    const pending = i >= 0 ? entry!.pendingSteering[i]! : undefined;
    if (!entry || !pending || !(entry.session.unsteer?.(pending.input) ?? false)) {
      throw new HttpError(
        409,
        "not_pending",
        "This steering message was already delivered to the model and can no longer be recalled.",
      );
    }
    entry.pendingSteering.splice(i, 1);
    entry.lastActivityMs = Date.now();
    this.publishState(entry, entry.status);
    return pending.recall;
  }

  /**
   * Recall a queued follow-up task (#287): remove it from the queue before it auto-starts,
   * re-broadcast state, and hand back its original content (plus the thinking level it was
   * queued with). Being in the queue is the whole condition — every queued entry carries a
   * recall store (see QueuedFollowUp.recall), so no queued message is ever refused. 409
   * `follow_up_started` when the id is not in the queue: it already auto-started, or the
   * runtime was released and took the queue with it. Its own code, distinct from steering's
   * `not_pending`, because the two mean different things to the user — a follow-up became a
   * task of its own, a steering message reached the model mid-run.
   */
  recallFollowUp(
    sessionId: string,
    followUpId: string,
  ): { recall: RecallStore; thinkingLevel?: ThinkingLevelName } {
    const entry = this.entries.get(sessionId);
    const i = entry?.followUps.findIndex((f) => f.id === followUpId) ?? -1;
    const queued = i >= 0 ? entry!.followUps[i]! : undefined;
    if (!entry || !queued) {
      throw new HttpError(
        409,
        "follow_up_started",
        "This follow-up message already started and can no longer be recalled.",
      );
    }
    entry.followUps.splice(i, 1);
    entry.lastActivityMs = Date.now();
    this.publishState(entry, entry.status);
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
    // Deny only the MAIN session's pending approvals: an approval blocks the run the user is
    // stopping. A subagent child survives the parent's stop, and so does its question.
    entry.approvals.denyMain();
    entry.abort.abort();
    return true;
  }

  /**
   * Background command processes of a LOADED session (empty when the entry is not in
   * the active table — a resumed entry starts with a fresh environment and can only
   * ever report an empty list, so nothing is resurrected just to answer a poll).
   */
  listProcesses(sessionId: string): BackgroundCommandInfo[] {
    return this.entries.get(sessionId)?.session.listBackgroundCommands?.() ?? [];
  }

  /**
   * Refreshes the listen-port probes behind the process list's `serviceUrl` (core
   * `Session.probeBackgroundCommandServices`): called by the processes route before
   * listing, so the first fetch already carries probed URLs. Bounded by core's own probe
   * timeout and TTL; a session that isn't loaded has no processes to probe.
   */
  async probeProcessServices(sessionId: string): Promise<void> {
    await this.entries.get(sessionId)?.session.probeBackgroundCommandServices?.();
  }

  /** Kills one background command process of a loaded session; false when the session isn't loaded or the id is unknown. */
  killProcess(sessionId: string, processId: string): boolean {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;
    const killed = entry.session.killBackgroundCommand?.(processId) ?? false;
    if (killed) entry.lastActivityMs = Date.now();
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
    const entry = this.entries.get(sessionId);
    if (!entry) return "not_found";
    const info = entry.session.listBackgroundCommands?.().find((p) => p.processId === processId);
    if (!info) return "not_found";
    if (info.running) return "running";
    const removed = entry.session.killBackgroundCommand?.(processId) ?? false;
    if (!removed) return "not_found";
    entry.lastActivityMs = Date.now();
    return "removed";
  }

  /**
   * Disposes a just-removed entry's runtime — after its in-flight drive (if any)
   * settles, so interrupt cleanup never races a dying environment. Deleting a Session /
   * Agent / Project is the one intent that must also end the background processes the
   * conversation started (a dev server surviving its deleted conversation is
   * unreachable from every UI, running forever).
   */
  private disposeRemoved(entry: RuntimeEntry): void {
    const dispose = (): void => entry.session.dispose?.();
    if (entry.running) void entry.running.then(dispose, dispose);
    else dispose();
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
      this.disposeRemoved(entry);
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
      this.disposeRemoved(entry);
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
    this.disposeRemoved(entry);
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
      entry.approvals.denyAll();
      entry.abort?.abort();
      if (entry.running) pending.push(entry.running);
      // Suspend means the environment too: dispose kills the Session's remaining
      // background processes (a dev server the conversation started, etc.). Without
      // this, a hot swap orphans them — the OS process keeps running while the next
      // App's freshly resumed Session starts with an empty process list, so the stop
      // control has gone blind. Sequenced after the in-flight drive settles, the same
      // ordering disposeRemoved uses.
      const dispose = (): void => entry.session.dispose?.();
      if (entry.running) void entry.running.then(dispose, dispose);
      else dispose();
    }
    this.entries.clear();
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
      // A live background process (e.g. a dev server the conversation started) pins the
      // entry: eviction would strand the process — a resumed entry starts with a fresh
      // environment, so the process list and its stop control would go blind while the
      // OS process kept running. Exited-but-listed processes don't pin anything.
      if (entry.session.listBackgroundCommands?.().some((p) => p.running)) continue;
      // A background subagent still working pins it for the same reason: a run_in_background
      // child outlives the call that launched it, and its completion report and live messages
      // are delivered through the very Session object eviction would drop.
      if (entry.session.hasRunningBackgroundSubagents?.()) continue;
      // Undelivered background completion notices pin the entry too: they live in the core
      // Session object, so evicting it would silently drop them.
      if (entry.session.hasPendingBackgroundNotices?.()) continue;
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
      pendingInputs: [],
      pendingBootstrap: [],
      pendingSteering: [],
      lastActivityMs: Date.now(),
    };
    this.entries.set(currentId, entry);
    this.registerNoticeListener(currentId, session);
    return entry;
  }

  /**
   * Auto-start of queued background completion notices: called when core signals an
   * idle-session arrival, and from drive's finally for notices that raced a run's exit.
   * Revalidates under the session lock; only an idle entry launches, and only when the
   * queue is non-empty — a busy entry skips, because the running/queued task's engine
   * drains the same queue at its own boundaries (each notice is delivered exactly once).
   */
  private async startBackgroundNoticeTask(sessionId: string): Promise<void> {
    try {
      await this.withLock(sessionId, async () => {
        if (this.closed || this.deletingSessions.has(sessionId)) return;
        const row = this.deps.sessions.findById(sessionId);
        if (row && this.deletingAgents.has(agentKey(row.projectId, row.agentId))) return;
        const entry = this.entries.get(sessionId);
        if (!entry) {
          // The runtime entry left the active table between the signal and this lock —
          // the queued notices left with the released Session object. Say so instead of
          // dropping the report invisibly (the sweep pins entries with pending notices,
          // so this is a genuine anomaly worth a trace in the log).
          this.log(`[background] notice for ${sessionId} dropped: runtime entry not loaded`);
          return;
        }
        // Busy or queued-behind: not a loss — the running/next run's engine drains the
        // same notice queue at its own input-assembly boundaries.
        if (entry.status !== "idle" || entry.followUps.length > 0) return;
        const input = entry.session.takeBackgroundNotices?.() ?? [];
        if (input.length === 0) return;
        this.launchTask(entry, input);
      });
    } catch (err) {
      this.log(
        `[background] notice task start failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Drive the output stream in the background: publish each message + persist usage +
   * persist LLM/tool errors; on completion (including errors) resets to idle and pushes
   * the status. `titleSource` is passed only for Task runs (compaction doesn't generate
   * a title): its user text drives automatic title generation at run start.
   */
  private async drive(
    entry: RuntimeEntry,
    gen: AsyncGenerator<OmniMessage>,
    titleSource?: { userExcerpt: string },
  ): Promise<void> {
    const ctx: UsageContext = {
      projectId: entry.projectId,
      agentId: entry.agentId,
      sessionId: entry.sessionId,
      provider: entry.provider,
      modelId: entry.modelId,
    };
    // Title policy fires at run start, from the user input alone: the generator persists
    // the input's first words as an immediate fallback and issues the LLM replacement
    // request without waiting for any model output (maybeGenerate self-guards: manual
    // renames are final, one generation in flight per session).
    if (titleSource?.userExcerpt.trim()) {
      this.deps.titles?.maybeGenerate(ctx, entry.session, {
        fallbackText: titleSource.userExcerpt,
        material: { userText: titleSource.userExcerpt, assistantText: "" },
      });
    }
    // Every driven run (a Task, a compaction, or a whole goal loop — startGoal hands all of
    // its rounds to ONE drive) writes Trace lines: flip the row's has_trace cache here, the
    // single choke point, so listing can serve it from the DB without a directory walk (see
    // SessionService.listSessions). The same statement stamps last_active_at, so a run costs
    // one row write here and one more when it ends (see the finally) — never one per streamed
    // message; activity during the run (steering, approvals, queued follow-ups) rides on the
    // run-end stamp. Guarded: this runs BEFORE the try below, so an unexpected DB failure
    // (a closed handle after shutdown) would otherwise reject drive() with no finally to
    // reach — leaving the entry pinned "running" and every later Task 409ing for the
    // process's lifetime.
    this.touchRow(ctx, (repo, at) => repo.markDriven(ctx.sessionId, at));
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
    /** Subagents registered during this run (keyed by session id); each gets its title generated at registration, from its spawning prompt alone. */
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
          // Steering delivery: core emits exactly one `[user_steering]` user text per queued
          // entry, in queue order — shift the display mirror and re-broadcast so the
          // composer's "steering queued" hint retires the moment the message is on stream.
          if (entry.pendingSteering.length > 0 && isDeliveredSteering(msg)) {
            entry.pendingSteering.shift();
            this.publishState(entry, entry.status);
          }
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
              // The subagent's title is generated right here at registration, from the
              // spawning prompt alone (its "user input") — never waiting for the
              // subagent's own output. It piggybacks a one-shot request on the parent
              // Session's bare LLM (the child Session object never leaves the SDK):
              // Session/Agent record the subagent (the title belongs to it), but the
              // model reference keeps ctx's parent-Session (provider, modelId) pair —
              // a subagent may switch models via run_subagent's model_id.
              if (child.prompt.trim()) {
                this.deps.titles?.maybeGenerate(
                  { ...ctx, agentId: child.agentId, sessionId: child.sessionId },
                  entry.session,
                  {
                    fallbackText: child.prompt,
                    material: { userText: child.prompt, assistantText: "" },
                    notifyOn: entry.sessionId, // Notify the frontend via the parent Session's SSE channel
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
              ctx,
              code: "subagent_register_failed",
            });
          }
        }
        // Bootstrap records (first-run MCP connect + toolset): held for GET /messages
        // until the engine's deferred Trace write catches up (see pendingBootstrap).
        if (!msg.origin || msg.origin.length === 0) {
          const bt = (msg.payload as { type?: string }).type;
          if (bt === "mcp_connect_begin" || bt === "mcp_connect_end" || bt === "tool_list_ready") {
            entry.pendingBootstrap.push(msg);
          }
          // First request of the run: the engine writes input → bootstrap records → tool
          // list to the Trace BEFORE issuing the request, so both holds are persisted by
          // now — end them here rather than at idle. Holding for the whole run would
          // outlive the messages endpoint's tail-window dedup: once the Task appends
          // more records than the window, the input would be judged "not yet in the
          // Trace" and served a second time at the end of history.
          if (bt === "request_begin") {
            entry.pendingInputs = [];
            entry.pendingBootstrap = [];
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
      // The pending holds are NOT cleared here: a run aborted mid-bootstrap wrote nothing
      // to the Trace, so its held input (and the aborted connect pair) are the only copy
      // a reload can show until the next run carries the input forward and persists it.
      // Runs that issued a request already cleared them at their first request_begin.
      // Main approvals only: an origin-tagged approval belongs to a subagent child that
      // outlives this task — it stays pending for the user (see ApprovalRegistry.denyMain).
      entry.approvals.denyMain();
      entry.status = "idle";
      entry.abort = null;
      entry.running = null;
      // The run is over, so core has discarded any undelivered steering (see ContextEngine's
      // steeringQueue) — drop the mirror with it; the idle publish below broadcasts the
      // now-empty state.
      entry.pendingSteering = [];
      entry.lastActivityMs = Date.now();
      // Run-end stamp (see the run-start counterpart at the top of drive). Guarded like
      // every other write in this finally: what follows — the idle broadcast and the
      // auto-start of queued follow-ups (this is its only call site) — must not be
      // skippable by a DB failure, or SSE clients would sit on "running" forever with
      // their queue stranded. A no-op UPDATE when the row is already gone: deletion
      // normally awaits the drive first, so that only happens once its 5s wait times out.
      this.touchRow(ctx, (repo, at) => repo.touchLastActive(ctx.sessionId, at));
      this.publishState(entry, "idle");
      // Queued follow-ups: whenever a run finishes (Task or compaction, abort included),
      // the next queued input auto-starts as an ordinary task. Fire-and-forget — it
      // revalidates under the session lock.
      if (entry.followUps.length > 0) void this.startQueuedFollowUp(entry.sessionId);
      // Background completion notices that raced this run's exit (arrived after its last
      // input-assembly boundary): start their delivery task now. No-op when a follow-up
      // just launched — that run's engine drains the same queue.
      else void this.startBackgroundNoticeTask(entry.sessionId);
    }
  }

  /**
   * Register a subagent: persisted only when the origin message is session_meta
   * (agentId is derived from the agent_state path: `<…>/<agentId>/agent_state`).
   * **The title is left blank here** — the registration site in drive generates it
   * right away from the spawning prompt (fallback first words + LLM replacement), so
   * it never waits for the subagent's own output. Idempotent (children dedup +
   * insertOrIgnore); a subagent has its own Trace, so it's visible in both the list
   * and the trace view. On successful registration, the entry is put into `children`
   * and returned; a duplicate session_meta returns null.
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
    const createdAt = this.now().toISOString();
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
      // Spawned by this server's run (client NULL = web); its Trace exists by construction.
      hasTrace: true,
      // A subagent's own runs are driven through the PARENT entry's drive, so nothing ever
      // stamps this row: it stays at its registration time (see SessionRow.lastActiveAt).
      lastActiveAt: createdAt,
      createdAt,
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
      prompt: "",
    };
    children.set(childSid, child);
    return child;
  }

  /**
   * Runs one `sessions` row write for a driven run's bookkeeping (has_trace /
   * last_active_at), swallowing failures the same way the per-message `recorder.record`
   * call does: bookkeeping must never take down a run's lifecycle. The two call sites both
   * sit outside a covering try — the run-start write precedes drive's try block, the
   * run-end one lives in its finally — and the realistic failure (the DatabaseSync handle
   * closed by shutdown while a run outlived its drain window) throws ERR_INVALID_STATE.
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

  private publishState(entry: RuntimeEntry, state: SessionStatus): void {
    // Every state flip also reports the queued follow-up count, the undelivered steering
    // mirror, and the live subagent children, so subscribers can render all three hints
    // without a dedicated event type.
    const subagents = entry.session.listBackgroundSubagents?.() ?? [];
    this.publishEvent(entry, {
      type: "task_state",
      state,
      queued: entry.followUps.length,
      ...(entry.pendingSteering.length > 0
        ? { pendingSteering: entry.pendingSteering.map((p) => p.info) }
        : {}),
      ...(entry.followUps.length > 0
        ? { pendingFollowUps: entry.followUps.map(followUpInfo) }
        : {}),
      ...(subagents.length > 0 ? { subagents } : {}),
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
      // after the write that stamps it (touchLastActive in drive's finally), so this is what a
      // list fetch would return right now and no clock of ours has to agree with the one that
      // wrote it.
      const row = this.deps.sessions.findById(entry.sessionId);
      if (!row) return; // Row already deleted: no list row left to light up.
      lastActiveAt = row.lastActiveAt;
      // A running Session has by definition started a Task, whatever the row cache says yet:
      // markDriven (which sets has_trace) runs inside drive(), and startTask has already
      // published the first "running" by then. Reporting the raw flag there would tell a client
      // the Session has never run at the exact moment it visibly is running — and a client that
      // believed it would draw the hourglass, then nothing at all once the run settled.
      hasTrace = row.hasTrace === true || state !== "idle";
    } catch {
      // Same failure touchRow guards against (DB handle closed by shutdown while a run
      // outlives its drain window). A list badge is never worth breaking a run's finally over.
      return;
    }
    notify(entry.projectId, {
      type: "session_state",
      sessionId: entry.sessionId,
      state,
      lastActiveAt,
      hasTrace,
    });
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
