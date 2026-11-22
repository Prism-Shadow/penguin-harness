/**
 * Serving the files a package ships for an iframe page: a server module's route hands a path
 * under its own `ui/` folder here (PRFC-0036: a plugin's page is an iframe of its own files,
 * served by its own route). One content-type table and one set of response headers, so every
 * framed document is served alike. A code plugin reaches both functions through
 * `@prismshadow/penguin-server/plugin`.
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
 * The file `rel` names under `dir`, or null: `rel` must be a safe relative path, and the file must
 * exist, be a regular file and be reached through no link — resolved, it is exactly `rel` under
 * the resolved `dir`, so neither a link out of the folder nor one inside it hands out a file.
 * `dir` itself may lie below a link (a package in a linked prefix).
 */
export async function containedFile(dir: string, rel: string): Promise<string | null> {
  if (!isSafeRelPath(rel)) return null;
  try {
    const root = await fs.realpath(dir);
    const file = await fs.realpath(path.join(dir, rel));
    if (file !== path.join(root, rel)) return null;
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
