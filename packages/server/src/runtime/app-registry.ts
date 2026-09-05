/**
 * App Center registry files: `<project>/apps/<id>.toml`, one registered app per file, the
 * file name (a semantic id) being the app's identity. The file is the truth — an app built in
 * a Session registers itself through the `penguin app` CLI (or the API / the web form), and a
 * hand-edited file is picked up on the next read. This module is pure parsing, serialization
 * and file access; status probing lives in app-probe.ts and the action message in
 * app-actions.ts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { atomicWriteFile, projectDir } from "@prismshadow/penguin-core";

/** What a registered app is; drives the list's kind glyph and nothing else. */
export const APP_KINDS = ["web", "api", "cli", "other"] as const;
export type AppKind = (typeof APP_KINDS)[number];

/** A parsed app file (the file name minus `.toml` is `id`). */
export interface AppDefinition {
  id: string;
  name: string;
  description?: string;
  /** The owning Session: restart / stop requests are sent there as user input. */
  sessionId: string;
  agentId: string;
  workspace: string;
  /** Local URL the app serves at (the "open" link and the default health probe target). */
  url?: string;
  /** Probe target when it differs from `url`; the probe uses `healthUrl ?? url`. */
  healthUrl?: string;
  startCommand?: string;
  stopCommand?: string;
  kind: AppKind;
  /** ISO 8601; absent in a hand-written file that carries no timestamps (the reader falls back to the file's mtime). */
  registeredAt?: string;
  updatedAt?: string;
}

export type AppParseResult = { ok: true; def: AppDefinition } | { ok: false; error: string };

/** The Project's registry directory (beside `.project_config.toml`; created on the first write). */
export function appsDir(root: string, projectId: string): string {
  return path.join(projectDir(root, projectId), "apps");
}

/** Accepts an absolute http(s) URL only: the probe fetches it, and a relative path or another scheme would never answer. */
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Optional string field: absent or a non-empty string; anything else is an error naming the key. */
function optionalField(
  t: Record<string, unknown>,
  key: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const v = t[key];
  if (v === undefined) return { ok: true, value: undefined };
  if (typeof v !== "string" || v.trim() === "")
    return { ok: false, error: `${key} must be a non-empty string` };
  return { ok: true, value: v };
}

/** Timestamp field: an ISO string or a TOML datetime, normalized to ISO; absent stays absent. */
function optionalInstant(
  t: Record<string, unknown>,
  key: string,
): { ok: true; value: string | undefined } | { ok: false; error: string } {
  const v = t[key];
  if (v === undefined) return { ok: true, value: undefined };
  const ms = v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(ms)) return { ok: false, error: `${key} is not a valid ISO 8601 instant` };
  return { ok: true, value: new Date(ms).toISOString() };
}

/**
 * Parses and validates one app file. A field of the wrong type invalidates the whole file
 * (the list reports it under invalidFiles instead of guessing); unknown keys are ignored.
 * `kind` defaults to `web`, the common case for an app registered from a conversation.
 */
export function parseAppFile(id: string, raw: string): AppParseResult {
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse TOML: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object")
    return { ok: false, error: "Content is not a TOML table" };
  const t = parsed as Record<string, unknown>;

  const required: Partial<Record<"name" | "session_id" | "agent_id" | "workspace", string>> = {};
  for (const key of ["name", "session_id", "agent_id", "workspace"] as const) {
    const v = t[key];
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: `Missing required field ${key}` };
    }
    required[key] = v;
  }

  const optional: Record<string, string | undefined> = {};
  for (const key of ["description", "url", "health_url", "start_command", "stop_command"]) {
    const r = optionalField(t, key);
    if (!r.ok) return r;
    optional[key] = r.value;
  }
  for (const key of ["url", "health_url"]) {
    const value = optional[key];
    if (value !== undefined && !isHttpUrl(value)) {
      return { ok: false, error: `${key} must be an absolute http(s) URL` };
    }
  }

  const kindRaw = t["kind"] === undefined ? "web" : t["kind"];
  if (typeof kindRaw !== "string" || !(APP_KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, error: `kind must be one of ${APP_KINDS.join(" / ")}` };
  }

  const registeredAt = optionalInstant(t, "registered_at");
  if (!registeredAt.ok) return registeredAt;
  const updatedAt = optionalInstant(t, "updated_at");
  if (!updatedAt.ok) return updatedAt;

  return {
    ok: true,
    def: {
      id,
      name: required.name!,
      ...(optional["description"] !== undefined ? { description: optional["description"] } : {}),
      sessionId: required.session_id!,
      agentId: required.agent_id!,
      workspace: required.workspace!,
      ...(optional["url"] !== undefined ? { url: optional["url"] } : {}),
      ...(optional["health_url"] !== undefined ? { healthUrl: optional["health_url"] } : {}),
      ...(optional["start_command"] !== undefined
        ? { startCommand: optional["start_command"] }
        : {}),
      ...(optional["stop_command"] !== undefined ? { stopCommand: optional["stop_command"] } : {}),
      kind: kindRaw as AppKind,
      ...(registeredAt.value !== undefined ? { registeredAt: registeredAt.value } : {}),
      ...(updatedAt.value !== undefined ? { updatedAt: updatedAt.value } : {}),
    },
  };
}

/** Serializes API fields into file content (validation goes through parseAppFile on read, so there is one set of rules). */
export function serializeApp(def: Omit<AppDefinition, "id">): string {
  const table: Record<string, unknown> = {
    name: def.name,
    ...(def.description !== undefined ? { description: def.description } : {}),
    session_id: def.sessionId,
    agent_id: def.agentId,
    workspace: def.workspace,
    ...(def.url !== undefined ? { url: def.url } : {}),
    ...(def.healthUrl !== undefined ? { health_url: def.healthUrl } : {}),
    ...(def.startCommand !== undefined ? { start_command: def.startCommand } : {}),
    ...(def.stopCommand !== undefined ? { stop_command: def.stopCommand } : {}),
    kind: def.kind,
    ...(def.registeredAt !== undefined ? { registered_at: def.registeredAt } : {}),
    ...(def.updatedAt !== undefined ? { updated_at: def.updatedAt } : {}),
  };
  return `${stringifyToml(table)}\n`;
}

/**
 * An id derived from a display name, for a registration that names none: lowercase, runs of
 * anything outside `[a-z0-9_]` become one hyphen, and the result is trimmed to the id length
 * cap. An empty outcome (a name of only punctuation, say) reads as `app`. The caller resolves
 * collisions by suffixing a counter.
 */
export function slugifyAppId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug === "" ? "app" : slug;
}

/** One file of the registry, parsed, plus the stat the timestamp fallback reads. */
export interface AppFileEntry {
  id: string;
  raw: string;
  parsed: AppParseResult;
  mtimeMs: number;
}

async function readEntry(dir: string, id: string): Promise<AppFileEntry | null> {
  const file = path.join(dir, `${id}.toml`);
  try {
    const [raw, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { id, raw, parsed: parseAppFile(id, raw), mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/** Lists the Project's app files in name order (a missing directory is an empty registry). */
export async function listAppFiles(root: string, projectId: string): Promise<AppFileEntry[]> {
  const dir = appsDir(root, projectId);
  let listing: string[];
  try {
    listing = await fs.readdir(dir);
  } catch {
    return [];
  }
  const ids = listing
    .filter((f) => f.endsWith(".toml"))
    .sort()
    .map((f) => f.slice(0, -".toml".length));
  const entries = await Promise.all(ids.map((id) => readEntry(dir, id)));
  return entries.filter((e): e is AppFileEntry => e !== null);
}

export async function readAppFile(
  root: string,
  projectId: string,
  id: string,
): Promise<AppFileEntry | null> {
  return readEntry(appsDir(root, projectId), id);
}

/** Writes one app file (full replacement for POST / PUT), creating the directory on first use. */
export async function writeAppFile(
  root: string,
  projectId: string,
  id: string,
  raw: string,
): Promise<void> {
  const dir = appsDir(root, projectId);
  await fs.mkdir(dir, { recursive: true });
  await atomicWriteFile(path.join(dir, `${id}.toml`), raw, { followSymlinks: true });
}

/** Deletes one app file; false when it does not exist. */
export async function deleteAppFile(root: string, projectId: string, id: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(appsDir(root, projectId), `${id}.toml`));
    return true;
  } catch {
    return false;
  }
}
