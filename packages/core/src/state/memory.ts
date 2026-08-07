/**
 * Memory: the Agent's long-term notes across Sessions.
 *
 * Memory keeps what cannot be re-derived from the current Workspace or its code history —
 * user feedback, project decisions, working conventions, entry points into external systems.
 * It is **not** context compaction: compaction preserves one Session's short-term working
 * state, Memory preserves what later Sessions need.
 *
 * There are two scopes, both belonging to one Agent and never shared with another:
 *
 *   - **User scope** (`memory/user/`) — what stays true wherever the Agent works: who the user
 *     is, their standing preferences, reference material not tied to one codebase. Every
 *     Session reads it, including one running in a temporary Workspace, which has no other
 *     place to write.
 *   - **Workspace scope** (`memory/<workspace_key>/`) — facts about one Workspace. Sessions of
 *     the same Agent in the same Workspace share it; different Workspaces keep their topic files
 *     apart. A Session in a temporary Workspace gets no Workspace scope at all.
 *
 * Each scope directory carries its own `MEMORY.md` index; only the indexes enter the model
 * context, topic bodies are read on demand. Memory lives in Agent State, so it travels with
 * export / import / snapshots and is visible to every Project member who can reach the Agent.
 *
 * On-disk layout (`agent_state/memory/`):
 *
 *     memory/
 *     ├── user/                        # User scope (no marker: it stands for no path)
 *     │   ├── MEMORY.md                # this scope's index
 *     │   └── <topic>.md
 *     └── <workspace_key>/
 *         ├── .workspace               # the Workspace path this key stands for
 *         ├── MEMORY.md
 *         └── <topic>.md               # frontmatter + body, semantic topics (not per Task/date)
 *
 * The Harness only decides *where* Memory lives, keeps writes inside that directory, and
 * injects the indexes into the prompt; the model owns the semantics — what is worth keeping,
 * how topics are split, and how the indexes are maintained — using the ordinary file tools.
 * Docs: /docs/configuration § "Memory".
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentsDir, memoryScopeDir } from "./paths.js";

/**
 * Topic types a Memory file may declare in its frontmatter. By convention `user` belongs to the
 * User scope (who the user is — role, expertise, preferences) and the other three to Workspace
 * scopes: `feedback` (how the user wants the Agent to work, with the why), `project` (ongoing
 * work, goals, constraints not derivable from the code), `reference` (pointers to external
 * resources). The convention lives in the Memory prompt; parsing stays scope-agnostic.
 */
export const MEMORY_TOPIC_TYPES = ["user", "feedback", "project", "reference"] as const;
export type MemoryTopicType = (typeof MEMORY_TOPIC_TYPES)[number];

/** Per-scope index file name, also excluded from a scope's topic listing. */
export const MEMORY_INDEX_FILENAME = "MEMORY.md";

/**
 * Directory name of the User scope under `memory/`, and its scope key throughout the API — it
 * sits alongside the Workspace directories and is read through the same code paths.
 *
 * The name is safe to reserve because a generated workspace key is always
 * `<safe-basename>-<8 hex>` and therefore always contains a hyphen: a name without one can
 * never be produced by `workspaceMemoryKeyForRealPath`, so no Workspace can ever collide with
 * it. (A Workspace directory literally named `user` yields `user-<hash>`, not `user`.)
 */
export const USER_SCOPE_KEY = "user";

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

/** The Workspace scope of one Session: absent when the Session runs in a temporary Workspace. */
export interface SessionWorkspaceMemory {
  /** Workspace key — the `memory/` subdirectory name and the API's scope key. */
  key: string;
  /** Absolute path of the Workspace's topic directory (the `{{MEMORY_DIR}}` value). */
  dir: string;
  /** Content of this scope's `MEMORY.md` (the `{{MEMORY_INDEX}}` value; empty string when blank). */
  index: string;
}

/**
 * The Memory binding of one Session, as resolved at Session creation: the User scope (always)
 * and the Workspace scope (only in a persistent Workspace), each with its own index.
 */
export interface SessionMemory {
  /** Absolute path of `memory/user/` (the `{{MEMORY_USER_DIR}}` value). */
  userDir: string;
  /** Content of `memory/user/MEMORY.md` (the `{{MEMORY_USER_INDEX}}` value; empty string when blank). */
  userIndex: string;
  /** The Workspace scope; `undefined` in a temporary Workspace, where the User scope is the only place to write. */
  workspace?: SessionWorkspaceMemory;
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
 * path's sha256>`. The hyphen before the hash is what makes `USER_SCOPE_KEY` safe to reserve —
 * every generated key carries one, so a hyphen-free name is unreachable from here.
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
 * Creates a scope's empty `MEMORY.md` when it does not exist yet. Existing content — including
 * a deliberately emptied file — is never touched: the index is the model's document, the
 * Harness only guarantees there is one to open.
 */
async function ensureScopeIndex(dir: string): Promise<void> {
  try {
    await fs.writeFile(path.join(dir, MEMORY_INDEX_FILENAME), "", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
}

/** Reads a scope's `MEMORY.md`; an empty string when it does not exist yet. */
export async function readScopeIndex(dir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, MEMORY_INDEX_FILENAME), "utf8");
  } catch {
    return "";
  }
}

/**
 * Creates a Workspace's Memory directory (with an empty `MEMORY.md`) if needed and records the
 * Workspace path in its `.workspace` marker.
 *
 * The marker is (re)written whenever it is missing or does not match, which repairs one that
 * was hand-edited, truncated or written by an older version. It is deliberately *not* a rename
 * path and cannot be one: the key is a hash of the very path the marker records, so a directory
 * reached another way — through a symlink — canonicalizes to the same real path and lands on
 * this same directory with an identical marker, while a directory that genuinely moved hashes
 * to a different key and therefore a different Memory directory.
 *
 * Never touches topic files or an existing index — those are the model's to maintain.
 */
export async function ensureWorkspaceMemoryDir(args: {
  root: string;
  projectId: string;
  agentId: string;
  workspaceKey: string;
  workspacePath: string;
}): Promise<string> {
  const dir = memoryScopeDir(args.root, args.projectId, args.agentId, args.workspaceKey);
  await fs.mkdir(dir, { recursive: true });
  await ensureScopeIndex(dir);
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

/** Absolute path of the User scope's topic directory (`memory/user/`). */
export function userMemoryDir(root: string, projectId: string, agentId: string): string {
  return memoryScopeDir(root, projectId, agentId, USER_SCOPE_KEY);
}

/**
 * Creates the User scope's directory (with an empty `MEMORY.md`) if needed. Unlike a Workspace
 * directory it gets no `.workspace` marker: the marker records the path a key was hashed from,
 * and this scope stands for no path at all — it belongs to the Agent itself. Called at Agent
 * State init and again at every Session creation, so Agents created before Memory shipped
 * self-heal.
 */
export async function ensureUserMemoryDir(
  root: string,
  projectId: string,
  agentId: string,
): Promise<string> {
  const dir = userMemoryDir(root, projectId, agentId);
  await fs.mkdir(dir, { recursive: true });
  await ensureScopeIndex(dir);
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

/**
 * Resolves the Memory a Session should run with, creating the scope directories (and their
 * empty `MEMORY.md` indexes) as a side effect. The User scope is always prepared; the Workspace
 * scope only when the Session runs in a persistent Workspace, so a temporary one never gets a
 * directory that no later Session could read back.
 *
 * Returns `null` — nothing injected, nothing created — when Memory is disabled for the Agent.
 * Failures to prepare a directory are also `null`: Memory is an enhancement, and an unwritable
 * Agent State should not take down Session creation.
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
    const userDir = await ensureUserMemoryDir(args.root, args.projectId, args.agentId);
    const userIndex = await readScopeIndex(userDir);
    if (await isTemporaryWorkspace(args.root, args.projectId, args.workspaceDir)) {
      return { userDir, userIndex };
    }
    const workspacePath = await realPathOrResolve(args.workspaceDir);
    const key = workspaceMemoryKeyForRealPath(workspacePath);
    const dir = await ensureWorkspaceMemoryDir({
      root: args.root,
      projectId: args.projectId,
      agentId: args.agentId,
      workspaceKey: key,
      workspacePath,
    });
    return { userDir, userIndex, workspace: { key, dir, index: await readScopeIndex(dir) } };
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
