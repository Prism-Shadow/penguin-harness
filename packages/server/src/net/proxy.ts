/**
 * Outbound networking and the admin proxy settings (design § "出网与系统代理").
 *
 * Node 24's built-in fetch does not read the proxy environment variables
 * (NODE_USE_ENV_PROXY is ineffective on 24.18), so the server routes ALL of its own
 * outbound traffic through undici: the startup entry replaces `globalThis.fetch` with
 * undici's fetch once, and this module keeps undici's global dispatcher in line with the
 * admin-level settings — undici's fetch resolves the global dispatcher per call, so a
 * settings change takes effect for newly initiated connections without a restart.
 *
 * Dispatcher per settings state (keyed on the "application uses the proxy" switch; the
 * separate agent-environment switch never touches the dispatcher — it only drives the
 * command-subprocess policy in app.ts):
 *   - app switch off: a plain `Agent` — direct connections, proxy variables ignored;
 *   - on, no explicit address (default): `EnvHttpProxyAgent` — honors HTTP_PROXY /
 *     HTTPS_PROXY (both spellings; undici reads the lowercase name first) with a
 *     NO_PROXY list merged from the environment plus the loopback names;
 *   - on with an explicit address (`proxyUrl`): `EnvHttpProxyAgent` again, but with its
 *     `httpProxy` / `httpsProxy` options pinned to that URL — undici consults those
 *     BEFORE the environment (verified against undici 7.29's constructor:
 *     `httpProxy ?? process.env.http_proxy ?? process.env.HTTP_PROXY`), so the explicit
 *     address governs both http and https traffic regardless of ambient env, while the
 *     merged NO_PROXY keeps working through the same `noProxy` option.
 *
 * The loopback merge is load-bearing in every state: the CLI's readiness probe
 * (`penguin web` imports the server in-process and polls its own root path), SSE, and
 * Workspace previews all ride the loopback names, so a proxy that intercepts loopback
 * would take the whole App down. `localhost,127.0.0.1,::1` is therefore ALWAYS appended
 * to the effective NO_PROXY, regardless of what the environment declares.
 *
 * The values persisted in server_settings stay authoritative (the routes read/write the
 * repo); this module only mirrors them into the process-global dispatcher. The command
 * subprocess side — keyed on the agent-environment switch: strip the proxy variables
 * when it is off, inject the explicit address when set, pass through otherwise — lives
 * in core (CommandSessionManager, threaded through the session loader as a
 * ProxyEnvPolicy getter), not here.
 */
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";

/** Loopback names every effective NO_PROXY must contain (see module doc). */
export const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1"] as const;

/** The slice of the admin proxy settings the dispatcher mirrors (persisted in server_settings). */
export interface ProxySettings {
  /** The "application uses the proxy" switch (default on). */
  proxyForApp: boolean;
  /** Explicit proxy URL (normalized, see {@link normalizeProxyUrl}); null = follow the proxy environment variables. */
  proxyUrl: string | null;
}

/**
 * The effective NO_PROXY: the environment's entries (lowercase spelling first, matching
 * undici's own precedence) with the loopback names appended when missing. Exported as a
 * pure helper for tests and for app.ts's command-subprocess policy getter; `env`
 * defaults to the real process environment.
 */
export function mergedNoProxy(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.no_proxy ?? env.NO_PROXY ?? "";
  // Same separators undici's parser accepts (comma or whitespace).
  const entries = raw.split(/[,\s]/).filter((e) => e !== "");
  const present = new Set(entries.map((e) => e.toLowerCase()));
  for (const name of LOOPBACK_NO_PROXY) {
    if (!present.has(name)) entries.push(name);
  }
  return entries.join(",");
}

/**
 * Normalizes a proxy address to its canonical URL, or null when it is not acceptable.
 * Accepted forms: `http://host[:port]`, `https://host[:port]`, and the bare
 * `host[:port]` / `host` shorthand (normalized to `http://…`). Anything else — other
 * schemes (the dispatcher speaks only HTTP(S) proxies; a socks:// URL would break every
 * server fetch, see os-proxy.ts for the same rule), credentials, paths, queries — is
 * rejected rather than stored: server_settings only ever holds normalized values.
 */
export function normalizeProxyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Bare host[:port] shorthand: no scheme -> http. The scheme test requires "://", so
  // "host:8080" (a port, not a scheme) takes the shorthand path.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "" || url.username !== "" || url.password !== "") return null;
  // A proxy address is host-only; the parser's bare "/" (its normal form for an absent
  // path) is tolerated, an actual path/query/fragment means this was not a proxy address.
  if ((url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") {
    return null;
  }
  // origin is the canonical form: lowercased scheme/host, default ports dropped.
  return url.origin;
}

/** The EnvHttpProxyAgent option subset this module assembles (undici's Options type is not re-exported cleanly). */
export interface EnvProxyAgentOptions {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy: string;
}

/**
 * The EnvHttpProxyAgent options for the switch-on states (pure choice, exported for
 * tests): always the merged NO_PROXY — passed via opts.noProxy, which REPLACES the
 * environment lookup inside EnvHttpProxyAgent, so merging is this module's job (undici
 * would otherwise use env NO_PROXY verbatim, without the loopback exemption) — plus,
 * with an explicit address, the httpProxy/httpsProxy overrides that pin both traffic
 * kinds to it.
 */
export function envProxyAgentOptions(
  proxyUrl: string | null,
  env?: NodeJS.ProcessEnv,
): EnvProxyAgentOptions {
  const noProxy = mergedNoProxy(env);
  return proxyUrl === null ? { noProxy } : { httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy };
}

/**
 * Builds the global dispatcher for a settings state (pure choice, exported for tests):
 * app switch off → direct-connect Agent, on → EnvHttpProxyAgent (env-driven, or pinned
 * to the explicit address; see {@link envProxyAgentOptions}).
 */
export function buildProxyDispatcher(settings: ProxySettings, env?: NodeJS.ProcessEnv): Dispatcher {
  if (!settings.proxyForApp) return new Agent();
  return new EnvHttpProxyAgent(envProxyAgentOptions(settings.proxyUrl, env));
}

/** Current settings mirrored for the dispatcher (the DB rows are the persisted truth). */
let current: ProxySettings = { proxyForApp: true, proxyUrl: null };
/** True once the startup entry has installed undici globally (never in tests). */
let installed = false;

/**
 * One-time install at the startup entry (index.ts), before anything can fetch: replaces
 * `globalThis.fetch` with undici's and sets the initial dispatcher. Starts from the
 * defaults (on, no explicit address) — the entry applies the persisted values via
 * {@link applyProxySettings} as soon as the database is open, before any outbound
 * request exists. Tests never call this, so they keep the runtime's own fetch (and
 * their fetch stubs).
 */
export function installGlobalProxyDispatcher(): void {
  installed = true;
  setGlobalDispatcher(buildProxyDispatcher(current));
  // Cast: undici's fetch is typed against its own RequestInit/Response declarations,
  // which are structurally compatible with the runtime globals for every caller here.
  globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch;
}

/**
 * Applies a settings state to the process: rebuilds the global dispatcher so new
 * connections follow it immediately (no restart). Called by the startup entry with the
 * persisted values and by PUT /api/admin/settings on every change. Outside the
 * installed runtime (tests) it only records the state.
 */
export function applyProxySettings(settings: ProxySettings): void {
  if (settings.proxyForApp === current.proxyForApp && settings.proxyUrl === current.proxyUrl) {
    return;
  }
  current = { proxyForApp: settings.proxyForApp, proxyUrl: settings.proxyUrl };
  if (installed) setGlobalDispatcher(buildProxyDispatcher(current));
}
