import { assertWorkspaceAllowed } from "@prismshadow/penguin-server/internal";
import { HttpError } from "../http/errors.js";

import { badRequest, readJson } from "../http/validate.js";
import { DEFAULT_API_CONCURRENT_RUNS } from "../mechanisms/agent-api.js";
import type { AgentApi } from "../mechanisms/agent-api.js";
import type { Errors } from "@penguinharness/plugin-usage/server";
import type { SessionIndex } from "@penguinharness/plugin-sessions/server";
import type { Settings } from "../mechanisms/settings.js";
import type { ChannelEvent } from "../runtime/channel.js";
import type { SessionManager } from "@penguinharness/plugin-sessions/server";
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
