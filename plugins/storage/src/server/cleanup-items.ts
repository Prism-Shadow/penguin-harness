/**
 * What a cleanup item names, and where it lives.
 *
 * An item's id is its place on disk in parts — kind, Project, Agent, cache location, name — each
 * URI-encoded and joined by `/`, so the id a review hands out is all a delete needs to find the
 * folder again, and nothing in it can climb out of the data root: every part is checked (ids as
 * ids, a name as one path segment, a location against ./layout.ts) before a path is built.
 *
 * A folder is removed by the host's deleting folders (`DeletingFolders`, through the plugin face):
 * one rename moves it aside — into its Project's `agents/.deleting/` (where a deleted Agent's
 * folder waits too, and which the server resumes removing at its next start), or into the server
 * cache location's own deleting folder — and its contents are removed from there in the
 * background. {@link placeFor} says where, and what the moved folder's name starts with.
 */
import path from "node:path";
import { isValidId } from "@prismshadow/penguin-core/plugin";
import type { DataLayout, DeletingPlace } from "@prismshadow/penguin-server/plugin";
import type { StorageCleanupKind } from "../types.js";
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
    if (!isSegment(name)) return null;
    return { kind, projectId, agentId, location, name };
  }
  if (kind === "serverCache") {
    if (parts.length !== 3) return null;
    const [, dir, name] = parts as [string, string, string];
    const location = locationOf(dir, "server");
    if (location === null || !isSegment(name)) return null;
    return { kind, location, name };
  }
  return null;
}

/** The folder `ref` names. */
export function itemPath(layout: DataLayout, ref: ItemRef): string {
  switch (ref.kind) {
    case "scratchpad":
      return path.join(layout.scratchpadDir(ref.projectId, ref.agentId), ref.name);
    case "workspace":
      return path.join(layout.workspacesDir(ref.projectId, ref.agentId), ref.name);
    case "agentCache":
      return path.join(ref.location.dir(layout, ref.projectId, ref.agentId), ref.name);
    case "serverCache":
      return path.join(ref.location.dir(layout), ref.name);
  }
}

/**
 * Where `ref` waits while its contents are removed — its Project's deleting folder, or a server
 * cache location's own — and what the moved folder's name starts with (the host keeps it to the
 * id alphabet and makes it unique).
 */
export function placeFor(
  layout: DataLayout,
  ref: ItemRef,
): { place: DeletingPlace; label: string } {
  if (ref.kind === "serverCache") {
    return { place: { within: ref.location.dir(layout) }, label: ref.name.slice(0, 80) };
  }
  return {
    place: { projectId: ref.projectId },
    label: `${ref.agentId}-${ref.kind}-${ref.name.slice(0, 80)}`,
  };
}
