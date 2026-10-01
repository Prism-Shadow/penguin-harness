/**
 * Remote plugin download: turns a URL an operator typed into the archive to install. Two
 * separate concerns, in one place because the route needs both and neither is a route:
 * `normalizePluginUrl` reads the URL (and rewrites the two GitHub shapes into the archive URL
 * they stand for), `fetchPluginArchive` performs the one outbound request and bounds it.
 *
 * A plugin archive is a zip whose contents carry `plugin.json` somewhere; where exactly is the
 * installer's question (http/routes/plugins.ts), not this module's — a plain zip URL is passed
 * through untouched.
 *
 * Safety: the URL is a server-side request an administrator controls, so it is not a
 * user-supplied fetch — but a redirect or a typo could still aim the server at its own network.
 * `isBlockedHost` refuses the obvious cases (loopback, private and link-local literals, the
 * `.local`/`.internal` names) before the request and again on the URL that answered. It is a
 * literal-host guard, not a DNS guard: a public name resolving to an internal address is not
 * caught here, which is the right trade for an admin-only endpoint on a self-hosted server and
 * would not be for one reachable by every user.
 */
import { isIP } from "node:net";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";

/**
 * Cap for a downloaded archive. Larger than the upload routes' 14MB on purpose: that number
 * exists to keep a base64 body inside the request limit, and nothing is base64 here. What is
 * fetched is often a whole repository — a GitHub tree URL downloads the checkout the plugin
 * lives in — so 32MB is what "a plugin archive" means over the network, while the plugin that
 * comes out of it is capped by the same content limits either way (see unzipBounded).
 */
export const MAX_PLUGIN_ARCHIVE_BYTES = 32 * 1024 * 1024;

/**
 * How long one download may take. Generous compared with a balance query — this pulls a file,
 * not a status — but bounded, so an unresponsive host cannot pin a request handler.
 */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** A URL, read: what to fetch, which subdirectory inside the archive is the plugin, and the name the URL itself suggests. */
export interface PluginArchiveSource {
  /** The URL to fetch (the GitHub archive URL when the input was a repository page). */
  fetchUrl: string;
  /** Path inside the archive under which the plugin root must live ("" = anywhere, the shallowest plugin root wins). */
  subdir: string;
  /** The name the URL suggests (a GitHub repository, a tree URL's directory); undefined when only the archive's own layout can say. */
  name?: string;
}

/**
 * Reads an operator-typed URL into the fetch it stands for. Accepted:
 * - a zip URL (anything http/https ending in `.zip`, or any URL whose response turns out to be
 *   an archive — the extension is not required, only used to suggest a name);
 * - `https://github.com/<owner>/<repo>` → that repository's default branch (`…/archive/HEAD.zip`);
 * - `https://github.com/<owner>/<repo>/tree/<ref>[/<sub…>]` → that ref, with `sub` as the
 *   subdirectory to look in (this is the shape a "copy the URL of the folder" gesture yields).
 * Anything else on github.com is not an archive (a `blob` page, a user page) → 400.
 */
export function normalizePluginUrl(raw: string): PluginArchiveSource {
  const trimmed = raw.trim();
  if (trimmed === "") throw badRequest("url must not be empty.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, "unsupported_url", "url must be an absolute http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "unsupported_url", "url must be an http(s) URL.");
  }
  assertHostAllowed(url);

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") {
    // A plain link: fetched as given. The file name suggests a name only when it is a zip.
    const file = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const suggested = file.toLowerCase().endsWith(".zip") ? file.slice(0, -4) : undefined;
    return { fetchUrl: url.toString(), subdir: "", ...(suggested ? { name: suggested } : {}) };
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, repo, kind, ...rest] = segments;
  if (!owner || !repo) {
    throw new HttpError(
      400,
      "unsupported_url",
      "Not a GitHub repository URL: expected /<owner>/<repo>.",
    );
  }
  const repoUrl = `https://github.com/${owner}/${repo}`;
  if (kind === undefined) {
    // The repository page: its default branch. `HEAD` needs no API call to resolve.
    return { fetchUrl: `${repoUrl}/archive/HEAD.zip`, subdir: "", name: repo };
  }
  // `/archive/…`, `/releases/download/…`, `/raw/…`: already a download link, passed through.
  if (kind !== "tree") {
    return { fetchUrl: url.toString(), subdir: "", name: repo };
  }
  const [ref, ...sub] = rest;
  if (!ref) throw new HttpError(400, "unsupported_url", "A GitHub tree URL needs a branch or tag.");
  const subdir = sub.join("/");
  return {
    fetchUrl: `${repoUrl}/archive/${encodeURIComponent(ref)}.zip`,
    subdir,
    // The plugin directory is the last segment of the subdirectory — that is its name.
    name: sub.length > 0 ? sub[sub.length - 1]! : repo,
  };
}

/** Refuses a host that can only be the server's own network (see the module header). */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  const version = isIP(host);
  if (version === 4) {
    const octets = host.split(".").map(Number);
    const [a, b] = octets as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (version === 6) {
    // ::1 and :: (loopback, unspecified), fe80::/10 (link-local), fc00::/7 (unique-local).
    return (
      /^(0*:)*0*1$/.test(host) ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb") ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    );
  }
  return false;
}

function assertHostAllowed(url: URL): void {
  if (isBlockedHost(url.hostname)) {
    throw new HttpError(
      400,
      "blocked_url",
      `Refusing to fetch from a local or private host: ${url.hostname}`,
    );
  }
}

/**
 * Fetches one plugin archive. Bounded three ways — a deadline, a decoded-size cap enforced
 * while streaming (a `content-length` is a claim, and a chunked response makes no claim at
 * all), and a re-check of the host that actually answered (a redirect may leave the network
 * the URL declared). Every failure is an HttpError the route returns as-is: `download_failed`
 * for a transport error or a non-2xx answer, `plugin_too_large` past the cap.
 */
export async function fetchPluginArchive(
  source: PluginArchiveSource,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Buffer> {
  const doFetch = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(source.fetchUrl, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "application/zip, application/octet-stream, */*" },
      signal: AbortSignal.timeout(options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw new HttpError(400, "download_failed", `Could not download: ${message(err)}`);
  }
  if (res.url) {
    try {
      assertHostAllowed(new URL(res.url));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "download_failed", "Could not read the URL that answered.");
    }
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpError(400, "download_failed", `Download failed with HTTP ${res.status}.`);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PLUGIN_ARCHIVE_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    throw pluginArchiveTooLarge(MAX_PLUGIN_ARCHIVE_BYTES);
  }
  return readBounded(res);
}

/** Reads the body, refusing the moment it passes the cap rather than after buffering it all. */
async function readBounded(res: Response): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PLUGIN_ARCHIVE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw pluginArchiveTooLarge(MAX_PLUGIN_ARCHIVE_BYTES);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * The one "too large" answer, shared by both import routes so an over-size archive reads the
 * same whether it was uploaded or downloaded — each quoting its own cap (the transport decides
 * that number: a base64 request body for an upload, server memory for a download).
 */
export function pluginArchiveTooLarge(limitBytes: number): HttpError {
  return new HttpError(
    413,
    "plugin_too_large",
    `The archive exceeds the ${Math.floor(limitBytes / (1024 * 1024))}MB limit.`,
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
