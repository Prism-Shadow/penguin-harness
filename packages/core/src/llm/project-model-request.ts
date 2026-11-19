/**
 * One request to a Project model outside a chat turn — a tool a plugin offers (an image, a
 * transcription, a web search) — made with the client chat builds for the same model.
 *
 * The client is built the way GenerativeModel builds a Session's: the entry's connection (its own
 * values, then its group's `[providers.<id>]` table, never the catalog's — resolveEntryCredential),
 * PenguinHarness's User-Agent and the endpoint's app attribution (attributionHeaders, with the
 * Session's id for the gateways that name a conversation), and MMSP's refusal of a keyless base
 * URL worded as a ModelCredentialError (newAutoLLMClient). What it leaves out is the chat turn's:
 * no history, no harness tools, no retries. A request is its MMSP events and how it ended.
 *
 * How it ended is reported once, through `onEnd`, with the usage the provider reported: the stop
 * event's, or — for a response MMSP rejects after it was paid for (EmptyResponseError,
 * IncompleteStreamError, either directly or inside a remote MMSP server's error envelope) — the
 * usage the error carries. The host records it; core only reports it.
 */
import {
  EmptyResponseError,
  IncompleteStreamError,
  UpstreamError,
  type AutoLLMClient,
  type UniConfig,
  type UniEvent,
  type UniMessage,
  type UsageMetadata,
} from "@prismshadow/mmsp";
import { userAgent } from "../index.js";
import { getModel, formatModelRef } from "../state/project-config.js";
import type { ModelRef, ProjectConfig } from "../state/project-config.js";
import { providerConnectionShape, resolveEntryCredential } from "../state/model-connection.js";
import { attributionHeaders } from "./app-attribution.js";
import { newAutoLLMClient } from "./model-client.js";

/** What a request outside a chat turn needs to reach a Project model. */
export interface ProjectModelClientOptions {
  /** The Project config the entry and its group's connection are read from. */
  config: ProjectConfig;
  model: ModelRef;
  /**
   * A key the host resolved for this one request (a managed credential it refreshes); it wins
   * over the file's, as a Session's per-request key does. Absent: the file's connection only.
   */
  apiKey?: string;
  /** The Session the request is made for: the conversation id the gateways that key one read. */
  sessionId?: string;
}

/**
 * The MMSP client for a configured model, built as chat builds it. Throws when the pair names no
 * configured model, and a ModelCredentialError when MMSP refuses a keyless base URL.
 */
export function projectModelClient(opts: ProjectModelClientOptions): AutoLLMClient {
  const entry = getModel(opts.config, opts.model);
  if (entry === undefined) {
    throw new Error(`Model is not in the Project config: ${formatModelRef(opts.model)}.`);
  }
  const credential = resolveEntryCredential(
    entry,
    providerConnectionShape(opts.config.providers?.[entry.provider]),
    opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {},
  );
  return newAutoLLMClient(
    {
      model: entry.model_id,
      ...credential,
      defaultHeaders: {
        "User-Agent": userAgent(),
        ...attributionHeaders(credential.baseUrl, opts.sessionId),
      },
    },
    entry.model_id,
  );
}

/** The longest wait between two upstream events, as a chat request's (`model.timeoutMs`'s default). */
export const PROJECT_MODEL_IDLE_TIMEOUT_MS = 600_000;

/** The request outlived its idle timeout: no event arrived for that long. */
export class ModelIdleTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`The model sent nothing for ${Math.round(timeoutMs / 1000)} s; the request was stopped.`);
    this.name = "ModelIdleTimeoutError";
  }
}

export interface ProjectModelRequestOptions extends ProjectModelClientOptions {
  messages: UniMessage[];
  /** MMSP's request config (modalities, tools, thinking …); `session_id` is set from `sessionId`. */
  uniConfig?: UniConfig;
  /** Stops the request; the end is reported `aborted`. */
  signal?: AbortSignal;
  /** Longest wait between two upstream events (default PROJECT_MODEL_IDLE_TIMEOUT_MS; 0 disables). */
  idleTimeoutMs?: number;
}

/** How one request ended, reported once. */
export interface ProjectModelRequestEnd {
  /** `aborted`: the caller's signal, or the caller stopped reading; `failed`: anything else that ended it early. */
  status: "completed" | "failed" | "aborted";
  /** What the provider reported — also for a failed request it was paid for; null when nothing was. */
  usage: UsageMetadata | null;
}

/** A value shaped as MMSP's usage, counts non-negative integers or null; null otherwise. */
function usageOf(value: unknown): UsageMetadata | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Partial<Record<keyof UsageMetadata, unknown>>;
  // null for an absent count, undefined for one that is not a count at all.
  const field = (n: unknown): number | null | undefined => {
    if (n === undefined || n === null) return null;
    return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
  };
  const usage = {
    cached_tokens: field(v.cached_tokens),
    prompt_tokens: field(v.prompt_tokens),
    thoughts_tokens: field(v.thoughts_tokens),
    response_tokens: field(v.response_tokens),
  };
  if (Object.values(usage).some((n) => n === undefined)) return null;
  if (Object.values(usage).every((n) => n === null)) return null;
  return usage as UsageMetadata;
}

/** The usage a rejected-but-paid response carries: MMSP's typed errors, or a remote server's envelope of them. */
function errorUsage(err: unknown): UsageMetadata | null {
  if (err instanceof EmptyResponseError || err instanceof IncompleteStreamError) {
    return usageOf(err.usageMetadata);
  }
  if (
    err instanceof UpstreamError &&
    (err.errorType === "EmptyResponseError" || err.errorType === "IncompleteStreamError")
  ) {
    return usageOf(err.error.usage_metadata);
  }
  return null;
}

/**
 * Streams one request to a Project model, yielding MMSP's events as they arrive, and calls `onEnd`
 * (which must not throw) exactly once when it is over: completed, failed (the error is rethrown to the reader after),
 * or aborted (the signal fired, or the reader stopped early). The idle timer runs only while
 * waiting on upstream, so a slow reader never trips it; on expiry the upstream stream is aborted
 * and ModelIdleTimeoutError is thrown. The client is built before the first event is pulled, so
 * an unconfigured model or a refused key surfaces from the first `next()` — and is reported
 * `failed` with no usage, since nothing was sent.
 */
export async function* streamProjectModel(
  opts: ProjectModelRequestOptions,
  onEnd: (end: ProjectModelRequestEnd) => void | Promise<void>,
): AsyncGenerator<UniEvent, void, undefined> {
  const timeoutMs = opts.idleTimeoutMs ?? PROJECT_MODEL_IDLE_TIMEOUT_MS;
  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  let usage: UsageMetadata | null = null;
  let status: ProjectModelRequestEnd["status"] = "aborted";
  let timedOut = false;
  try {
    if (opts.signal?.aborted) return;
    const client = projectModelClient(opts);
    const config: UniConfig = {
      ...opts.uniConfig,
      ...(opts.sessionId !== undefined ? { session_id: opts.sessionId } : {}),
    };
    const upstream = client
      .streamingResponse({ messages: opts.messages, config, signal: ac.signal })
      [Symbol.asyncIterator]();
    // Settles as soon as the request must stop, whatever upstream is doing: a provider SDK that
    // ignores its AbortSignal would otherwise leave `next()` pending forever (GenerativeModel's
    // `stopped` race, for the same reason).
    const stopped = new Promise<"stopped">((resolve) => {
      if (ac.signal.aborted) resolve("stopped");
      else ac.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
    });
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          ac.abort();
        }, timeoutMs);
      }
      let step: IteratorResult<UniEvent> | "stopped";
      try {
        step = await Promise.race([upstream.next(), stopped]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (step === "stopped") {
        void upstream.return?.(undefined).catch(() => undefined);
        if (timedOut) throw new ModelIdleTimeoutError(timeoutMs);
        return;
      }
      if (step.done) break;
      const event = step.value;
      if (event.event_type === "stop") usage = usageOf(event.usage_metadata) ?? usage;
      yield event;
    }
    status = "completed";
  } catch (err) {
    usage ??= errorUsage(err);
    // An abort the caller asked for reads as such even when upstream answers it with an error.
    status = opts.signal?.aborted && !timedOut ? "aborted" : "failed";
    if (status === "aborted") return;
    throw err;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    ac.abort();
    await onEnd({ status, usage });
  }
}
