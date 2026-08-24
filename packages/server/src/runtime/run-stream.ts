/**
 * The per-message pipeline of a run: everything that happens to one streamed OmniMessage
 * between the Session yielding it and the frontend seeing it — subagent registration and
 * titles, the bootstrap/input holds GET /messages serves, the live tail, the SSE publish,
 * usage recording and stream-error capture.
 *
 * It is generation-owned policy, deliberately separate from the event loop: a swap
 * replaces this wholesale while the run it observes carries on (see hmr-agent.ts). Its
 * per-run bookkeeping lives in a WeakMap keyed by the run, so an ADOPTED run simply has
 * none yet and gets a fresh set — no cross-generation handover, and nothing on OpenRun
 * that only one generation can read.
 */
import path from "node:path";
import { isSessionMeta, parseUserSteeringText } from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload, TextPayload } from "@prismshadow/penguin-core";
import type { ServerEvent, SessionStatus } from "../api/types.js";
import type { SessionsRepo } from "../db/repos/sessions.js";
import type { ChannelHub } from "./channel.js";
import type { ErrorSink } from "./error-recorder.js";
import { HmrAgent } from "./hmr-agent.js";
import type { OpenRun } from "./hmr-agent.js";
import { LiveTailTracker } from "./live-tail.js";
import { asSessionSource } from "./session-sources.js";
import type { SessionSources } from "./session-sources.js";
import { StreamErrorWatcher } from "./stream-error-watcher.js";
import type { TitleNotifier } from "./title-generator.js";
import type { UsageContext } from "./usage-recorder.js";

/** Predicate for a plain-text message on the main session (no origin): title material is drawn only from user/model text. */
export function isPlainText(role: "user" | "assistant") {
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

/** Whether this main-stream message is a delivered `[user_steering]` user text (one per queued steering entry, see core's steeringMessages). */
function isDeliveredSteering(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; role?: string; text?: string };
  if (msg.type !== "model_msg" || p.type !== "text" || p.role !== "user") return false;
  return typeof p.text === "string" && parseUserSteeringText(p.text) !== null;
}

/** If msg is a run_subagent tool call carrying a `prompt`, its id and prompt (the subagent's title material); otherwise null. */
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
  /** The prompt of the run_subagent call that spawned it (title material, and the fallback title). */
  prompt: string;
}

/** One run's pipeline bookkeeping (see the module doc: recreated per generation). */
interface RunScratch {
  /** Stream-error persistence: core converges LLM/tool failures into the stream, not throws. */
  watcher: StreamErrorWatcher | null;
  /** Subagents already registered (dedup); each gets its title at registration. */
  children: Map<string, ChildSession>;
  /**
   * Unclaimed run_subagent prompts, in call order. A round may spawn several in parallel
   * and a subagent's session_meta carries no tool_call_id, so pairing is FIFO — out-of-order
   * arrivals can swap two DISPLAYED titles, nothing more. Calls that will never produce a
   * subagent are dequeued (denied ones, and ones whose parent-level output settled), or
   * their prompt would be mismatched onto the next subagent.
   */
  subagentPrompts: Map<string, string>;
}

export interface RunStreamDeps {
  channels: ChannelHub;
  sessions: SessionsRepo;
  sources: SessionSources;
  recorder: { record(ctx: UsageContext, msg: OmniMessage): Promise<void> };
  titles?: TitleNotifier;
  errors?: ErrorSink;
  log: (line: string) => void;
  now: () => Date;
  /** The manager owns the task_state shape (queued counts, steering hints); the pipeline only triggers it. */
  publishState: (agent: HmrAgent, state: SessionStatus) => void;
  publishEvent: (agent: HmrAgent, event: ServerEvent) => void;
}

export class RunStream {
  /** Open streaming fragments of runs THIS generation observes (served to GET /messages). */
  private readonly liveTail = new LiveTailTracker();
  private readonly scratch = new WeakMap<OpenRun, RunScratch>();

  constructor(private readonly deps: RunStreamDeps) {}

  /** Live tail of a running session (see live-tail.ts); empty when idle or nothing is streaming. */
  fragments(sessionId: string): OmniMessage[] {
    return this.liveTail.fragments(sessionId);
  }

  /** Closes the run's pipeline: persists a still-pending LLM failure and drops the live tail. */
  close(agent: HmrAgent, open: OpenRun): void {
    this.scratch.get(open)?.watcher?.close();
    this.liveTail.clear(agent.sessionId);
  }

  private scratchOf(agent: HmrAgent, open: OpenRun): RunScratch {
    let s = this.scratch.get(open);
    if (s === undefined) {
      s = {
        watcher: this.deps.errors
          ? new StreamErrorWatcher(this.deps.errors, {
              projectId: agent.projectId,
              agentId: agent.agentId,
              sessionId: agent.sessionId,
            })
          : null,
        children: new Map(),
        subagentPrompts: new Map(),
      };
      this.scratch.set(open, s);
    }
    return s;
  }

  /** Everything one streamed message triggers. Awaited by the run loop, so ordering is the stream's. */
  async observe(agent: HmrAgent, open: OpenRun, msg: OmniMessage): Promise<void> {
    const scratch = this.scratchOf(agent, open);
    const parentLevel = !msg.origin || msg.origin.length === 0;
    if (parentLevel) {
      const call = runSubagentCall(msg);
      if (call) scratch.subagentPrompts.set(call.toolCallId, call.prompt);
      const denied = deniedToolCallId(msg);
      if (denied) scratch.subagentPrompts.delete(denied);
      const settled = settledToolCallId(msg);
      if (settled) scratch.subagentPrompts.delete(settled);
      // Steering delivery: core emits exactly one `[user_steering]` user text per queued
      // entry, in queue order — shift the display mirror and re-broadcast so the
      // composer's "steering queued" hint retires the moment the message is on stream.
      if (agent.pendingSteering.length > 0 && isDeliveredSteering(msg)) {
        agent.pendingSteering.shift();
        this.deps.publishState(agent, agent.status);
      }
      // Bootstrap records (first-run MCP connect + toolset): held for GET /messages until
      // the engine's deferred Trace write catches up (see SessionManager.pendingBootstrap).
      const bt = (msg.payload as { type?: string }).type;
      if (bt === "mcp_connect_begin" || bt === "mcp_connect_end" || bt === "tool_list_ready") {
        agent.pendingBootstrap.push(msg);
      }
      // First request of the run: the engine writes input → bootstrap records → tool list
      // to the Trace BEFORE issuing it, so both holds are persisted by now — end them here
      // rather than at idle. Holding for the whole run would outlive the messages
      // endpoint's tail-window dedup, and the input would be served a second time at the
      // end of history.
      if (bt === "request_begin") {
        agent.pendingInputs = [];
        agent.pendingBootstrap = [];
      }
    } else if (isSessionMeta(msg)) {
      this.registerSubagent(agent, open, scratch, msg);
    }
    // Live-tail bookkeeping in the same synchronous tick as the publish below: the
    // messages endpoint captures "channel cursor + open fragments" between two publishes,
    // so the pair is always a consistent snapshot (see live-tail.ts).
    this.liveTail.observe(agent.sessionId, msg);
    // Re-fetch the channel before every publish: it may have been recycled and recreated
    // during a long wait on approval, and a stale reference would send output to an
    // orphaned, detached channel.
    this.deps.channels.get(agent.sessionId).publish(msg);
    scratch.watcher?.observe(msg);
    try {
      await this.deps.recorder.record(open.ctx, msg);
    } catch (err) {
      this.deps.log(`[usage] Insert failed: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.errors?.record({
        source: "usage",
        err,
        ctx: open.ctx,
        code: "usage_insert_failed",
      });
    }
  }

  /**
   * A subagent announced itself: persist it so it appears in the sidebar immediately, and
   * generate its title from the spawning prompt alone — never waiting for the subagent's
   * own output, which is why the prompt is paired from the parent stream at all. Only a
   * DIRECT subagent (origin length 1) claims a queued prompt; deeper ones are spawned by
   * their own parent. Purely a side effect: a failure here must never disturb the run.
   */
  private registerSubagent(
    agent: HmrAgent,
    open: OpenRun,
    scratch: RunScratch,
    msg: OmniMessage,
  ): void {
    try {
      const child = this.persistSubagent(agent, scratch.children, msg);
      if (!child || msg.origin!.length !== 1) return;
      const [pendingId] = scratch.subagentPrompts.keys();
      if (pendingId !== undefined) {
        child.prompt = scratch.subagentPrompts.get(pendingId) ?? "";
        scratch.subagentPrompts.delete(pendingId);
      }
      if (!child.prompt.trim()) return;
      // The one-shot title request piggybacks the PARENT Session's bare LLM (the child
      // Session object never leaves the SDK). The Session/Agent recorded are the child's
      // — the title is its — but the model reference stays the parent's pair, since a
      // subagent may have switched models via run_subagent's model_id.
      this.deps.titles?.maybeGenerate(
        { ...open.ctx, agentId: child.agentId, sessionId: child.sessionId },
        open.session,
        {
          fallbackText: child.prompt,
          material: { userText: child.prompt, assistantText: "" },
          notifyOn: agent.sessionId, // via the parent Session's SSE channel
        },
      );
    } catch (err) {
      this.deps.log(
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

  /**
   * Inserts the subagent's index row (agentId derived from the agent_state path) and
   * announces it on the parent's channel. **The title is left blank** — the caller
   * generates it right away from the spawning prompt. Idempotent (children dedup +
   * insertOrIgnore); returns null for a duplicate or unusable session_meta.
   */
  private persistSubagent(
    agent: HmrAgent,
    children: Map<string, ChildSession>,
    msg: OmniMessage,
  ): ChildSession | null {
    if (!isSessionMeta(msg)) return null;
    const childSid = msg.origin![msg.origin!.length - 1]!;
    if (children.has(childSid)) return null;
    const p = msg.payload as SessionMetaPayload;
    const agentId = path.basename(path.dirname(p.agent_state));
    if (!agentId || agentId === "." || agentId === "..") return null;
    // The forwarded session_meta records the origin at the source (core's spawn site);
    // fall back to inferring "subagent" from the registration path for older metas (a
    // junk value also falls back). In-process registry only — the row has no source column.
    const source = asSessionSource(p.source) ?? "subagent";
    this.deps.sources.set(childSid, source);
    const createdAt = this.deps.now().toISOString();
    this.deps.sessions.insertOrIgnore({
      sessionId: childSid,
      projectId: agent.projectId,
      agentId,
      provider: p.provider,
      modelId: p.model_id,
      workspace: p.workspace,
      // Approvals are inherited from the parent Session; the row takes the defaults
      // (matching the convention for Sessions discovered by the CLI).
      approvalMode: "allow-all",
      title: null,
      // Spawned by this server's run (client NULL = web); its Trace exists by construction.
      hasTrace: true,
      // A subagent's runs are driven through the PARENT session's stream, so nothing ever
      // stamps this row: it stays at its registration time (see SessionRow.lastActiveAt).
      lastActiveAt: createdAt,
      createdAt,
    });
    this.deps.publishEvent(agent, {
      type: "session_created",
      projectId: agent.projectId,
      agentId,
      sessionId: childSid,
      source,
    });
    const child: ChildSession = { sessionId: childSid, agentId, prompt: "" };
    children.set(childSid, child);
    return child;
  }
}
