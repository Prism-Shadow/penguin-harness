/**
 * OS-proxy resolution for the embedded server (design § "出网与系统代理"): on the
 * desktop, "system proxy" means the real operating-system setting. The shell resolves
 * it through Electron's resolveProxy when forking the server and injects the result
 * into the child environment as HTTP_PROXY / HTTPS_PROXY — the server's dispatcher
 * (and, while the admin switch is on, agent commands) then honor it. Variables already
 * present in the shell's environment are never overridden (same idiom as
 * bundledShellEnv): an explicitly configured environment wins over the OS lookup.
 * An admin-configured explicit proxy address (server_settings `proxyUrl`) in turn wins
 * over BOTH at the server's dispatcher and in agent command env injection — what this
 * module injects is only the "follow the system proxy" default the server falls back to.
 *
 * Only the entry point touches Electron, behind a dynamic import; the parsing and the
 * override check stay pure so they unit-test without an Electron runtime.
 */

/** The variables injected, with the probe URL whose scheme selects the OS proxy rule. */
const PROXY_VARS = [
  { name: "HTTP_PROXY", lower: "http_proxy", probe: "http://example.com/" },
  { name: "HTTPS_PROXY", lower: "https_proxy", probe: "https://example.com/" },
] as const;

type ProxyVar = (typeof PROXY_VARS)[number];

/** The proxy variables `env` does not already define (either spelling — those are kept as-is). */
export function unsetProxyVars(env: NodeJS.ProcessEnv): readonly ProxyVar[] {
  return PROXY_VARS.filter((v) => env[v.name] === undefined && env[v.lower] === undefined);
}

/**
 * Maps one PAC-style resolveProxy result to a proxy URL, or null for "connect
 * directly". The result is a `;`-separated fallback list ("PROXY host:port; DIRECT");
 * the first usable entry wins: `PROXY` → http://, `HTTPS` (a proxy reached over TLS) →
 * https://. `DIRECT` and the SOCKS flavors yield nothing — undici's dispatcher speaks
 * only HTTP(S) proxies, and injecting a socks:// URL would break every server fetch.
 */
export function proxyUrlFromPacResult(result: string): string | null {
  for (const entry of result.split(";")) {
    const m = /^\s*(PROXY|HTTPS)\s+(\S+)\s*$/i.exec(entry);
    if (!m) continue;
    const scheme = m[1]!.toUpperCase() === "HTTPS" ? "https" : "http";
    return `${scheme}://${m[2]!}`;
  }
  return null;
}

/**
 * The proxy environment to add to the server child: the OS resolution of every proxy
 * variable the shell's own environment leaves unset. Best-effort — any resolution
 * failure injects nothing (the server then simply sees no proxy configuration).
 */
export async function osProxyEnv(): Promise<Record<string, string>> {
  const wanted = unsetProxyVars(process.env);
  if (wanted.length === 0) return {};
  try {
    const { session } = await import("electron");
    const env: Record<string, string> = {};
    for (const v of wanted) {
      const url = proxyUrlFromPacResult(await session.defaultSession.resolveProxy(v.probe));
      if (url !== null) env[v.name] = url;
    }
    return env;
  } catch {
    return {};
  }
}
