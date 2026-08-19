/**
 * Protocol auto-detection for custom model endpoints.
 *
 * Given a base URL (plus an optional API key), probes which of AgentHub 0.4.2's three
 * generic protocol clients the endpoint actually serves, in this fixed order:
 *
 *   1. `openai-responses` — OpenAI Responses API,   POST {base}/responses
 *   2. `ant-messages`     — Anthropic Messages API, POST {base}/v1/messages
 *   3. `openai-chat`      — OpenAI Chat Completions, POST {base}/chat/completions
 *
 * Paths and auth headers mirror exactly what the AgentHub clients construct (verified
 * against the SDKs they wrap): the OpenAI SDK appends `/responses` / `/chat/completions`
 * to the base URL and authenticates with `Authorization: Bearer`; the Anthropic SDK
 * appends `/v1/messages` and AgentHub's AntMessagesClient sends the credential through
 * BOTH `x-api-key` and `Authorization: Bearer` (plus `anthropic-version`), which every
 * covered server/gateway accepts. Probing the same URL the client would call means a
 * detected protocol is one that will actually work after saving.
 *
 * Probe design: each probe POSTs a deliberately minimal invalid body (`{}`) — zero token
 * cost, no valid model id needed, and the error it provokes reveals whether the route is
 * really an API endpoint. Classification:
 *   - 404 / 405 → the route does not exist (`route_missing`). This is judged by status
 *     alone: OpenAI-style servers wrap unknown paths in protocol-shaped 404 JSON, and the
 *     probe body carries no model id, so a 404 can never mean "model not found".
 *   - other 4xx (400 validation, 401/403 auth, 422, 429 …) with a JSON API-error shape →
 *     the route exists and answers like an API (`served`). Auth failures count: probing
 *     without a key still detects the protocol. The error-shape check is deliberately
 *     tolerant (OpenAI `{error:{…}}`, Anthropic `{type:"error",…}`, vLLM/FastAPI
 *     `{detail:…}` / `{object:"error",…}`, bare `{message:…}`) because the probed PATH
 *     is what discriminates protocols — the shape check only weeds out HTML error pages
 *     and gateway junk.
 *   - 2xx → `served` only with protocol-specific success markers (guards against
 *     catch-all gateways that 200 every path).
 *   - 5xx → `server_error`, not served: gateways emit 5xx regardless of path existence,
 *     so it proves nothing; detection moves on to the next protocol.
 *   - non-JSON body → `junk`; fetch failures → `timeout` / `network_error`.
 *
 * Probes run sequentially in the order above and stop at the first `served` hit. The API
 * key is only ever placed in request headers — never in URLs, results, or logs.
 *
 * Credential resolution is layered: the caller passes the key typed in the dialog or the
 * entry's stored one, and when there is neither, each probe falls back to the environment
 * variable for the protocol IT speaks (`ANTHROPIC_API_KEY` for `ant-messages`,
 * `OPENAI_API_KEY` for the two OpenAI protocols — see envApiKeyForProtocol). Detection
 * still works with no credential at all, but an authenticated probe is far more likely to
 * draw a protocol-shaped error than the generic 401 or gateway HTML an anonymous request
 * often gets, so the fallback materially improves accuracy.
 */
import { resolveModelEnv } from "@prismshadow/penguin-core";
import type {
  ModelProtocolDetectResponse,
  ModelProtocolProbeDto,
  ProtocolProbeOutcome,
} from "../api/types.js";

/** AgentHub generic protocol client types, in the required detection order. */
export const PROTOCOL_CLIENT_TYPES = ["openai-responses", "ant-messages", "openai-chat"] as const;
export type ProtocolClientType = (typeof PROTOCOL_CLIENT_TYPES)[number];

/** Per-probe timeout: cheap probes against live endpoints answer well under this; a hung gateway must not stall the dialog. */
export const PROBE_TIMEOUT_MS = 5_000;

/** One probe target: the protocol's client type, request path, and auth header shape. */
interface ProbeSpec {
  clientType: ProtocolClientType;
  path: string;
  headers: (apiKey?: string) => Record<string, string>;
}

/** OpenAI-protocol auth (Responses and Chat Completions): Authorization: Bearer. */
function bearerHeaders(apiKey?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
}

/**
 * Anthropic Messages auth: the credential through both header conventions —
 * `x-api-key` (Anthropic, DeepSeek) and `Authorization: Bearer` (OpenRouter, Z.AI) —
 * exactly like AgentHub's AntMessagesClient; `anthropic-version` is always sent
 * (the SDK sends it unconditionally, and some servers 400 without it).
 */
function anthropicHeaders(apiKey?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...(apiKey ? { authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
  };
}

/** The three probes in the required order: Responses first, Messages second, Chat Completions as the last resort. */
export const PROTOCOL_PROBES: readonly ProbeSpec[] = [
  { clientType: "openai-responses", path: "/responses", headers: bearerHeaders },
  { clientType: "ant-messages", path: "/v1/messages", headers: anthropicHeaders },
  { clientType: "openai-chat", path: "/chat/completions", headers: bearerHeaders },
];

/**
 * Environment-variable fallback for a probe's credential, resolved PER PROTOCOL.
 *
 * Which env var backs a request depends on the protocol being spoken, and detection is
 * precisely the case where the protocol is not yet known — so the resolution happens once
 * per probe rather than once per detection: `ant-messages` reads `ANTHROPIC_API_KEY`,
 * `openai-responses` / `openai-chat` read `OPENAI_API_KEY`. `resolveModelEnv` is the same
 * mapping the rest of the app uses (an explicit client type wins over the model id there),
 * so this cannot drift from what the saved model will actually read.
 *
 * Server-side only: the value is placed in a request header and never returned to the
 * browser, echoed in a result, or logged.
 */
export function envApiKeyForProtocol(
  clientType: ProtocolClientType,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envKey = resolveModelEnv("", clientType)?.envKey;
  if (!envKey) return undefined;
  return env[envKey]?.trim() || undefined;
}

/** Whether a string is an absolute http(s) URL (the only base URLs worth probing). */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The full URL one probe requests: trailing slashes are stripped before appending the
 * protocol path — the same join both wrapped SDKs perform, so the probe hits exactly
 * the URL the real client would.
 */
export function probeUrl(baseUrl: string, path: string): string {
  return baseUrl.trim().replace(/\/+$/, "") + path;
}

/** A JSON body that looks like a structured API error (vs an HTML page / junk): see the header doc for why this check is tolerant. */
function isApiErrorShape(body: Record<string, unknown>): boolean {
  const err = body.error;
  if (err !== null && typeof err === "object") return true;
  if (typeof err === "string" && err !== "") return true;
  if (body.type === "error") return true;
  if (body.object === "error") return true;
  if (typeof body.message === "string" && body.message !== "") return true;
  // FastAPI/vLLM `detail`: it must actually carry a message. `{"detail": null}` and
  // `{"detail": ""}` say nothing about the route, and accepting them (a bare `!== undefined`
  // check did) let a JSON body with one empty field pass as proof the route exists.
  const detail = body.detail;
  if (typeof detail === "string") return detail !== "";
  if (detail !== null && (typeof detail === "object" || typeof detail === "number")) return true;
  return false;
}

/** Protocol-specific success markers for a 2xx probe answer (an empty `{}` body should never succeed, so a 2xx must prove its shape). */
function isSuccessShape(clientType: ProtocolClientType, body: Record<string, unknown>): boolean {
  switch (clientType) {
    case "openai-responses":
      return body.object === "response" || Array.isArray(body.output);
    case "ant-messages":
      return body.type === "message" || (Array.isArray(body.content) && "role" in body);
    case "openai-chat":
      return body.object === "chat.completion" || Array.isArray(body.choices);
  }
}

/**
 * Classifies one probe's HTTP answer (pure; exported for unit tests). `bodyText` is the
 * raw response body; non-JSON bodies are junk regardless of status.
 */
export function classifyProbeResponse(
  clientType: ProtocolClientType,
  status: number,
  bodyText: string,
): ProtocolProbeOutcome {
  if (status === 404 || status === 405) return "route_missing";
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return "junk";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "junk";
  const body = parsed as Record<string, unknown>;
  if (status >= 200 && status < 300) return isSuccessShape(clientType, body) ? "served" : "junk";
  if (status >= 500) return "server_error";
  return isApiErrorShape(body) ? "served" : "junk";
}

/** AbortSignal.timeout aborts surface as TimeoutError (undici) or AbortError; both mean the probe timed out. */
function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/**
 * Byte budget for a probe's response body. The timeout caps how LONG an endpoint may
 * answer for, not how MUCH it may send: a fast host can push a great deal in five seconds,
 * and `res.text()` buffers all of it before classification ever looks at it. Classification
 * only needs the top of a structured error, so anything past this cap is junk by
 * definition — 64 KiB is orders of magnitude above any real API error body.
 */
export const MAX_PROBE_BODY_BYTES = 64 * 1024;

/**
 * Reads at most {@link MAX_PROBE_BODY_BYTES} of a probe response and reports whether the
 * body ran past that. Streams rather than calling `res.text()`, so an oversized (or
 * endless) body is abandoned at the cap instead of being buffered whole; the caller's
 * timeout signal still bounds the read in time.
 */
async function readCappedBody(res: Response): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  // A bodyless response (204, HEAD-like) or a fetch mock returning no stream: fall back to
  // text(), which is empty or already-materialized in both cases.
  if (!body) return { text: await res.text(), truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_PROBE_BODY_BYTES) {
        truncated = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    // Releases the connection: without a cancel, abandoning an oversized body would leave
    // the socket draining in the background.
    await reader.cancel().catch(() => {});
  }
  return { text: truncated ? "" : Buffer.concat(chunks).toString("utf8"), truncated };
}

async function runProbe(
  spec: ProbeSpec,
  baseUrl: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ModelProtocolProbeDto> {
  const url = probeUrl(baseUrl, spec.path);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: spec.headers(apiKey),
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
      // Redirects stay followed (fetch's default). It is tempting to pin `redirect: "manual"`
      // so a base URL cannot bounce the server somewhere it never named, but the SDKs the
      // real clients wrap follow redirects too — pinning it would report "no protocol" for
      // the ordinary case of a base URL that 301s http -> https, i.e. break the invariant
      // that a detected protocol is one that actually works after saving. The probe reply is
      // reduced to an outcome enum plus a status and is never echoed, so a followed redirect
      // leaks no response content.
    });
    // The same timeout signal covers the body read (a junk endpoint may stream forever);
    // the byte cap covers the other direction (an endpoint that streams a lot, fast).
    const { text, truncated } = await readCappedBody(res);
    return {
      clientType: spec.clientType,
      url,
      outcome: truncated ? "junk" : classifyProbeResponse(spec.clientType, res.status, text),
      status: res.status,
    };
  } catch (err) {
    return {
      clientType: spec.clientType,
      url,
      outcome: isTimeoutError(err) ? "timeout" : "network_error",
    };
  }
}

/**
 * Runs the three probes sequentially in the required order and stops at the first
 * protocol the endpoint serves. Never throws: every failure mode is a probe outcome.
 * The result lists only the probes actually run (their order is the probe order), so
 * callers can render per-protocol outcomes for debugging; no secret ever appears in it.
 */
export async function detectModelProtocol(options: {
  baseUrl: string;
  /**
   * Explicit credential (the key typed in the dialog, or the entry's stored key). When
   * absent, each probe falls back to the environment variable for the protocol it speaks
   * — see envApiKeyForProtocol. An authenticated probe is what makes the difference
   * between a protocol-shaped error (which identifies the route) and the generic 401 or
   * gateway HTML that an anonymous request often draws instead.
   */
  apiKey?: string;
  /** Injection point for tests; defaults to global fetch (which routes through the admin proxy settings, see net/proxy.ts). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Environment source for the per-protocol fallback; injectable so tests need not mutate process.env. */
  env?: NodeJS.ProcessEnv;
}): Promise<ModelProtocolDetectResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const probes: ModelProtocolProbeDto[] = [];
  for (const spec of PROTOCOL_PROBES) {
    const apiKey = options.apiKey ?? envApiKeyForProtocol(spec.clientType, options.env);
    const probe = await runProbe(spec, options.baseUrl, apiKey, fetchImpl, timeoutMs);
    probes.push(probe);
    if (probe.outcome === "served") return { detected: spec.clientType, probes };
  }
  return { probes };
}
