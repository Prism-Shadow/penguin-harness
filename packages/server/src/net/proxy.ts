/**
 * Outbound networking and the "use system HTTP proxy" switch (design § "出网与系统代理").
 *
 * Node 24's built-in fetch does not read the proxy environment variables
 * (NODE_USE_ENV_PROXY is ineffective on 24.18), so the server routes ALL of its own
 * outbound traffic through undici: the startup entry replaces `globalThis.fetch` with
 * undici's fetch once, and this module keeps undici's global dispatcher in line with the
 * admin-level setting — undici's fetch resolves the global dispatcher per call, so a
 * toggle takes effect for newly initiated connections without a restart.
 *
 * Dispatcher per setting:
 *   - on (default): `EnvHttpProxyAgent` — honors HTTP_PROXY / HTTPS_PROXY (both
 *     spellings; undici reads the lowercase name first) with a NO_PROXY list merged from
 *     the environment plus the loopback names;
 *   - off: a plain `Agent` — direct connections, proxy variables ignored.
 *
 * The loopback merge is load-bearing in either state: the CLI's readiness probe
 * (`penguin web` imports the server in-process and polls its own root path), SSE, and
 * Workspace previews all ride the loopback names, so a proxy that intercepts loopback
 * would take the whole App down. `localhost,127.0.0.1,::1` is therefore ALWAYS appended
 * to the effective NO_PROXY, regardless of what the environment declares.
 *
 * The value persisted in server_settings stays authoritative (the routes read/write the
 * repo); this module only mirrors it into the process-global dispatcher. Stripping the
 * proxy variables from agent command subprocesses when the switch is off lives in core
 * (CommandSessionManager, threaded through the session loader), not here.
 */
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";

/** Loopback names every effective NO_PROXY must contain (see module doc). */
export const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1"] as const;

/**
 * The effective NO_PROXY: the environment's entries (lowercase spelling first, matching
 * undici's own precedence) with the loopback names appended when missing. Exported as a
 * pure helper for tests; `env` defaults to the real process environment.
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
 * Builds the global dispatcher for a switch state (pure choice, exported for tests):
 * on → EnvHttpProxyAgent with the merged NO_PROXY, off → direct-connect Agent.
 */
export function buildProxyDispatcher(useSystemProxy: boolean, env?: NodeJS.ProcessEnv): Dispatcher {
  // The merged list is passed via opts.noProxy, which REPLACES the environment lookup
  // inside EnvHttpProxyAgent — merging is this module's job (undici would otherwise use
  // env NO_PROXY verbatim, without the loopback exemption).
  return useSystemProxy ? new EnvHttpProxyAgent({ noProxy: mergedNoProxy(env) }) : new Agent();
}

/** Current switch state mirrored for the dispatcher (the DB row is the persisted truth). */
let useSystemProxy = true;
/** True once the startup entry has installed undici globally (never in tests). */
let installed = false;

/**
 * One-time install at the startup entry (index.ts), before anything can fetch: replaces
 * `globalThis.fetch` with undici's and sets the initial dispatcher. Starts from the
 * default (on) — the entry applies the persisted value via {@link setUseSystemProxy} as
 * soon as the database is open, before any outbound request exists. Tests never call
 * this, so they keep the runtime's own fetch (and their fetch stubs).
 */
export function installGlobalProxyDispatcher(): void {
  installed = true;
  setGlobalDispatcher(buildProxyDispatcher(useSystemProxy));
  // Cast: undici's fetch is typed against its own RequestInit/Response declarations,
  // which are structurally compatible with the runtime globals for every caller here.
  globalThis.fetch = undiciFetch as unknown as typeof globalThis.fetch;
}

/**
 * Applies a switch state to the process: rebuilds the global dispatcher so new
 * connections follow it immediately (no restart). Called by the startup entry with the
 * persisted value and by PUT /api/admin/settings on every toggle. Outside the installed
 * runtime (tests) it only records the state.
 */
export function setUseSystemProxy(value: boolean): void {
  if (value === useSystemProxy) return;
  useSystemProxy = value;
  if (installed) setGlobalDispatcher(buildProxyDispatcher(useSystemProxy));
}

/** The switch state the dispatcher currently reflects. */
export function getUseSystemProxy(): boolean {
  return useSystemProxy;
}
