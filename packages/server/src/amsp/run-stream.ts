/**
 * The run handler: `POST /api/amsp/v1/agents/:projectId/:agentId/runs` is one run and its stream
 * (the API tab's Try it runs the same handler, try-route.ts).
 *
 * 1. The gate (gate.ts) has resolved the Agent and the key before anything here runs.
 * 2. The body is read and validated: `input` becomes the run's user messages (run-input.ts).
 * 3. The Session: without `session_id` a new one is created — source `api`, client `api`, the
 *    Agent's API model, thinking, workspace and approval defaults, and the server's sandbox;
 *    with one, it must be an API Session of this Agent. A busy Session (409) and an Agent at its
 *    limit of running Sessions (429) are refused before anything starts (admission.ts).
 * 4. The handler subscribes to the Session's channel BEFORE the Task starts, so nothing of the
 *    run can be published unseen; a start that fails answers JSON, and nothing is streamed.
 * 5. The stream is AMSP's run stream: `event: ping` at once and every 20 s, the channel's
 *    records from this run's first main-Session record on — the Session's `session_meta` on its
 *    first message, its `task_begin` otherwise — each with its `id:`, and `data: [DONE]` when the
 *    run is over: when the Session's state goes back to idle. The Web App's server events on the
 *    same channel are never written. No frame names the Session: a new one is named by that
 *    first `session_meta`, a continued one by the `session_id` the caller sent.
 *
 * Nothing in the stream says how the run went; its records do. A run the server could not finish
 * leaves its last `task_begin` unclosed before `[DONE]` (the manager records the failure).
 *
 * Disconnecting aborts the run: a run nobody is reading would only spend the Project's tokens,
 * and an approval asked of a caller that went away would never be answered.
 */
import { isValidId } from "@prismshadow/penguin-core";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { Channels, Log } from "../hmr/capabilities.js";
import { HEARTBEAT_MS } from "../http/sse.js";
import { badRequest, readJson } from "../http/validate.js";
import { DEFAULT_API_CONCURRENT_RUNS } from "../mechanisms/agent-api.js";
import type { AgentApi } from "../mechanisms/agent-api.js";
import type { Errors } from "../mechanisms/observability.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { Settings } from "../mechanisms/settings.js";
import type { ChannelEvent } from "../runtime/channel.js";
import type { SessionManager } from "../runtime/session-manager.js";
import { toAttachmentLimits } from "../services/attachment-limits.js";
import type { SessionService } from "../services/session-service.js";
import { assertWorkspaceAllowed } from "../services/workspace-guard.js";
import { reserveStart } from "./admission.js";
import { sessionNotFound } from "./gate.js";
import type { AmspEnv } from "./gate.js";
import { parseRunInput } from "./run-input.js";

/** What the run handler reaches: the seams the messaging bridge and the web routes use. */
export interface RunStreamDeps {
  manager: Pick<SessionManager, "startTask" | "abortTask" | "statusOf" | "activeCountForAgent">;
  sessionService: Pick<SessionService, "createSession">;
  sessions: Pick<SessionIndex, "findById">;
  agentApi: AgentApi;
  settings: Pick<Settings, "getAttachmentLimitsMb">;
  channels: Pick<Channels, "get">;
  errors: Errors;
  log: Log;
  now: () => Date;
}

/** A FIFO the channel listener fills and the stream loop drains; `next` answers null once closed. */
class Inbox<T> {
  private items: T[] = [];
  private waiter: ((item: T | null) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiter;
    if (waiter !== null) {
      this.waiter = null;
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  next(): Promise<T | null> {
    if (this.items.length > 0) return Promise.resolve(this.items.shift()!);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** Stops the loop: what is still queued is dropped, and a pending `next` answers null. */
  close(): void {
    this.closed = true;
    this.items = [];
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.(null);
  }
}

const PING = Symbol("ping");

/** The run state a `task_state` server event reports; null for any other channel event. */
function taskState(evt: ChannelEvent): string | null {
  if (evt.event !== "server_event") return null;
  try {
    const data = JSON.parse(evt.data) as { type?: unknown; state?: unknown };
    return data.type === "task_state" && typeof data.state === "string" ? data.state : null;
  } catch {
    return null;
  }
}

/** Whether a record is the main Session's own (no `origin`). */
function isMainRecord(evt: ChannelEvent): boolean {
  try {
    const origin = (JSON.parse(evt.data) as { origin?: unknown }).origin;
    return !Array.isArray(origin) || origin.length === 0;
  } catch {
    return false;
  }
}

export async function runStream(c: Context<AmspEnv>, deps: RunStreamDeps): Promise<Response> {
  const { projectId, agentId, keyId } = c.var.amsp;
  const body = await readJson(c);
  const sessionField = body.session_id;
  if (
    sessionField !== undefined &&
    (typeof sessionField !== "string" || !isValidId(sessionField))
  ) {
    throw badRequest("session_id must be a Session id.");
  }
  const input = parseRunInput(
    body.input,
    toAttachmentLimits(deps.settings.getAttachmentLimitsMb()).totalBytes,
  );
  const settings = deps.agentApi.get(projectId, agentId);
  const limit = settings?.maxConcurrentRuns ?? DEFAULT_API_CONCURRENT_RUNS;
  let sessionId: string | undefined;
  if (sessionField !== undefined) {
    const row = deps.sessions.findById(sessionField);
    if (
      row === null ||
      row.client !== "api" ||
      row.projectId !== projectId ||
      row.agentId !== agentId
    ) {
      throw sessionNotFound();
    }
    sessionId = row.sessionId;
  }
  const slot = reserveStart(deps, projectId, agentId, sessionId, limit);
  const inbox = new Inbox<ChannelEvent | typeof PING>();
  let unsubscribe = () => {};
  try {
    if (sessionId === undefined) {
      const workspace =
        settings?.workspace == null
          ? undefined
          : await assertWorkspaceAllowed({ workspace: settings.workspace });
      const created = await deps.sessionService.createSession({
        projectId,
        agentId,
        source: "api",
        client: "api",
        approvalMode: settings?.approvalMode ?? "allow-all",
        ...(settings?.model ?? {}),
        ...(settings?.thinkingLevel != null ? { thinkingLevel: settings.thinkingLevel } : {}),
        ...(workspace !== undefined ? { workspace } : {}),
      });
      sessionId = created.sessionId;
      slot.reservation.sessionId = sessionId;
    }
    if (keyId !== null) deps.agentApi.touchKey(keyId, deps.now().toISOString());
    unsubscribe = deps.channels.get(sessionId).subscribe((evt) => inbox.push(evt));
    await deps.manager.startTask(sessionId, input);
  } catch (err) {
    unsubscribe();
    throw err;
  } finally {
    slot.release();
  }
  const session = sessionId;

  const response = streamSSE(c, async (stream) => {
    let ended = false;
    const beat = setInterval(() => inbox.push(PING), HEARTBEAT_MS);
    stream.onAbort(() => {
      if (!ended) deps.manager.abortTask(session);
      inbox.close();
    });
    try {
      await stream.writeSSE({ event: "ping", data: "{}" });
      /** The run's own `task_state running` has gone by: an idle after it is the run's end. */
      let running = false;
      /** This run's first main-Session record has gone by: records are written from it on. */
      let opened = false;
      for (;;) {
        const item = await inbox.next();
        if (item === null) return;
        if (item === PING) {
          await stream.writeSSE({ event: "ping", data: "{}" });
          continue;
        }
        if (item.event !== undefined) {
          // A server event: the Web App's, never written here. The run's start and end are
          // read from it; an idle the Session re-published before this run began is not its end.
          const state = taskState(item);
          if (state === "running") running = true;
          else if (state === "idle" && running) {
            ended = true;
            await stream.writeSSE({ data: "[DONE]" });
            return;
          }
          continue;
        }
        // What the Session published before this run's first record of its own (a background
        // child's output) belongs to no run of this stream.
        if (!opened) {
          if (!isMainRecord(item)) continue;
          opened = true;
        }
        await stream.writeSSE({ id: item.id, data: item.data });
      }
    } catch (err) {
      // A write the caller's departure broke is the disconnect, already handled by onAbort.
      if (stream.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      deps.log.line(`[amsp] run stream of ${session} failed: ${message}`);
      deps.errors.record({
        source: "session",
        err,
        ctx: { projectId, agentId, sessionId: session },
        code: "amsp_stream_failed",
        kind: "unexpected",
      });
      if (!ended) {
        // Nobody follows the run any more: stop it, as a disconnect would.
        deps.manager.abortTask(session);
        ended = true;
        try {
          await stream.writeSSE({ data: "[DONE]" });
        } catch {
          // Best effort: the connection may be gone as well.
        }
      }
    } finally {
      clearInterval(beat);
      unsubscribe();
      inbox.close();
    }
  });
  // streamSSE names the bare type; the stream is UTF-8 JSON, and says so.
  response.headers.set("Content-Type", "text/event-stream; charset=utf-8");
  response.headers.set("Cache-Control", "no-cache");
  response.headers.set("X-Accel-Buffering", "no");
  return response;
}
