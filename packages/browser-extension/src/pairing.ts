/**
 * Pairing, as the options page runs it: the server address and the one-time code the Web App
 * showed are exchanged for a token (POST /api/builtin-browser/extension/pair, no cookie), and the
 * server is stored. The background worker sees the new entry and connects.
 */
import { upsertServer, type PairedServer } from "./storage.js";
import { EXTENSION_PAIR_PATH, parsePairResponse, type ExtensionPairRequest } from "./wire.js";

export type PairError =
  | { code: "url_empty" | "url_invalid" | "url_scheme" | "code_invalid" | "bad_response" }
  | { code: "unreachable"; origin: string }
  | { code: "refused"; message: string };

export type PairOutcome = { ok: true; server: PairedServer } | { ok: false; error: PairError };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin to pair with, from what the user pasted: a full address keeps its scheme, a bare
 * host gets https (http for a loopback host, where the desktop app's server listens); any path,
 * query or fragment is dropped.
 */
export function normalizeServerUrl(
  input: string,
): { origin: string } | { error: "url_empty" | "url_invalid" | "url_scheme" } {
  const trimmed = input.trim();
  if (trimmed === "") return { error: "url_empty" };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return { error: "url_invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "url_scheme" };
  if (url.hostname === "") return { error: "url_invalid" };
  if (!hasScheme && LOOPBACK_HOSTS.has(url.hostname)) url.protocol = "http:";
  return { origin: url.origin };
}

/** The pairing code as the Web App shows it: 32 random bytes, base64url (43 characters). */
export function normalizeCode(input: string): string | null {
  const code = input.replace(/\s+/g, "");
  return /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}

/** How this Chrome names itself to the server: "Chrome 130 on macOS". */
export function deviceName(userAgent: string, platform: string | undefined): string {
  const major = /Chrome\/(\d+)/.exec(userAgent)?.[1];
  const chrome = major === undefined ? "Chrome" : `Chrome ${major}`;
  return platform !== undefined && platform !== "" ? `${chrome} on ${platform}` : chrome;
}

export function currentPlatform(): string | undefined {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform || navigator.platform || undefined;
}

/** The server's error text from a refused request: `{ error: { code, message } }`. */
async function refusalOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown; code?: unknown } };
    const message = body.error?.message ?? body.error?.code;
    if (typeof message === "string" && message !== "") return message;
  } catch {
    // Not JSON: fall back to the status line.
  }
  return `HTTP ${res.status}`;
}

export async function pair(input: {
  serverUrl: string;
  code: string;
  extensionVersion: string;
  name: string;
  now?: () => Date;
}): Promise<PairOutcome> {
  const target = normalizeServerUrl(input.serverUrl);
  if ("error" in target) return { ok: false, error: { code: target.error } };
  const code = normalizeCode(input.code);
  if (code === null) return { ok: false, error: { code: "code_invalid" } };

  const body: ExtensionPairRequest = { code, name: input.name, version: input.extensionVersion };
  let res: Response;
  try {
    res = await fetch(new URL(EXTENSION_PAIR_PATH, target.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
    });
  } catch {
    return { ok: false, error: { code: "unreachable", origin: target.origin } };
  }
  if (!res.ok) return { ok: false, error: { code: "refused", message: await refusalOf(res) } };

  let answer: unknown;
  try {
    answer = await res.json();
  } catch {
    return { ok: false, error: { code: "bad_response" } };
  }
  const paired = parsePairResponse(answer);
  if (paired === null) return { ok: false, error: { code: "bad_response" } };

  const server: PairedServer = {
    origin: target.origin,
    label: new URL(target.origin).host,
    token: paired.token,
    extensionId: paired.extensionId,
    installId: paired.installId,
    user: paired.user,
    serverVersion: paired.serverVersion,
    pairedAt: (input.now?.() ?? new Date()).toISOString(),
  };
  await upsertServer(server);
  return { ok: true, server };
}

/**
 * Whether the server is a newer release than this extension by a minor version or more, so the
 * user should update it. Versions are `major.minor.patch`; anything else compares as equal.
 */
export function isUpdateAvailable(extensionVersion: string, serverVersion: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)/.exec(v)?.slice(1).map(Number);
  const own = parse(extensionVersion);
  const theirs = parse(serverVersion);
  if (own === undefined || theirs === undefined) return false;
  const [ownMajor = 0, ownMinor = 0] = own;
  const [major = 0, minor = 0] = theirs;
  return major > ownMajor || (major === ownMajor && minor > ownMinor);
}
