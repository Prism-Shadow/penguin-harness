/**
 * App attribution: the headers that name PenguinHarness to the gateways that read one, keyed on
 * the endpoint host. GenerativeModel attaches them to every request, and the server's provider
 * OAuth flow reuses APP_URL.
 *
 * The one place core names a gateway (PRN-021): core special-cases no model, provider or gateway
 * anywhere else. The headers live here rather than in the server's catalog because they are a
 * property of the server being called, not of a provider group.
 *
 * Docs: packages/docs/content/models.{en,zh}.md § "App attribution".
 */

/**
 * App attribution: how the harness identifies itself to gateways that rank or report the apps
 * calling them. Both values describe PenguinHarness itself, never a model or an account.
 *
 * `APP_URL` is also the `app_url` a provider OAuth flow stamps onto the key it mints, which is
 * why it is exported: a stable app URL is required there, and a second copy would let the two
 * attributions drift apart.
 */
export const APP_URL = "https://penguin.ooo/";
const APP_TITLE = "PenguinHarness";
/**
 * OpenRouter marketplace categories, comma-separated. OpenRouter accepts at most **two per
 * request** from a fixed slug list and silently drops anything else, so this string is
 * exactly two recognised slugs.
 */
const OPENROUTER_CATEGORIES = "cli-agent,personal-agent";

/**
 * Lowercase host of a base URL; undefined when it is blank or unparseable. A fully-qualified
 * trailing dot is stripped: `URL` keeps it in `hostname`, but `openrouter.ai.` names the same
 * server as `openrouter.ai` and has to match the same way. Stripping cannot widen the match —
 * a suffix-anchored comparison rejects `openrouter.ai.attacker.com` with or without the dot.
 */
function endpointHost(baseUrl: string | undefined): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

/** Host equality extended to subdomains; suffix-anchored, so `notopenrouter.ai` never matches. */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Attribution headers for a request's base URL, or undefined when that endpoint runs no
 * attribution scheme (every direct vendor, and every gateway that does not read one).
 *
 * Keyed on the endpoint host rather than on a provider group, because the group is a display
 * bucket while the headers are a property of the server being called: a `custom` entry pointed
 * at OpenRouter is still PenguinHarness talking to OpenRouter and is attributed identically. The
 * flip side is that an entry carrying no `base_url` of its own gets no headers even when
 * `OPENAI_BASE_URL` sends it to a gateway — that variable is read inside MMSP and never reaches
 * this side.
 *
 * - OpenRouter (https://openrouter.ai/docs/app-attribution): `HTTP-Referer` is the identity
 *   that creates the app page and drives the rankings, `X-OpenRouter-Title` is its display
 *   name, `X-OpenRouter-Categories` files it under marketplace categories.
 * - TokenDance (https://tokendance.space/docs/app-attribution): `X-App-URL` alone, and it
 *   takes priority over any App URL recorded on the API key — the same key may be in use by
 *   other tools, so the per-request value is the accurate one.
 * - OpenCode (https://opencode.ai): `x-opencode-session` alone, and it names the conversation
 *   rather than the app — the gateway keys its routing and prompt caching on it, so the value
 *   has to hold still across a conversation's requests and differ between conversations. It
 *   is **always** sent: the gateway refuses a request that names none (400 "Request is missing
 *   x-opencode-session"). A Session's requests carry the Session's id; a request with none (a
 *   connectivity test, a vision probe) gets a fresh random id, making it a conversation of its
 *   own — never a shared constant, which would file every such request under one session. A
 *   caller that sends several requests without a Session computes the headers once and
 *   reuses them (GenerativeModel does, per instance), so they share that one id.
 */
export function attributionHeaders(
  baseUrl: string | undefined,
  sessionId?: string,
): Record<string, string> | undefined {
  const host = endpointHost(baseUrl);
  if (!host) return undefined;
  if (hostMatches(host, "openrouter.ai")) {
    return {
      "HTTP-Referer": APP_URL,
      "X-OpenRouter-Title": APP_TITLE,
      "X-OpenRouter-Categories": OPENROUTER_CATEGORIES,
    };
  }
  if (hostMatches(host, "tokendance.space")) return { "X-App-URL": APP_URL };
  if (hostMatches(host, "opencode.ai")) {
    return { "x-opencode-session": sessionId || globalThis.crypto.randomUUID() };
  }
  return undefined;
}
