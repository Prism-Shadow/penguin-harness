/**
 * The run handler: `POST /api/amsp/v1/agents/:projectId/:agentId/runs` is the run and its
 * stream.
 *
 * 1. The gate (gate.ts) has resolved the Agent and the key before anything here runs.
 * 2. The body is read and validated: `input` (a string, or text / image_url items) becomes the
 *    run's input messages — texts first, then images, as the composer submits them.
 * 3. The Session: without `session_id` a new one is created — source `api`, client `api`, the
 *    Agent's API approval mode copied onto its row, the model and sandbox the server's new-chat
 *    defaults; with one, it must be an API Session of this Agent. An Agent already running
 *    AMSP_MAX_CONCURRENT_RUNS Sessions is refused 429 before a run would add one more.
 * 4. The handler subscribes to the Session's channel BEFORE the Task starts, so nothing of the
 *    run can be published unseen; a busy Session is refused (409) by `startTask` itself, with
 *    nothing streamed.
 * 5. The stream: `run.started`, then every channel event through the translator, a
 *    `: keep-alive` comment after KEEPALIVE_MS of silence, and `run.done` — always the last
 *    event, a server failure included — followed by `data: [DONE]`.
 *
 * Disconnecting aborts the run: a run nobody is reading would only spend the Project's tokens,
 * and an approval asked of a caller that went away would never be answered. A server failure
 * that ends the stream aborts it for the same reason.
 */
import { imageUrlMessage, isValidId, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { AmspEvent, RunStarted } from "@prismshadow/amsp";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ApprovalMode } from "../api/types.js";
import type { Channels, Log } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { badRequest, readJson } from "../http/validate.js";
import type { AgentApi } from "../mechanisms/agent-api.js";
import type { Errors } from "../mechanisms/observability.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { Settings } from "../mechanisms/settings.js";
import type { ChannelEvent } from "../runtime/channel.js";
import type { SessionManager } from "../runtime/session-manager.js";
import type { SessionService } from "../services/session-service.js";
import {
  INLINE_IMAGE_MAX_BYTES,
  INLINE_IMAGE_MAX_MB,
  toAttachmentLimits,
} from "../services/attachment-limits.js";
import { sessionNotFound } from "./gate.js";
import type { AmspEnv } from "./gate.js";
import { AmspTranslator } from "./translate.js";

/** Silence after which a `: keep-alive` comment is written (MMSP's value). */
export const KEEPALIVE_MS = 15_000;

/** How many Sessions of one Agent may run at once through any door before the API refuses another. */
export const AMSP_MAX_CONCURRENT_RUNS = 4;

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

/**
 * A base64 `data:` URL of an image: an `image/*` MIME, the `;base64,` marker, a non-empty body.
 * The same shape the tasks route admits, narrowed to images: the API takes no files in v1.
 */
const IMAGE_DATA_URL = /^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;

/** Decoded size of a base64 data URL, from its length (padding and whitespace carry no bytes). */
function dataUrlBytes(url: string): number {
  const payload = url.slice(url.indexOf(",") + 1).replace(/[=\s]+/g, "");
  return Math.floor((payload.length * 3) / 4);
}

/**
 * `input` as the run's messages: a string is one user text; items are texts and images, texts
 * first. At least one non-empty text or one image. A `data:` image must be an image MIME within
 * the inline-image cap, and all of them together within the admin's per-message total; an
 * http(s) URL is passed on untouched (the server does not fetch it).
 */
export function parseRunInput(input: unknown, totalImageBytes: number): OmniMessage[] {
  const empty = () =>
    badRequest("input must be a non-empty string, or an array of text and image_url items.");
  if (typeof input === "string") {
    if (input.trim() === "") throw empty();
    return [userText(input)];
  }
  if (!Array.isArray(input) || input.length === 0) throw empty();
  const texts: OmniMessage[] = [];
  const images: OmniMessage[] = [];
  let imageBytes = 0;
  input.forEach((item: unknown, i) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw badRequest(`input[${i}] must be an object.`);
    }
    const part = item as Record<string, unknown>;
    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.trim() === "") {
        throw badRequest(`input[${i}].text must be a non-empty string.`);
      }
      texts.push(userText(part.text));
      return;
    }
    if (part.type === "image_url") {
      const url = part.image_url;
      if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
        images.push(imageUrlMessage(url));
        return;
      }
      if (typeof url !== "string" || !url.startsWith("data:image/")) {
        throw badRequest(
          `input[${i}].image_url must be an http(s) URL or a base64 data URL of an image (data:image/<type>;base64,<bytes>).`,
        );
      }
      // Sized before it is pattern-checked: an oversized body is refused without a scan.
      const bytes = dataUrlBytes(url);
      if (bytes > INLINE_IMAGE_MAX_BYTES) {
        throw badRequest(
          `input[${i}].image_url exceeds the ${INLINE_IMAGE_MAX_MB}MB inline image limit.`,
        );
      }
      if (!IMAGE_DATA_URL.test(url)) {
        throw badRequest(
          `input[${i}].image_url must be an http(s) URL or a base64 data URL of an image (data:image/<type>;base64,<bytes>).`,
        );
      }
      imageBytes += bytes;
      images.push(imageUrlMessage(url));
      return;
    }
    if (part.type === "file") {
      throw badRequest(`input[${i}]: the Agent API takes no files; send text and image_url items.`);
    }
    throw badRequest(`input[${i}].type must be text or image_url.`);
  });
  if (imageBytes > totalImageBytes) {
    throw badRequest(
      `input's images exceed the ${Math.floor(totalImageBytes / (1024 * 1024))}MB per-message limit.`,
    );
  }
  return [...texts, ...images];
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

const tooManyRuns = (): HttpError =>
  new HttpError(
    429,
    "too_many_runs",
    `This Agent already has ${AMSP_MAX_CONCURRENT_RUNS} conversations running; try again shortly.`,
    2,
  );

const KEEPALIVE = Symbol("keep-alive");

export async function runStream(c: Context<AmspEnv>, deps: RunStreamDeps): Promise<Response> {
  const { projectId, agentId, keyId } = c.var.amsp;
  const agent = `${projectId}/${agentId}`;
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
  const full = () =>
    deps.manager.activeCountForAgent(projectId, agentId) >= AMSP_MAX_CONCURRENT_RUNS;

  let sessionId: string;
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
    // A Session that is itself running is refused 409 by startTask below; an idle one would add a
    // run to the Agent.
    if (deps.manager.statusOf(sessionId) === "idle" && full()) throw tooManyRuns();
  } else {
    if (full()) throw tooManyRuns();
    const approvalMode: ApprovalMode =
      deps.agentApi.get(projectId, agentId)?.approvalMode ?? "allow-all";
    const created = await deps.sessionService.createSession({
      projectId,
      agentId,
      source: "api",
      client: "api",
      approvalMode,
    });
    sessionId = created.sessionId;
  }
  if (keyId !== null) deps.agentApi.touchKey(keyId, deps.now().toISOString());

  const inbox = new Inbox<ChannelEvent | typeof KEEPALIVE>();
  const translator = new AmspTranslator(input, { now: deps.now });
  let unsubscribe = deps.channels.get(sessionId).subscribe((evt) => inbox.push(evt));
  let actual: string;
  try {
    ({ sessionId: actual } = await deps.manager.startTask(sessionId, input));
  } catch (err) {
    unsubscribe();
    throw err;
  }
  // A Session whose Trace was gone heals into a new id at load: its channel is a fresh one that
  // received the input before this handler could subscribe. Follow it, unless the run already
  // ended there unseen.
  let rebuilt = false;
  if (actual !== sessionId) {
    unsubscribe();
    unsubscribe = deps.channels.get(actual).subscribe((evt) => inbox.push(evt));
    translator.begin();
    rebuilt = deps.manager.statusOf(actual) === "idle";
  }

  const response = streamSSE(c, async (stream) => {
    let ended = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => inbox.push(KEEPALIVE), KEEPALIVE_MS);
    };
    const write = async (event: AmspEvent): Promise<void> => {
      await stream.writeSSE({ data: JSON.stringify(event) });
      arm();
    };
    const end = async (event: AmspEvent): Promise<void> => {
      ended = true;
      await write(event);
      await stream.writeSSE({ data: "[DONE]" });
    };
    stream.onAbort(() => {
      if (!ended) deps.manager.abortTask(actual);
      inbox.close();
    });
    try {
      const started: RunStarted = {
        type: "run.started",
        at: deps.now().toISOString(),
        session_id: actual,
        agent,
      };
      await write(started);
      if (rebuilt) {
        await end(
          translator.fail({
            code: "session_rebuilt",
            message: `The Session was rebuilt as ${actual} and its run could not be followed.`,
          }),
        );
        return;
      }
      for (;;) {
        const item = await inbox.next();
        if (item === null) return;
        if (item === KEEPALIVE) {
          await stream.write(": keep-alive\n\n");
          arm();
          continue;
        }
        for (const event of translator.feed(item)) {
          if (event.type === "run.done") {
            await end(event);
            return;
          }
          await write(event);
        }
      }
    } catch (err) {
      // A write the caller's departure broke is the disconnect, already handled by onAbort.
      if (stream.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      deps.log.line(`[amsp] run stream of ${actual} failed: ${message}`);
      deps.errors.record({
        source: "session",
        err,
        ctx: { projectId, agentId, sessionId: actual },
        code: "amsp_stream_failed",
        kind: "unexpected",
      });
      if (!ended) {
        // Nobody follows the run any more: stop it, as a disconnect would.
        deps.manager.abortTask(actual);
        try {
          await end(translator.fail({ code: "internal", message }));
        } catch {
          // Best effort: the connection may be gone as well.
        }
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      inbox.close();
    }
  });
  // streamSSE names the bare type; the stream is UTF-8 JSON, and says so.
  response.headers.set("Content-Type", "text/event-stream; charset=utf-8");
  response.headers.set("X-Accel-Buffering", "no");
  return response;
}
