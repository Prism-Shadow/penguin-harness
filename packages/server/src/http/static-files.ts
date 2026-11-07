/**
 * Serving a file a package ships for an iframe: a workflow's `ui/` (workflows/routes.ts) and an
 * installed plugin's `ui/` (http/routes/plugin-ui.ts). One content-type table and one set of
 * response headers, so the two documents the app frames are served alike.
 *
 * The caching contract is the SPA's own (app.ts, cacheControlFor), for the same reason: a
 * document that must be revalidated per open needs a validator, or every open re-downloads it
 * AND — since a plugin's document loads its assets beside it — everything it draws. So:
 *
 * - `no-cache` plus a weak size+mtime ETag by default: the browser stores the file, asks
 *   once per open, and a 304 costs one round trip instead of the bytes.
 * - `immutable`, for a caller that knows the URL is versioned (a document under `?v=<stamp>`,
 *   plugin/package.ts): its bytes can never change under that name, so it is never asked
 *   about again — not even on the next app start.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** A relative path of plain segments: no leading slash, no backslash, no empty, `.` or `..` segment. */
export function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/**
 * The file `rel` names under `dir`, or null: `rel` must be a safe relative path, the file must
 * exist and be a regular file, and — symlinks resolved on both sides — it must still lie
 * inside `dir`, so a link inside the directory cannot hand out a file outside it.
 */
export async function containedFile(dir: string, rel: string): Promise<string | null> {
  if (!isSafeRelPath(rel)) return null;
  try {
    const root = await fs.realpath(dir);
    const file = await fs.realpath(path.join(dir, rel));
    if (!file.startsWith(root + path.sep)) return null;
    return (await fs.stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * Whether `If-None-Match` claims this exact representation, per RFC 9110's rules rather than
 * by string equality: the header is a LIST (`"a", "b"`), comparison is WEAK (a proxy's `W/`
 * downgrade must still hit), and `*` means any current representation.
 */
export function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  if (header.trim() === "*") return true;
  const want = bare(etag);
  return header.split(",").some((tag) => bare(tag) === want);
}

/** The file as a response: its content type by extension, revalidated unless it is versioned. */
export async function uiFileResponse(
  c: Context,
  file: string,
  opts: { immutable?: boolean } = {},
): Promise<Response> {
  // ONE handle for both stat and read: a handle names an inode, so the validator is
  // guaranteed to describe the bytes being sent (app.ts's disk branch says why).
  const handle = await fs.open(file, "r");
  let content: Buffer;
  let stat: Awaited<ReturnType<typeof handle.stat>>;
  try {
    stat = await handle.stat();
    content = await handle.readFile();
  } finally {
    await handle.close();
  }
  const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
  const headers: Record<string, string> = {
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    etag,
    "cache-control": opts.immutable === true ? "private, max-age=31536000, immutable" : "no-cache",
  };
  if (ifNoneMatchHits(c.req.header("if-none-match"), etag)) return c.body(null, 304, headers);
  // A copy into a plain Uint8Array, as the SPA's own static answers do: a Buffer's backing
  // store is `ArrayBufferLike`, which a Response body may not be.
  return c.body(new Uint8Array(content), 200, headers);
}
