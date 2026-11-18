/**
 * The sessions mechanisms: what a node may require, declared apart from what implements it.
 */
import { Interface, Opaque } from "@prismshadow/penguin-core/kernel";
import type { SessionSource } from "@prismshadow/amsp";
import type { SessionRow } from "./repos/sessions.js";
import type {
  AmspRecord,
  ApprovalDecision,
  ApproveFn,
  BackgroundCommandInfo,
  BackgroundSubagentInfo,
  CompactAvailability,
  SessionTitleResult,
  StopReason,
  SubagentMessageOptions,
  SubagentMessageOutcome,
  ThinkingLevelName,
  ToolCallPayload,
  ToolDetachResult,
} from "@prismshadow/penguin-core";
import type { SandboxSettings } from "@prismshadow/penguin-core/plugin";
import type { ScheduleStateRow } from "./repos/schedules.js";
import type { ApprovalReason as CoreApprovalReason } from "@prismshadow/penguin-core/interfaces";

/** From packages/server: ApprovalMode (was api/types.ts). The contract names it, so the type lives with the contract. */
export type ApprovalMode = "allow-all" | "deny-all" | "read-only" | "always-ask";

// ---------------------------------------------------------------------------
// Session runtime vocabulary (was api/types.ts's; the ServerEvent names them,
// so the words live with the contract)
// ---------------------------------------------------------------------------

/** The run state a Session's row flips through. */
export type SessionStatus = "idle" | "running" | "compacting";

export interface PendingSteeringInfo {
  /** Server-assigned id, stable for the entry's queued lifetime: the handle DELETE /steer/:steerId recalls it by. */
  id: string;
  /** The message text as accepted (trimmed); may be empty when images/files carry the message. */
  text: string;
  /** Number of images that rode along. */
  images: number;
  /** Number of file attachments that rode along. */
  files: number;
}

export interface PendingFollowUpInfo {
  /** Server-assigned id, stable for the entry's queued lifetime: the handle DELETE /follow-ups/:followUpId recalls it by. */
  id: string;
  /** The queued input's text parts, joined; may be empty when images/files carry the message. */
  text: string;
  /** Number of images in the queued input. */
  images: number;
  /** Number of file attachments in the queued input. */
  files: number;
  /** An interrupt waiting for the run it aborted to settle: it starts first, and no other interrupt can move it. */
  interrupt?: true;
}

export interface SubagentRuntimeInfo {
  sessionId: string;
  subagentId: string | null;
  running: boolean;
}

export type SessionSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type SessionSandboxNetwork = "open" | "local" | "none";

export interface UnavailableSandboxBackend {
  name: string;
  reason: string;
}

export interface SessionSandboxPreset {
  id: string;
  /** The name an administrator gave it, or its declared English name. */
  name: string;
  /** Its declared Chinese name, while it has not been renamed. */
  nameZh?: string;
  /** Whether the composer's menu lists it. */
  enabled: boolean;
  mode: SessionSandboxMode;
  network: SessionSandboxNetwork;
  approvalMode: ApprovalMode;
  /**
   * Response-only: its file mode or network is wider than the server's sandbox settings (the
   * ceiling for non-admins), so a non-admin's pick of it is refused with `403 sandbox_forbidden`.
   * The same comparison as that refusal; absent when it is within them.
   */
  aboveCeiling?: true;
}

export interface SessionSandbox {
  mode: SessionSandboxMode;
  /** `open` = unrestricted, `local` = only the host's localhost, `none` = no network. */
  network: SessionSandboxNetwork;
  /**
   * Response only, ignored in requests: whether a sandbox backend on this server can enforce
   * the `read-only` and `workspace-write` modes. False on a deployment with no backend
   * installed, where either mode would refuse every command: the composer shows them greyed
   * out, saying no backend is installed.
   */
  confinementSupported?: boolean;
  /** Response only, ignored in requests: the same for the `none` network level. */
  noNetworkSupported?: boolean;
  /**
   * Response only, ignored in requests: whether a sandbox backend on this server can enforce
   * the `local` level. When false the composer shows it greyed out, and picking it is refused
   * (400 `sandbox_unsupported`).
   */
  localNetworkSupported?: boolean;
  /** Response only, ignored in requests: whether a backend here can enforce `masksPaths`. */
  maskPathsSupported?: boolean;
  /**
   * Response only, ignored in requests: true when this policy hides paths (the Sandbox card's
   * masked paths, kept by every pick). Where `maskPathsSupported` is false, every level then
   * refuses every command, and the composer says so.
   */
  masksPaths?: boolean;
  /**
   * Response only, ignored in requests: the names of the sandbox backends in use here, which the
   * composer names when a level is beyond what they enforce. Absent with none in use.
   */
  backendsInUse?: string[];
  /**
   * Response only, ignored in requests: the sandbox backends that are enabled here but failed
   * to load or failed their check (a WSL distro not set up, a wrong program path), each with
   * why. A backend for another platform is not listed. With none mounted and one listed, the
   * composer marks the confining levels unavailable and gives the first one's reason.
   */
  unavailableBackends?: UnavailableSandboxBackend[];
  /**
   * Response only, ignored in requests: the server's sandbox presets (the Sandbox card's table),
   * in table order, disabled rows included. The composer lists the enabled ones and names the
   * Session's level by the first row matching its mode, network and approval mode. A server
   * that does not report it gets the composer's built-in table.
   */
  presets?: SessionSandboxPreset[];
  /**
   * Response only, ignored in requests: true when this Session's policy holds something the
   * presets do not show — masked paths, or the temp directory not writable.
   */
  advanced?: boolean;
  /**
   * Response only, chat defaults only: the approval mode a new Session starts with when its
   * request names none — the Sandbox card's default preset's, while the switch is on. Absent:
   * the server's own fallback (`allow-all`).
   */
  defaultApprovalMode?: ApprovalMode;
  /**
   * Response only, ignored in requests: the Sandbox card's switch on this server — whether new
   * Sessions start confined. Off, the composer offers the approval modes alone (a Session keeps
   * its own policy either way). A server that does not report it is read as on.
   */
  switchOn?: boolean;
}

/** The approval vocabulary a decision cites (core's type, aliased here so the contract names it). */
export type ApprovalReason = CoreApprovalReason;

/** SessionIndex: the mechanism SessionsRepo implements. */
@Interface()
export abstract class SessionIndex {
  abstract insert(row: SessionRow): void;
  abstract insertOrIgnore(row: SessionRow): void;
  abstract insertFork(sourceSessionId: string, row: SessionRow): SessionRow;
  abstract markOrgClient(sessionIds: readonly string[]): void;
  abstract markHasTrace(sessionId: string): void;
  abstract markDriven(sessionId: string, at: string): void;
  abstract touchLastActive(sessionId: string, at: string): void;
  abstract findById(sessionId: string): SessionRow | null;
  abstract listByAgent(projectId: string, agentId: string): SessionRow[];
  abstract listByProject(projectId: string): SessionRow[];
  abstract updateApprovalMode(sessionId: string, mode: ApprovalMode): void;
  abstract updateSandbox(sessionId: string, sandbox: SandboxSettings): void;
  abstract updateThinkingLevel(sessionId: string, level: ThinkingLevelName): void;
  abstract updateTitle(sessionId: string, title: string): void;
  abstract updateTitleIfNull(sessionId: string, title: string): void;
  abstract updateModel(sessionId: string, provider: string, modelId: string): void;
  abstract setListing(
    sessionIds: readonly string[],
    listing: "archived" | "kept",
    at: string,
  ): void;
  abstract replaceId(oldSessionId: string, newSessionId: string): void;
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
  abstract deleteById(sessionId: string): void;
}

/**
 * SessionDrivers: the human a Session acts for — the one who last started a run in it (a prompt
 * in the app, the scheduler on its creator's behalf), else the owner of its Project. An agent's
 * calls reach the server with the admin API token; this is how they are attributed to a person
 * (whose own Chrome the agent then drives). The mechanism SessionDriverRegistry implements.
 */
@Interface()
export abstract class SessionDrivers {
  /** `userId` started a run in `sessionId`. */
  abstract note(sessionId: string, userId: string): void;
  /** The human `sessionId` acts for; null for a Session the server does not know. */
  abstract driverOf(sessionId: string): string | null;
}

/**
 * What a run that has just ended asks of the CURRENT generation: start the next queued
 * follow-up, or deliver background notices that raced the run's exit. A run outlives the
 * generation that launched it (see AgentState.current), and what it starts next is the
 * current logic's to start.
 */
export interface RunStarter {
  startQueuedFollowUp(sessionId: string): Promise<void>;
  startBackgroundNoticeTask(sessionId: string): Promise<void>;
}

/** AgentState: the mechanism AgentStateStore implements — the Session runtime's in-memory state, data only. */
export abstract class AgentState extends Interface<{
  /** The live Session runtimes, keyed by Session id. */
  readonly entries: Map<string, RuntimeEntry>;
  readonly childRoots: Map<string, string>;
  readonly locks: Map<string, Promise<unknown>>;
  readonly deletingAgents: Set<string>;
  readonly deletingSessions: Set<string>;
  readonly agentGenerations: Map<string, number>;
  /** The live fragment log. */
  readonly liveTail: LiveTail;
  /** The generation working on this state right now; every generation points it at itself when it takes the state over. */
  current: RunStarter | null;
}>() {}

/** The target pair plus a run's options (`approve` answers the run's tool rounds). */
export type RunOpts = {
  approve: ApproveFn;
  signal: AbortSignal;
};

/** The target pair plus a run's options (`approve` answers the compaction's tool rounds). */
export interface SwitchModelOpts extends RunOpts {
  provider: string;
  modelId: string;
}

/**
 * A queued message's file attachment as held for recall: the scratchpad path it was written
 * to, plus what is needed to rebuild the composer-shaped part — the submitted name and media
 * type (the bytes stay on disk; queued entries never hold file payloads in memory).
 */
export interface RecallableFile {
  fileName: string;
  path: string;
  mime: string;
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

/** One queued follow-up task (`queueIfBusy`): the task input, held until the session is idle. */
export interface QueuedFollowUp {
  /** Recall handle (PendingFollowUpInfo.id), assigned at queue time. */
  id: string;
  input: AmspRecord[];
  /**
   * Original content for recall, and the content `task_state` shows on the queued line.
   * Always present: a caller that knows more than the input carries (the HTTP route, which
   * also knows where the file attachments landed on disk) supplies it, and every other
   * queueing path gets it derived from the input — what can be recalled must not depend on
   * which door the message came through.
   */
  recall: RecallStore;
  /**
   * An interrupt (TaskCreateRequest.interrupt, POST /interrupt): it aborted the run it is
   * waiting on and starts first. Interrupts keep their own order at the head of the queue.
   */
  interrupt?: true;
}

/** One undelivered steering entry: the display info broadcast on task_state, plus what a recall needs — the exact input list core queued (its unsteer handle) and the original content. */
export interface PendingSteeringEntry {
  info: PendingSteeringInfo;
  input: AmspRecord[];
  recall: RecallStore;
}

/** The background-task counts of one Session (see SessionInfo.backgroundTasks). */
export interface SessionBackgroundTasks {
  /** Background command sessions whose process is still running. */
  processes: number;
  /** Background subagent sessions (promoted to a `subagent_id`) currently mid-round. */
  subagents: number;
}

/** Minimal interface for a runtime Session (satisfied by core Session; tests may inject a fake implementation). */
export interface RuntimeSession {
  readonly sessionId: string;
  run(newMessages: AmspRecord[], opts: RunOpts): AsyncGenerator<AmspRecord>;
  compact(opts: RunOpts): AsyncGenerator<AmspRecord>;
  /**
   * The running context's model (core `Session.provider` / `Session.modelId`, getters over
   * the context's session_meta): the row's pair at creation, moved by each in-session switch
   * — and, after a restart, whatever the Trace resumed on. Optional: test fakes may omit them,
   * in which case the entry keeps the row's pair.
   */
  readonly provider?: string;
  readonly modelId?: string;
  /**
   * Switches the Session's model in place (core `Session.switchModel`): closes the running
   * context on the model it ran on, then opens the next one on the target. A completed switch
   * streams the new context's main-session `session_meta` last, and the getters above answer
   * the target by then; a refusal is thrown before the first event; a Session that never ran
   * switches without streaming anything. Optional: test fakes may omit it, reading as
   * "switching is not available".
   */
  switchModel?(opts: SwitchModelOpts): AsyncGenerator<AmspRecord, StopReason>;
  /**
   * The Session's thinking level (core `Session.thinkingLevel`, plain state): soft-limited —
   * an assignment applies from the Session's very next LLM request. Optional: test fakes may
   * omit it.
   */
  thinkingLevel?: ThinkingLevelName;
  /** Whether compaction is possible and why; when not ok, compact() yields no messages (see core ContextEngine.compactability). */
  compactability(): CompactAvailability;
  /** Queues a mid-run steering input (core `Session.steer`); false when no Task is running. */
  steer(input: AmspRecord[]): boolean;
  /**
   * Withdraws a steering input queued via `steer` before core delivers it (core
   * `Session.unsteer`, matched by input-list identity); false when it is no longer queued —
   * already delivered, or the run exited. Optional: test fakes may omit it, in which case
   * every recall reports "already delivered".
   */
  unsteer?(input: AmspRecord[]): boolean;
  /** Skips the in-progress reconnect backoff, firing the next retry immediately (core `Session.skipReconnectWait`); false when no wait is in progress. */
  skipReconnectWait(): boolean;
  /**
   * Whether a run with empty input would send anything (core `Session.hasPendingInput`): the
   * input of a turn that failed or was stopped, held as carry-over — in process, or rebuilt
   * from the Trace after a restart — or a compaction summary waiting for the next run.
   * Optional: test fakes may omit it, reading as nothing held.
   */
  hasPendingInput?(): boolean;
  /**
   * Whether the next Task opens a new Trace file (core `Session.contextOpenPending`): a
   * compaction left the next context's file to its first write, so that Task streams the new
   * `session_meta` behind its `task_begin`, and the input echo waits for it (see InputEcho).
   * Optional: test fakes may omit it, reading as no.
   */
  contextOpenPending?(): boolean;
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
  /** A tool's permission level from the running context's toolset (core `Session.toolPermission`; strict-tier — rebuilt at rotation). */
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
  takeBackgroundNotices?(): AmspRecord[];
  /** Whether completion notices are still queued (core `Session.hasPendingBackgroundNotices`); pins the entry against idle eviction. Optional, like onBackgroundNotice. */
  hasPendingBackgroundNotices?(): boolean;
  /** Refreshes the listen-port probes behind the process list's `serviceUrl` (core `Session.probeBackgroundCommandServices`). Optional: test fakes may omit it. */
  probeBackgroundCommandServices?(): Promise<void>;
  /** Subscribes live-forwarded background-subagent messages (core `Session.onBackgroundMessage`); the manager publishes them to the session channel. Optional: test fakes may omit it. */
  onBackgroundMessage?(listener: (msg: AmspRecord) => void): void;
  /** Background command processes owned by the Session's environment (core `Session.listBackgroundCommands`). Optional: test fakes may omit it. */
  listBackgroundCommands?(): BackgroundCommandInfo[];
  /** Kills one background command process (core `Session.killBackgroundCommand`); false when the id is unknown. Optional, like listBackgroundCommands. */
  killBackgroundCommand?(processId: string): boolean;
  /** Hands one EXECUTING tool call back as a background task (core `Session.detachToolCall`). Optional: test fakes may omit it, reading as "not_running". */
  detachToolCall?(toolCallId: string): ToolDetachResult;
  /** Whether a background subagent is mid-round (core `Session.hasRunningBackgroundSubagents`); pins the entry against idle eviction. Optional, like listBackgroundCommands. */
  hasRunningBackgroundSubagents?(): boolean;
  /** All live subagent child sessions of the Session's environment (core `Session.listBackgroundSubagents`). Optional, like listBackgroundCommands. */
  listBackgroundSubagents?(): BackgroundSubagentInfo[];
  /** Host message to one child session — steering mid-run, a follow-up run when idle, a revival when released (core `Session.sendToBackgroundSubagent`). Optional. */
  sendToBackgroundSubagent?(
    childSessionId: string,
    messages: AmspRecord[],
    opts?: SubagentMessageOptions,
  ): Promise<SubagentMessageOutcome>;
  /** Subscribes the host's session-lifetime fallback approval sink for child sessions (core `Session.setSubagentApprovalFallback`, which wraps it with the command policy). Optional. */
  setSubagentApprovalFallback?(approve: ApproveFn): void;
  /** Aborts one child session's current run, keeping the session (core `Session.abortBackgroundSubagentRun`); false when unknown or idle. Optional. */
  abortBackgroundSubagentRun?(childSessionId: string): boolean;
  /** Pins one live child session's thinking level (core `Session.setBackgroundSubagentThinkingLevel`); false when the child is not live. Optional. */
  setBackgroundSubagentThinkingLevel?(childSessionId: string, level: ThinkingLevelName): boolean;
  /** Subscribes subagent run-state changes (core `Session.onSubagentState`): the manager republishes `task_state` with the fresh live listing. Optional. */
  onSubagentState?(listener: () => void): void;
  /** Subscribes background-task state changes (core `Session.onBackgroundState`): the manager re-counts the live registries and publishes `session_background` when the counts moved. Optional. */
  onBackgroundState?(listener: () => void): void;
  /** Releases environment resources — kills the remaining background processes (core `Session.dispose`). Optional, idempotent. */
  dispose?(): void | Promise<void>;
}

/** A Session runtime's pending approvals, as its holder uses them — what the server's ApprovalRegistry implements. */
export interface Approvals {
  readonly size: number;
  list(): PendingApproval[];
  wait(toolCall: AmspRecord<ToolCallPayload>, reason?: ApprovalReason): Promise<ApprovalDecision>;
  decide(toolCallId: string, decision: ApprovalDecision): boolean;
  denyAll(): void;
  denyMain(): void;
}

/** One pending approval, as the approval subscription replays it. */
export interface PendingApproval {
  toolCall: AmspRecord<ToolCallPayload>;
  origin?: string[];
  /** Why the call asks, when the mode did not send it here (a command-policy `ask` rule). */
  reason?: ApprovalReason;
}

/** A numbered channel event; `id` is `<epoch>-<seq>`, `data` is serialized single-line JSON. */
export interface ChannelEvent {
  id: string;
  /** SSE event name; omitted (a record) means no `event:` line. */
  event?: string;
  data: string;
}

/** One run start folded into a fragment: where in the channel it went out, and by what digest. */
export interface RunStart {
  /** The channel event id the record went out as (`<epoch>-<seq>`). */
  id: string;
  timestamp: string;
  /** digest of the record as published; the Trace holds the same bytes. */
  digest: string;
}

/** The current run's log, as the run form of GET /messages reads it. */
export interface LiveRun {
  /** The run's records in publish order, each fragment rendered as its start with what was folded in. */
  records: AmspRecord[];
  /** How many of the run's oldest records the byte cap dropped. */
  omitted: number;
  starts: RunStart[];
}

/** The live fragment log: what the live form of GET /messages reads mid-run. */
export interface LiveTail {
  /** A run starts on the Session: a fresh log of its records (nothing from before it continues). */
  begin(sessionId: string): void;
  /** Feed one published message with the channel event it went out as. */
  observe(sessionId: string, msg: AmspRecord, published: ChannelEvent): void;
  fragments(sessionId: string): AmspRecord[];
  /** The current run's log; null when no run is under way. */
  run(sessionId: string): LiveRun | null;
  clear(sessionId: string): void;
}

/** Active-table entry: a loaded runtime Session plus its running state. */
export interface RuntimeEntry {
  sessionId: string;
  projectId: string;
  agentId: string;
  /**
   * The Session's current model (provider group paired with modelId): what the next drive
   * attributes usage to. The row's pair, kept in step with the runtime's own answer (see
   * `syncEntryModel`) — at load, and whenever a model switch moves it.
   */
  provider: string;
  modelId: string;
  session: RuntimeSession;
  /**
   * The ordinary load's refusal, while this runtime — loaded for a model switch alone, because
   * the ordinary load refused it (see `SessionLoader.load`'s `switchTo`) — is still on the model
   * it cannot reach: no Task or compaction runs here, each is answered with it instead. Cleared
   * when the Session moves off that model (see `syncEntryModel`).
   */
  stranded?: { status: number; code: string; message: string };
  status: SessionStatus;
  approvals: Approvals;
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
   * ordinary tasks with normal semantics, unlike the mid-run steering queue.
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
  pendingInputs: AmspRecord[];
  /**
   * The running Task's streamed bootstrap records (mcp_connect begin/end,
   * tool_list_ready), held until the run ends. Their Trace writes are deferred by the
   * engine until after the input lands (turn attribution), and the draft flow subscribes
   * only after they were published — so a history rebuild during the MCP connect would
   * otherwise show nothing at all (a silent blank while a slow server times out).
   * GET /messages appends whichever of them the Trace has not caught up to.
   */
  pendingBootstrap: AmspRecord[];
  /**
   * Steering messages queued on core but not yet delivered to the model — a display mirror
   * of core's steering queue (same FIFO order), so the composer's "steering queued" hint and
   * its content survive reloads: pushed on `steer`, shifted as each `[user_steering]`
   * message appears on the drive stream, dropped wholesale when the run exits (core
   * discards undelivered steering on abort/completion). The `info` halves are broadcast on
   * every `task_state`; the rest is the recall handle (see recallSteering).
   */
  pendingSteering: PendingSteeringEntry[];
  /**
   * Steering the run ended without ever delivering — handed back to the user instead of
   * discarded (#287 follow-up). An interrupt mid-tool-call is the ordinary way to get here:
   * core drops its queue when the run exits, so the message would otherwise vanish with the
   * text the user had already typed.
   *
   * Entries move here from `pendingSteering` when the run exits and stay recallable by the
   * same handle, so the composer pulls them back into its draft (auto-recall on observing
   * them, a reload included). They are deliberately NOT cleared when the next run starts:
   * the message was never delivered whatever happens later, and dropping it there would
   * reintroduce exactly the loss this list exists to prevent. Only a recall — or the entry's
   * idle eviction — removes one.
   */
  returnedSteering: PendingSteeringEntry[];
  /** Timestamp of last activity (refreshed on load / status flip / drive completion / background-task change), used for idle-eviction checks. */
  lastActivityMs: number;
  /**
   * Background-task counts as last read from the runtime — at entry creation, then on every
   * background-state ping. The baseline `session_background` is published against: a ping
   * that leaves the counts where they were (a foreground-window child settling, an exited
   * process being removed from the list) publishes nothing.
   */
  backgroundTasks: SessionBackgroundTasks;
}

/** From packages/server (runtime/schedule-file.ts): a registered task's definition, as the
 * schedule file states it. The contract carries the shape a schedule read shows; the
 * scheduler's file parser owns the rest of the file's fields. */
export interface ScheduleDefinition {
  name: string;
  /** The Prompt to send (required). */
  prompt: string;
  /** Enabled switch; disabled by default. */
  enabled: boolean;
  /** Original text of the first trigger time (for API echo, preserving the written form). */
  startAt: string;
  /** First trigger time (epoch ms). */
  startAtMs: number;
  /** Original text of the end time. */
  endAt?: string;
  /** Original text of the trigger period (e.g. `30m`, for API echo); undefined means a one-shot task. */
  period?: string;
  /** Trigger period (ms); undefined means a one-shot task. */
  periodMs?: number;
  /** End time (epoch ms); no more triggers once past it. */
  endAtMs?: number;
  /** The target Session to bind to; defaults to creating a new Session each time. */
  sessionId?: string;
  /** Workspace for new-Session mode (same semantics as manually starting a session; a temporary workspace is auto-created if unspecified). */
  workspace?: string;
  /** Model for new-Session mode (upstream id, always paired with provider; omit both for the Project's default reference). */
  modelId?: string;
  /** Provider for new-Session mode: the model reference's other half, always paired with modelId. */
  provider?: string;
}

/** From packages/server (runtime/scheduler.ts): the in-memory view of a registered task. */
export interface ScheduleEntry {
  def: ScheduleDefinition;
  state: ScheduleStateRow;
  queued: boolean;
}

/** SessionOrigins: the mechanism SessionSources implements. */
@Interface()
export abstract class SessionOrigins {
  /** `null`: the Session's Trace head records no source (written before it was required). */
  abstract set(sessionId: string, source: SessionSource | null): void;
  abstract get(sessionId: string): SessionSource | null | undefined;
  abstract delete(sessionId: string): void;
}

/** Schedules: the mechanism SchedulesRepo implements. */
@Interface()
export abstract class Schedules {
  abstract find(projectId: string, agentId: string, name: string): ScheduleStateRow | null;
  abstract listByAgent(projectId: string, agentId: string): ScheduleStateRow[];
  abstract registerOrSync(args: {
    projectId: string;
    agentId: string;
    name: string;
    startAtMs: number;
    defHash: string;
    creatorUserId: string | null;
  }): { row: ScheduleStateRow; fresh: boolean };
  abstract markSlot(projectId: string, agentId: string, name: string, slotMs: number): void;
  abstract markFired(
    projectId: string,
    agentId: string,
    name: string,
    firedAt: string,
    oneShot: boolean,
  ): void;
  abstract markMissed(projectId: string, agentId: string, name: string): void;
  abstract markInvalid(projectId: string, agentId: string, name: string, reason: string): void;
  abstract delete(projectId: string, agentId: string, name: string): void;
  abstract deleteMissing(projectId: string, agentId: string, presentNames: string[]): string[];
  abstract deleteByAgent(projectId: string, agentId: string): void;
  abstract deleteByProject(projectId: string): void;
}

/** Scheduling: the mechanism Scheduler implements. */
@Interface()
export abstract class Scheduling {
  /** The runtime's schedule-file cache (the server's ScheduleFileCache class, compared by name). */
  abstract readonly files: Opaque<"ScheduleFileCache">;
  abstract start(): Promise<void>;
  abstract stop(): void;
  abstract tickOnce(): Promise<void>;
  abstract reconcileAgent(projectId: string, agentId: string): Promise<void>;
  abstract listAgent(
    projectId: string,
    agentId: string,
  ): Promise<{ entries: ScheduleEntry[]; invalid: Array<{ name: string; error: string }> }>;
  abstract listProject(projectId: string): Promise<{
    entries: Array<ScheduleEntry & { agentId: string }>;
    invalid: Array<{ agentId: string; name: string; error: string }>;
  }>;
  abstract dropEntry(projectId: string, agentId: string, name: string): void;
}
