/**
 * Workspace Memory: the Agent's long-term notes across Sessions.
 *
 * Memory keeps what cannot be re-derived from the current Workspace or its code history —
 * user feedback, project decisions, working conventions, entry points into external systems.
 * It is **not** context compaction: compaction preserves one Session's short-term working
 * state, Memory preserves what later Sessions need.
 *
 * Scope is `Project + Agent + Workspace`: Sessions of the same Agent in the same Workspace
 * share one Memory; different Workspaces of one Agent keep their topic files apart but share
 * a single index; different Agents never share Memory even in the same Workspace. Memory lives
 * in Agent State, so it travels with export / import / snapshots and is visible to every
 * Project member who can reach the Agent — which is why there is no `user` topic type here.
 *
 * On-disk layout (`agent_state/memory/`):
 *
 *     memory/
 *     ├── AGENTS.md                    # the single index, grouped by workspace key
 *     └── <workspace_key>/
 *         ├── .workspace               # the Workspace path this key stands for
 *         └── <topic>.md               # frontmatter + body, semantic topics (not per Task/date)
 *
 * The Harness only decides *where* Memory lives, keeps writes inside that directory, and
 * injects the index into the prompt; the model owns the semantics — what is worth keeping,
 * how topics are split, and how the index is maintained — using the ordinary file tools.
 * Docs: /docs/configuration § "Workspace Memory".
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentsDir, memoryIndexPath, workspaceMemoryDir } from "./paths.js";

/** Topic types a Memory file may declare in its frontmatter. `user` is deliberately absent: a Project is a multi-user boundary, and personal data written here would be readable by every member. */
export const MEMORY_TOPIC_TYPES = ["feedback", "project", "reference"] as const;
export type MemoryTopicType = (typeof MEMORY_TOPIC_TYPES)[number];

/** The index file name, used both for `memory/AGENTS.md` and to exclude it from a Workspace's topic listing. */
export const MEMORY_INDEX_FILENAME = "AGENTS.md";

/**
 * Marker file inside a Workspace Memory directory recording the Workspace path the key was
 * derived from. The key alone is a hash and cannot be read back into a path, so this is what
 * lets the Web App label a Workspace; it is a dotfile so it never shows up as a topic.
 */
export const WORKSPACE_MARKER_FILENAME = ".workspace";

/** Length of the path hash suffix in a workspace key: 32 bits of a sha256, enough that two Workspaces on one machine practically never collide. */
const KEY_HASH_LENGTH = 8;

/** Cap on the readable part of a workspace key, so a deeply named directory can't produce an unwieldy path. */
const KEY_BASE_MAX_LENGTH = 40;

/** Frontmatter of one Memory topic file. */
export interface MemoryTopicMetadata {
  /** Display name; falls back to the file name when the frontmatter omits it. */
  name: string;
  /** One line telling a reader whether the body is worth opening. */
  description: string;
  /** Topic type; `undefined` when the file declares none or an unknown one. */
  type?: MemoryTopicType;
  /** Last-updated date as written in the file (`YYYY-MM-DD` by convention, not parsed). */
  updatedAt?: string;
}

/**
 * The Memory binding of one Session: the Workspace's own topic directory plus the shared
 * index content, as resolved at Session creation.
 */
export interface SessionMemory {
  /** Workspace key — the `memory/` subdirectory name and the index's group heading. */
  key: string;
  /** Absolute path of the Workspace's topic directory (the `{{MEMORY_DIR}}` value). */
  dir: string;
  /** Full content of `memory/AGENTS.md` (empty string when it does not exist yet). */
  index: string;
}

/**
 * Turns a Workspace directory name into the readable half of its key: everything outside
 * `[A-Za-z0-9_-]` collapses to a hyphen, and the result is lowercased and truncated. A
 * directory whose name survives as empty (a filesystem root, a name made only of separators
 * or CJK characters) falls back to `workspace` — the hash half still keeps the key unique.
 */
function safeKeyBase(dirName: string): string {
  const cleaned = dirName
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_BASE_MAX_LENGTH)
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : "workspace";
}

/**
 * The workspace key for an already-canonical absolute path: `<safe-basename>-<8 hex of the
 * path's sha256>`.
 *
 * Identity is the directory itself and has nothing to do with Git: two symlinks pointing at
 * one directory resolve to the same real path and therefore the same key, while moving or
 * renaming a directory makes it a new Workspace (its old Memory stays on disk under the old
 * key). Prefer `workspaceMemoryKey`, which canonicalizes first.
 */
export function workspaceMemoryKeyForRealPath(realPath: string): string {
  const hash = createHash("sha256").update(realPath).digest("hex").slice(0, KEY_HASH_LENGTH);
  return `${safeKeyBase(path.basename(realPath))}-${hash}`;
}

/**
 * The workspace key for a Workspace directory: resolves symlinks and `..` first so every
 * route to one directory produces one key. A path that cannot be canonicalized (already
 * deleted, or not readable) falls back to `path.resolve`, which still yields a stable key
 * rather than failing Session creation.
 */
export async function workspaceMemoryKey(workspaceDir: string): Promise<string> {
  return workspaceMemoryKeyForRealPath(await realPathOrResolve(workspaceDir));
}

async function realPathOrResolve(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * Whether a Workspace is one PenguinHarness created for a Session itself, i.e. it sits under
 * some Agent's `workspaces/` directory (`<project>/agents/<agent>/workspaces/tmp-xxxxxxxx`).
 *
 * Temporary Workspaces get no Memory, because one is allocated per Session (see
 * `createTempWorkspace`, called once per `createSession`): no later Session ever runs in that
 * directory, so anything written to a Memory directory keyed off it could never be read back —
 * it would be write-only storage. Note this is *not* because the directory gets cleaned up:
 * deleting a Session removes its Traces and scratchpad but leaves `workspaces/tmp-xxxxxxxx`
 * behind, and nothing prunes it.
 *
 * The check is by location rather than by "did the caller pass a workspaceDir", because a
 * subagent inherits its parent's Workspace as an explicit argument — including when that
 * Workspace is the parent's temporary one.
 */
export async function isTemporaryWorkspace(
  root: string,
  projectId: string,
  workspaceDir: string,
): Promise<boolean> {
  const real = await realPathOrResolve(workspaceDir);
  const base = await realPathOrResolve(agentsDir(root, projectId));
  const rel = path.relative(base, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const segments = rel.split(path.sep);
  // <agentId>/workspaces/<workspace_id>: anything shallower is the Agent directory itself.
  return segments.length >= 3 && segments[1] === "workspaces";
}

/**
 * Creates a Workspace's Memory directory if needed and records the Workspace path in its
 * `.workspace` marker.
 *
 * The marker is (re)written whenever it is missing or does not match, which repairs one that
 * was hand-edited, truncated or written by an older version. It is deliberately *not* a rename
 * path and cannot be one: the key is a hash of the very path the marker records, so a directory
 * reached another way — through a symlink — canonicalizes to the same real path and lands on
 * this same directory with an identical marker, while a directory that genuinely moved hashes
 * to a different key and therefore a different Memory directory.
 *
 * Never touches the index or any topic file — those are the model's to create on the first save.
 */
export async function ensureWorkspaceMemoryDir(args: {
  root: string;
  projectId: string;
  agentId: string;
  workspaceKey: string;
  workspacePath: string;
}): Promise<string> {
  const dir = workspaceMemoryDir(args.root, args.projectId, args.agentId, args.workspaceKey);
  await fs.mkdir(dir, { recursive: true });
  const marker = path.join(dir, WORKSPACE_MARKER_FILENAME);
  const line = `${args.workspacePath}\n`;
  try {
    if ((await fs.readFile(marker, "utf8")) === line) return dir;
  } catch {
    // No marker yet (or unreadable): fall through and write it.
  }
  await fs.writeFile(marker, line, "utf8");
  return dir;
}

/** Reads the Workspace path recorded in a Memory directory's marker; `undefined` when the marker is missing or empty. */
export async function readWorkspaceMarker(dir: string): Promise<string | undefined> {
  try {
    const raw = (await fs.readFile(path.join(dir, WORKSPACE_MARKER_FILENAME), "utf8")).trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the shared Memory index (`memory/AGENTS.md`); an empty string when it does not exist yet. */
export async function readMemoryIndex(
  root: string,
  projectId: string,
  agentId: string,
): Promise<string> {
  try {
    return await fs.readFile(memoryIndexPath(root, projectId, agentId), "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolves the Memory a Session should run with, creating its Workspace directory as a side
 * effect. Returns `null` — meaning nothing is injected into the prompt and no directory is
 * created — when Memory is disabled for the Agent or the Session runs in a temporary
 * Workspace. Failures to prepare the directory are also `null`: Memory is an enhancement, and
 * an unwritable Agent State should not take down Session creation.
 */
export async function resolveSessionMemory(args: {
  root: string;
  projectId: string;
  agentId: string;
  workspaceDir: string;
  enabled: boolean;
}): Promise<SessionMemory | null> {
  if (!args.enabled) return null;
  try {
    if (await isTemporaryWorkspace(args.root, args.projectId, args.workspaceDir)) return null;
    const workspacePath = await realPathOrResolve(args.workspaceDir);
    const key = workspaceMemoryKeyForRealPath(workspacePath);
    const dir = await ensureWorkspaceMemoryDir({
      root: args.root,
      projectId: args.projectId,
      agentId: args.agentId,
      workspaceKey: key,
      workspacePath,
    });
    return { key, dir, index: await readMemoryIndex(args.root, args.projectId, args.agentId) };
  } catch {
    return null;
  }
}

/**
 * Parses a Memory topic file's frontmatter, in the same line-oriented way as Skill
 * frontmatter (values are plain scalars, not full YAML). Returns `null` when the file has no
 * frontmatter block at all; individual missing fields are simply left out, so a hand-edited
 * file never fails to list. `fallbackName` (normally the file name) stands in for a missing
 * `name`.
 */
export function parseMemoryFrontmatter(
  content: string,
  fallbackName: string,
): MemoryTopicMetadata | null {
  // Strip a possible UTF-8 BOM (editors add one when a file is edited by hand); CRLF is handled by \r?\n.
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^﻿/, ""));
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  const type = fields["type"];
  const updatedAt = fields["updated_at"];
  return {
    name: fields["name"] || fallbackName,
    description: fields["description"] ?? "",
    ...(isMemoryTopicType(type) ? { type } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

/** Whether a string is one of the supported topic types. */
export function isMemoryTopicType(value: unknown): value is MemoryTopicType {
  return typeof value === "string" && (MEMORY_TOPIC_TYPES as readonly string[]).includes(value);
}
