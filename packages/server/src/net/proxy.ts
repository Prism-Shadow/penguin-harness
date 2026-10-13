/**
 * Outbound networking and the admin proxy settings.
 *
 * Node 24's built-in fetch does not read the proxy environment variables
 * (NODE_USE_ENV_PROXY is ineffective on 24.18), so the server routes ALL of its own
 * outbound traffic through a dispatcher built from the npm `undici`: the startup entry
 * installs it as the process-global dispatcher once, and this module keeps it in line with
 * the admin-level settings. The runtime's own fetch is built on its bundled copy of undici,
 * which resolves the global dispatcher per call from the same process-wide slot npm
 * undici's `setGlobalDispatcher` writes, so every caller — this server and every SDK —
 * follows the settings, and a change takes effect for newly initiated connections without
 * a restart.
 *
 * `globalThis.fetch` itself is left alone. The runtime's fetch, Request, Response, Headers
 * and FormData are one copy of undici; npm undici's fetch is another, and it brand-checks its
 * arguments against its OWN classes. As the global fetch it would read a Request an SDK
 * built with the global class as the string "[object Request]" ("Failed to parse URL from
 * [object Request]" — the Gemini SDK's Interactions client builds every request that way)
 * and a global FormData body as "[object FormData]". Code that imports undici's fetch on
 * purpose pairs it with undici's own classes (runtime/messaging/telegram-api.ts).
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
 *     merged NO_PROXY keeps working through the same `noProxy` option. The pinned
 *     address may be a socks5:// / socks:// URL: undici's ProxyAgent (which
 *     EnvHttpProxyAgent builds per address) tunnels through SOCKS5 since 7.29
 *     (experimental; the startup script disables the ExperimentalWarning).
 *
 * The loopback merge is load-bearing in every state: the CLI's readiness probe
 * (`penguin web` imports the server in-process and polls its own root path), SSE, and
 * Workspace previews all ride the loopback names, so a proxy that intercepts loopback
 * would take the whole App down. `localhost,127.0.0.1,::1` is therefore ALWAYS appended
 * to the effective NO_PROXY, regardless of what the environment declares.
 *
 * Local destinations go direct in both switch-on states, whatever the proxy settings say:
 * loopback, the private ranges and link-local ({@link LOCAL_NETWORKS}), and `localhost` /
 * `*.local` names. A desktop proxy (Clash, Surge, a corporate gateway) usually cannot reach
 * a LAN address at all and answers 502 for it, so a model endpoint at 192.168.x.y would
 * fail only because a proxy was set. undici's own NO_PROXY parser matches names and exact
 * addresses but not CIDR ranges, so the choice is made per request in front of
 * EnvHttpProxyAgent ({@link LocalFirstDispatcher}), and the user's own NO_PROXY keeps
 * working inside it as before. Names are matched as written, not resolved: a name that
 * resolves to a private address goes the way its NO_PROXY entry, if any, says.
 *
 * Machines are not reached through any of this. A connected machine's API, events and
 * terminals are channels inside the one ssh session this server holds to it, dialled through
 * that session's loopback SOCKS port by node:http with an agent of its own
 * (machines/transport), so neither the proxy variables nor the global dispatcher ever see
 * that traffic.
 *
 * The values persisted in server_settings stay authoritative (the routes read/write the
 * repo); this module only mirrors them into the process-global dispatcher. The command
 * subprocess side — keyed on the agent-environment switch: strip the proxy variables
 * when it is off, inject the explicit address when set, pass through otherwise — lives
 * in core (CommandSessionManager, threaded through the session loader as a
 * ProxyEnvPolicy getter), not here.
 */
import net from "node:net";
import { Agent, Dispatcher, EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher } from "undici";

/** Loopback names every effective NO_PROXY must contain (see module doc). */
export const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1"] as const;

/**
 * Loopback, the private ranges and link-local, IPv4 and IPv6: the destinations no proxy is
 * used for (see module doc). Spelled as CIDR ranges because that is also how they reach a
 * command's NO_PROXY ({@link agentNoProxy}), which curl (7.86 and later), Python and Go read.
 */
export const LOCAL_NETWORKS = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
] as const;

const localNetworks = new net.BlockList();
for (const range of LOCAL_NETWORKS) {
  const [address, prefix] = range.split("/") as [string, string];
  localNetworks.addSubnet(address, Number(prefix), net.isIPv6(address) ? "ipv6" : "ipv4");
}

/**
 * Whether a destination host — a URL's hostname, IPv6 brackets and all — is local: a literal
 * address in {@link LOCAL_NETWORKS} (an IPv4-mapped IPv6 one included), or a `localhost` or
 * `.local` name. Names are not resolved.
 */
export function isLocalDestination(host: string): boolean {
  let name = host.trim().toLowerCase();
  if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
  if (name.endsWith(".")) name = name.slice(0, -1);
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  // A zone id (`fe80::1%en0`) names the interface, not the address.
  const address = name.split("%")[0]!;
  const family = net.isIP(address);
  if (family === 0) return false;
  return localNetworks.check(address, family === 6 ? "ipv6" : "ipv4");
}

/**
 * Sends each request to `direct` when its destination is local ({@link isLocalDestination})
 * and to `proxied` otherwise. A dispatcher of its own because undici's NO_PROXY cannot express
 * an address range (see module doc).
 */
export class LocalFirstDispatcher extends Dispatcher {
  readonly #direct: Dispatcher;
  readonly #proxied: Dispatcher;

  constructor(direct: Dispatcher, proxied: Dispatcher) {
    super();
    this.#direct = direct;
    this.#proxied = proxied;
  }

  override dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    const origin = options.origin;
    let host = "";
    try {
      host = origin === undefined ? "" : new URL(String(origin)).hostname;
    } catch {
      // No origin to read: the proxied side decides, as it would have alone.
    }
    return (isLocalDestination(host) ? this.#direct : this.#proxied).dispatch(options, handler);
  }

  override close(): Promise<void>;
  override close(callback: () => void): void;
  override close(callback?: () => void): Promise<void> | void {
    const closed = Promise.all([this.#direct.close(), this.#proxied.close()]).then(() => {});
    if (callback === undefined) return closed;
    void closed.then(callback, callback);
  }

  override destroy(): Promise<void>;
  override destroy(err: Error | null): Promise<void>;
  override destroy(callback: () => void): void;
  override destroy(err: Error | null, callback: () => void): void;
  override destroy(
    errOrCallback?: Error | null | (() => void),
    callback?: () => void,
  ): Promise<void> | void {
    const err = typeof errOrCallback === "function" ? null : (errOrCallback ?? null);
    const done = typeof errOrCallback === "function" ? errOrCallback : callback;
    const destroyed = Promise.all([this.#direct.destroy(err), this.#proxied.destroy(err)]).then(
      () => {},
    );
    if (done === undefined) return destroyed;
    void destroyed.then(done, done);
  }
}

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
 * The NO_PROXY a command an Agent runs is given when the explicit proxy address is injected
 * (app.ts's command-subprocess policy): {@link mergedNoProxy}, then the local ranges of
 * {@link LOCAL_NETWORKS} as CIDR entries and `.local`, so a command bypasses the proxy for the
 * same destinations this server does. A tool that does not read CIDR entries skips them.
 */
export function agentNoProxy(env: NodeJS.ProcessEnv = process.env): string {
  const entries = mergedNoProxy(env).split(",");
  const present = new Set(entries.map((e) => e.toLowerCase()));
  for (const entry of [...LOCAL_NETWORKS.filter((range) => range !== "::1/128"), ".local"]) {
    if (!present.has(entry)) entries.push(entry);
  }
  return entries.join(",");
}

/**
 * Normalizes a proxy address to its canonical URL, or null when it is not acceptable.
 * Accepted forms: any proxy URL undici's dispatcher takes — `http://`, `https://` and
 * the (experimental in undici) `socks5://` / `socks://` schemes, credentials included —
 * plus the bare `host[:port]` / `host` shorthand (normalized to `http://…`). Beyond
 * URL-parseability the gate is acceptance by undici itself rather than a scheme list
 * duplicated here, and it is load-bearing: buildProxyDispatcher constructs a ProxyAgent
 * from the stored value at every startup, and undici throws synchronously on schemes it
 * cannot speak (socks4, ftp, …) — persisting such a value would keep the server from
 * ever booting again. server_settings only ever holds normalized values.
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
  if (url.hostname === "") return null;
  // href is the canonical form (lowercased scheme, default ports dropped) that — unlike
  // origin, which drops credentials and reads "null" for non-special schemes like
  // socks — keeps the whole address intact; only the parser's bare "/" (its normal form
  // for an absent path) is trimmed off.
  const normalized =
    url.pathname === "/" && url.search === "" && url.hash === "" ? url.href.slice(0, -1) : url.href;
  try {
    // Acceptance probe: the same constructor EnvHttpProxyAgent runs per pinned address.
    // An idle agent's close resolves immediately; nothing was connected.
    void new ProxyAgent({ uri: normalized }).close();
  } catch {
    return null;
  }
  return normalized;
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
 * app switch off → direct-connect Agent, on → local destinations direct and the rest through
 * EnvHttpProxyAgent (env-driven, or pinned to the explicit address; see
 * {@link envProxyAgentOptions}). `direct` is the dispatcher local destinations take; a test
 * hands in one that can reach a private address it cannot bind.
 */
export function buildProxyDispatcher(
  settings: ProxySettings,
  env?: NodeJS.ProcessEnv,
  direct: Dispatcher = new Agent(),
): Dispatcher {
  if (!settings.proxyForApp) return direct;
  return new LocalFirstDispatcher(
    direct,
    new EnvHttpProxyAgent(envProxyAgentOptions(settings.proxyUrl, env)),
  );
}

/** Current settings mirrored for the dispatcher (the DB rows are the persisted truth). */
let current: ProxySettings = { proxyForApp: true, proxyUrl: null };
/** True once {@link installGlobalProxyDispatcher} has run; until then settings are only recorded. */
let installed = false;

/**
 * One-time install at the startup entry (index.ts), before anything can fetch: sets the
 * initial process-global dispatcher, which the runtime's fetch resolves per call. Starts
 * from the defaults (on, no explicit address) — the entry applies the persisted values
 * via {@link applyProxySettings} as soon as the database is open, before any outbound
 * request exists. `globalThis.fetch` is not replaced (see module doc).
 */
export function installGlobalProxyDispatcher(): void {
  installed = true;
  setGlobalDispatcher(buildProxyDispatcher(current));
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
