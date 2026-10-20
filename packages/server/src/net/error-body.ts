/**
 * Provider error bodies in shapes the OpenAI SDK does not read, made readable.
 *
 * The SDK builds every message from `body.error`: `APIError.generate(status, error, message)`
 * is handed `errorResponse?.['error']`, and when that is absent the message collapses to
 * `"<status> status code (no body)"` no matter what the provider actually said. Gateways that
 * are not OpenAI (LiteLLM and the ones built on it) answer errors as
 * `{ code, message, traceId }` — no top-level `error` — so their text never reaches a caller.
 *
 * Why that matters beyond readability: `classifyVisionProbe` decides "this model refuses
 * images" (turn the switch off) from the provider's wording (`services/vision-detect.ts`,
 * `isImageRejection`). A dropped body turns a definitive refusal into `failed`, which must
 * leave the user's setting alone — so a model that genuinely cannot see images is recorded
 * as "we learned nothing".
 *
 * The fix is one wrapper around the global fetch installed at startup, before any client is
 * constructed (the SDK captures `globalThis.fetch` when a client is built). It adds the
 * `error` the SDK reads to the narrow case that is provably a loss: an error status, a JSON
 * body, a JSON object, and no top-level `error`. The provider's own fields are kept beside it,
 * so a reader that already understood this gateway (`services/protocol-detect.ts` reads
 * `message` / `detail`) sees exactly what it saw before. Everything else — successes, streams,
 * non-JSON bodies, errors already in OpenAI's shape — is returned untouched, and a
 * normalization fault is swallowed rather than turned into a harness-side error.
 *
 * Deliberately a wrapper, not a replacement: `net/proxy.ts` routes outbound traffic through
 * the process-global undici dispatcher and leaves `globalThis.fetch` alone for a reason (the
 * SDK's Request/FormData are brand-checked against the runtime's own classes). Passing the
 * original arguments straight through keeps that intact.
 */

/** Marks the wrapper so a second install (HMR, an embedded server restarted in-process) is a no-op. */
const INSTALLED = Symbol.for("penguin.errorBodyNormalizer");

type NormalizingFetch = typeof fetch & { [INSTALLED]?: true };

/**
 * The OpenAI shape for a body the SDK could not read. Exported for its own test; call
 * {@link installErrorBodyNormalizer} to put it in front of outbound requests.
 */
export async function normalizeErrorBodyResponse(response: Response): Promise<Response> {
  if (response.status < 400) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) return response;

  let body: unknown;
  try {
    // The clone carries the bytes; the response handed back below is either this same
    // untouched response or a fresh one, so a caller never sees a consumed body.
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return response;

  const record = body as Record<string, unknown>;
  if ("error" in record) return response;

  const message =
    typeof record.message === "string" && record.message.length > 0
      ? record.message
      : JSON.stringify(body);
  const code =
    typeof record.code === "string"
      ? record.code
      : typeof record.type === "string"
        ? record.type
        : undefined;

  const headers = new Headers(response.headers);
  // The rewritten body has its own length; keeping the provider's would describe the old one.
  headers.delete("content-length");

  return new Response(
    // Merged, not replaced: the SDK reads `error`, and a caller that already understood this
    // gateway's own fields keeps them.
    JSON.stringify({ ...record, error: { message, ...(code === undefined ? {} : { type: code, code }) } }),
    { status: response.status, statusText: response.statusText, headers },
  );
}

/**
 * Install the wrapper once. Call this before any model client is constructed — the SDK reads
 * `globalThis.fetch` at construction — which is why the server lifecycle does it beside the
 * proxy dispatcher, at the earliest startup step.
 */
export function installErrorBodyNormalizer(): void {
  const current = globalThis.fetch as NormalizingFetch;
  if (current[INSTALLED]) return;

  const wrapped = (async (...args: Parameters<typeof fetch>) => {
    const response = await current(...args);
    try {
      return await normalizeErrorBodyResponse(response);
    } catch {
      // Never let the adapter's own fault replace the provider's answer.
      return response;
    }
  }) as NormalizingFetch;
  wrapped[INSTALLED] = true;
  globalThis.fetch = wrapped;
}
