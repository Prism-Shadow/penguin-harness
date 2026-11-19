/**
 * What a cleanup item names, and where it lives.
 *
 * An item's id is its place on disk in parts — kind, Project, Agent, cache location, name — each
 * URI-encoded and joined by `/`, so the id a review hands out is all a delete needs to find the
 * folder again, and nothing in it can climb out of the data root: every part is checked (ids as
 * ids, a name as one path segment, a location against ./layout.ts) before a path is built.
 *
 * A folder is removed by first moving it aside in one rename — into its Project's
 * `agents/.deleting/` (where a deleted Agent's folder waits too, and which the server resumes
 * removing at its next start), or into the cache location's own `.deleting/` — and its contents
 * are removed from there in the background. The trash name keeps to the id alphabet, ends in a
 * timestamp like an Agent deletion's, and is unique.
 */
import { randomBytes } from "node:crypto";
import path from "node:path";
import { isValidId, scratchpadDir, workspacesDir } from "@prismshadow/penguin-core";
import type { StorageCleanupKind } from "../api/storage-types.js";
import { DELETING_DIR, deletingDir } from "../services/agent-service.js";
import { CACHE_LOCATIONS } from "./layout.js";
import type { CacheLocation } from "./layout.js";

/** A cleanup item's place: an Agent's scratchpad, Workspace or cache entry, or a server cache entry. */
export type ItemRef =
  | { kind: "scratchpad"; projectId: string; agentId: string; name: string }
  | { kind: "workspace"; projectId: string; agentId: string; name: string }
  | {
      kind: "agentCache";
      projectId: string;
      agentId: string;
      location: CacheLocation;
      name: string;
    }
  | { kind: "serverCache"; location: CacheLocation; name: string };

/** The name a cache location keeps its own trash under; never offered as an entry. */
export const CACHE_TRASH = DELETING_DIR;

/** One path segment: no separator, no NUL, not `.` or `..`. */
export function isSegment(name: string): boolean {
  return (
    name.length > 0 && name.length <= 255 && name !== "." && name !== ".." && !/[/\\\0]/.test(name)
  );
}

const enc = encodeURIComponent;

/** The id a review hands out for `ref`. */
export function itemId(ref: ItemRef): string {
  switch (ref.kind) {
    case "scratchpad":
    case "workspace":
      return [ref.kind, ref.projectId, ref.agentId, ref.name].map(enc).join("/");
    case "agentCache":
      return [ref.kind, ref.projectId, ref.agentId, ref.location.key, ref.name].map(enc).join("/");
    case "serverCache":
      return [ref.kind, ref.location.key, ref.name].map(enc).join("/");
  }
}

function locationOf(key: string, scope: CacheLocation["scope"]): CacheLocation | null {
  return CACHE_LOCATIONS.find((l) => l.key === key && l.scope === scope) ?? null;
}

/** The place an id names, or null when it names none a review could have handed out. */
export function parseItemId(id: string): ItemRef | null {
  let parts: string[];
  try {
    parts = id.split("/").map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  const kind = parts[0] as StorageCleanupKind;
  if (kind === "scratchpad" || kind === "workspace") {
    if (parts.length !== 4) return null;
    const [, projectId, agentId, name] = parts as [string, string, string, string];
    if (!isValidId(projectId) || !isValidId(agentId) || !isSegment(name)) return null;
    // A scratchpad is named by its Session's id.
    if (kind === "scratchpad") return isValidId(name) ? { kind, projectId, agentId, name } : null;
    return { kind, projectId, agentId, name };
  }
  if (kind === "agentCache") {
    if (parts.length !== 5) return null;
    const [, projectId, agentId, dir, name] = parts as [string, string, string, string, string];
    const location = locationOf(dir, "agent");
    if (!isValidId(projectId) || !isValidId(agentId) || location === null) return null;
    if (!isSegment(name) || name === CACHE_TRASH) return null;
    return { kind, projectId, agentId, location, name };
  }
  if (kind === "serverCache") {
    if (parts.length !== 3) return null;
    const [, dir, name] = parts as [string, string, string];
    const location = locationOf(dir, "server");
    if (location === null || !isSegment(name) || name === CACHE_TRASH) return null;
    return { kind, location, name };
  }
  return null;
}

/** The folder `ref` names under `root`. */
export function itemPath(root: string, ref: ItemRef): string {
  switch (ref.kind) {
    case "scratchpad":
      return path.join(scratchpadDir(root, ref.projectId, ref.agentId), ref.name);
    case "workspace":
      return path.join(workspacesDir(root, ref.projectId, ref.agentId), ref.name);
    case "agentCache":
      return path.join(ref.location.dir(root, ref.projectId, ref.agentId), ref.name);
    case "serverCache":
      return path.join(ref.location.dir(root), ref.name);
  }
}

/** Where `ref` waits while its contents are removed: the directory, and the name inside it. */
export function trashFor(root: string, ref: ItemRef, now: number): { dir: string; path: string } {
  const unique = `${randomBytes(4).toString("hex")}-${now}`;
  const tidy = ref.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  if (ref.kind === "serverCache") {
    const dir = path.join(ref.location.dir(root), CACHE_TRASH);
    return { dir, path: path.join(dir, `${tidy}-${unique}`) };
  }
  const dir = deletingDir(root, ref.projectId);
  return { dir, path: path.join(dir, `${ref.agentId}-${ref.kind}-${tidy}-${unique}`) };
}
