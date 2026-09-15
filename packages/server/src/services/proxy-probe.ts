/**
 * Reachability and latency probe for the well-known model provider hosts, behind the proxy
 * settings page's test button.
 *
 * The question is "can THIS SERVER reach the provider, and how long does one round trip
 * take" — the outbound path the admin proxy settings configure. That path is the server's
 * own: the browser reaches the internet by a different route entirely and could not be
 * asked (a cross-origin request to a provider host is refused before it is sent), so the
 * probe belongs here. It travels the configured path for free: the startup entry replaces
 * globalThis.fetch with undici's, which resolves the process-global dispatcher per call,
 * and that dispatcher is what the proxy settings drive (see net/proxy.ts).
 *
 * Reachable is judged by the fact that an answer arrived AT ALL, and any HTTP status counts
 * — 401 and 403 included. A refused credential still proves the name resolved, TCP
 * connected, TLS completed and the host replied, which is the entire question here;
 * unlike protocol detection next door, nothing about the response body is being read.
 * Unreachable means the transport failed, and the failure keeps a short kind (timeout,
 * dns, refused, tls, network) so an admin can tell a black-holed proxy from a name with no
 * route behind it.
 *
 * No credential is ever sent. Not the caller's, and — unlike protocol detection, which
 * falls back to OPENAI_API_KEY and friends because an authenticated probe identifies a
 * protocol far more reliably — not the process environment's either: nothing about
 * reachability improves with a key, and a probe the admin did not authenticate must not
 * quietly spend one.
 *
 * The target list is hard-coded and the endpoint takes no URL from anyone — only a provider
 * id, matched against that list. An admin-triggered fetch of a caller-supplied address would
 * be an SSRF surface, and this feature has no use for one.
 *
 * One target per call. The page asks for all of them at once and renders each answer as it
 * arrives; probing them together behind a single response would hold every row blank until
 * the slowest one landed, which for a black-holed host is the whole timeout.
 */
import type { ProxyProbeDto, ProxyProbeOutcome, ProxyProbeTargetDto } from "../api/types.js";

/**
 * The targets, with the cheapest request that still proves the path: each host's
 * model-listing endpoint, which answers an unauthenticated GET with a small
 * credential-rejection body (OpenAI 401, Anthropic 401, Gemini 403, DeepSeek 401, and both
 * GLM hosts 401 as of this writing — the exact status is immaterial, an answer is an
 * answer). GET rather than HEAD because two of them do not answer HEAD honestly:
 * api.anthropic.com replies 405 and generativelanguage.googleapis.com 404, which would still
 * prove reachability but would measure a path the real traffic never takes.
 *
 * GLM is listed twice because it is two hosts: api.z.ai is the global endpoint the catalog
 * defaults to, open.bigmodel.cn the mainland one a bigmodel.cn key needs. They resolve and
 * route differently, so one can be reachable while the other is not, and an admin choosing
 * between the two keys is exactly the reader this page has.
 */
export const PROXY_PROBE_TARGETS: readonly ProxyProbeTargetDto[] = [
  { provider: "openai", url: "https://api.openai.com/v1/models" },
  { provider: "anthropic", url: "https://api.anthropic.com/v1/models" },
  { provider: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/models" },
  { provider: "deepseek", url: "https://api.deepseek.com/models" },
  { provider: "zai", url: "https://api.z.ai/api/paas/v4/models" },
  { provider: "bigmodel", url: "https://open.bigmodel.cn/api/paas/v4/models" },
];

/**
 * Per-target timeout, matching the protocol probes next door. A live host answers these in
 * tens of milliseconds even through a proxy, so five seconds is far past "slow" and well
 * short of the wait a black-holed connection would otherwise impose — and since a call
 * measures one target, it is the wait a single row can impose, not the whole run's.
 */
export const PROXY_PROBE_TIMEOUT_MS = 5_000;

/** DNS never produced an address (a proxy host that does not resolve lands here too). */
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/** Something on the path refused the connection at the TCP level — classically a dead proxy port. */
const REFUSED_CODES = new Set(["ECONNREFUSED"]);

/**
 * TLS handshake or certificate failures, which an intercepting proxy with an untrusted CA
 * produces. Node spells these either as an `ERR_TLS_*` / `ERR_SSL_*` code or as one of
 * OpenSSL's verification names; a code outside both forms is reported as a plain network
 * failure rather than guessed at.
 */
const TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/**
 * The `code` of every error in a `cause` chain, outermost first. undici wraps the real
 * fault — `TypeError: fetch failed` on the outside, the socket or resolver error
 * underneath — so the diagnosis is never on the error that was thrown. The depth cap
 * guards against a chain that loops back on itself.
 */
function errorCodeChain(err: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 8; depth += 1) {
    const { code } = current as { code?: unknown };
    if (typeof code === "string") codes.push(code);
    current = current.cause;
  }
  return codes;
}

/** One probe attempt: the status an answer came back with, or the error thrown when none did. */
export type ProxyProbeAttempt = { status: number } | { error: unknown };

/**
 * Classifies one attempt (pure; the rule this feature has, and what the unit tests pin).
 *
 * An HTTP status — any HTTP status — is reachable. Everything else is a transport failure
 * named by the deepest thing that identifies it.
 */
export function classifyProxyProbe(attempt: ProxyProbeAttempt): ProxyProbeOutcome {
  if ("status" in attempt) return "reachable";
  const { error } = attempt;
  // The timeout is our own abort, and it surfaces as a TimeoutError on the OUTERMOST error.
  // Deliberately not looked for down the chain: undici reports a proxy that refuses the
  // CONNECT tunnel as an AbortError nested under "fetch failed", and that is a refusal to
  // carry the request, not a host that took too long.
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout";
  }
  for (const code of errorCodeChain(error)) {
    if (DNS_CODES.has(code)) return "dns";
    if (REFUSED_CODES.has(code)) return "refused";
    if (TLS_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_")) {
      return "tls";
    }
  }
  return "network";
}

async function probeTarget(
  target: ProxyProbeTargetDto,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProxyProbeDto> {
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);
  try {
    const res = await fetchImpl(target.url, {
      method: "GET",
      // No Authorization, no x-api-key, no environment fallback: this probe is
      // unauthenticated by design and must stay that way even though the process has
      // OPENAI_API_KEY and its siblings to hand (see the module header).
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // fetch settles when the response HEAD arrives, so this is the wall time of everything
    // the user waits for on a real request — DNS, connect, TLS, request, first answer —
    // and nothing more. The body is never read: no part of it is classified.
    const ms = elapsedMs();
    // Releases the connection instead of leaving it draining in the background.
    await res.body?.cancel().catch(() => {});
    return {
      provider: target.provider,
      url: target.url,
      // Through the same rule the failure branch uses, so "any HTTP answer is reachable"
      // is stated once and the exported classifier is the one production runs.
      outcome: classifyProxyProbe({ status: res.status }),
      ms,
      status: res.status,
    };
  } catch (err) {
    return {
      provider: target.provider,
      url: target.url,
      outcome: classifyProxyProbe({ error: err }),
      ms: elapsedMs(),
    };
  }
}

/** The target a provider id names, or null when the id is not one of the fixed set. */
export function proxyProbeTarget(provider: string): ProxyProbeTargetDto | null {
  return PROXY_PROBE_TARGETS.find((t) => t.provider === provider) ?? null;
}

/**
 * Probes one target. Never throws: every failure mode is an outcome, including the timeout,
 * so a caller waiting on several of these always gets an answer from each.
 */
export async function probeProxyReachabilityOf(
  target: ProxyProbeTargetDto,
  options: {
    /** Injection point for tests; defaults to global fetch, which is the proxied path (see the module header). */
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<ProxyProbeDto> {
  return probeTarget(
    target,
    options.fetchImpl ?? fetch,
    options.timeoutMs ?? PROXY_PROBE_TIMEOUT_MS,
  );
}
