/**
 * Serving a file a package ships for an iframe: a workflow's `ui/` (workflows/routes.ts) and an
 * installed plugin's `ui/` (http/routes/plugin-ui.ts). One content-type table and one set of
 * response headers, so the two documents the app frames are served alike.
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

/** The file as a response: its content type by extension, revalidated on every load. */
export async function uiFileResponse(c: Context, file: string): Promise<Response> {
  const body = await fs.readFile(file);
  return c.body(body, 200, {
    "content-type": CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
}
