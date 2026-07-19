/**
 * Schedule file access: `agent_state/schedule/<name>.toml`, where
 * the filename (a semantic name) is the identity. Reads are fault-tolerant (an invalid
 * file is recorded as an error and skipped by the caller); writes only go through the
 * API routes (the system never rewrites existing file content — PUT is a full-file
 * replacement expressing user intent).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { loadProjectConfig, resolveModelRef, scheduleDir } from "@prismshadow/penguin-core";
import type { ScheduleDefinition } from "./schedule-file.js";
import { parseScheduleFile, type ScheduleParseResult } from "./schedule-file.js";

export interface ScheduleFileEntry {
  name: string;
  raw: string;
  parsed: ScheduleParseResult;
}

/** List all schedule files for this Agent (a missing directory is treated as empty). */
export async function listScheduleFiles(
  root: string,
  projectId: string,
  agentId: string,
): Promise<ScheduleFileEntry[]> {
  const dir = scheduleDir(root, projectId, agentId);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries: ScheduleFileEntry[] = [];
  for (const file of names.sort()) {
    if (!file.endsWith(".toml")) continue;
    const name = file.slice(0, -".toml".length);
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, file), "utf8");
    } catch {
      continue; // Deleted during reconciliation: revisit next round.
    }
    entries.push({ name, raw, parsed: parseScheduleFile(name, raw) });
  }
  return entries;
}

export async function readScheduleFile(
  root: string,
  projectId: string,
  agentId: string,
  name: string,
): Promise<ScheduleFileEntry | null> {
  const file = path.join(scheduleDir(root, projectId, agentId), `${name}.toml`);
  try {
    const raw = await fs.readFile(file, "utf8");
    return { name, raw, parsed: parseScheduleFile(name, raw) };
  } catch {
    return null;
  }
}

/** Serialize API fields into file content (validation uniformly goes through parseScheduleFile, avoiding two sets of rules). */
export function serializeSchedule(fields: {
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
  sessionId?: string;
  workspace?: string;
  modelId?: string;
  provider?: string;
}): string {
  const table: Record<string, unknown> = {
    prompt: fields.prompt,
    enabled: fields.enabled,
    start_at: fields.startAt,
    ...(fields.period !== undefined ? { period: fields.period } : {}),
    ...(fields.endAt !== undefined ? { end_at: fields.endAt } : {}),
    ...(fields.sessionId !== undefined ? { session_id: fields.sessionId } : {}),
    ...(fields.workspace !== undefined ? { workspace: fields.workspace } : {}),
    ...(fields.provider !== undefined ? { provider: fields.provider } : {}),
    ...(fields.modelId !== undefined ? { model_id: fields.modelId } : {}),
  };
  return `${stringifyToml(table)}\n`;
}

/**
 * Resolvability check for a schedule's model reference (shared by save and
 * reconciliation): when the definition has `model_id`, it's
 * resolved against Project config per resolveModelRef semantics — omitting provider is
 * only resolvable when model_id matches exactly one entry globally; zero hits or
 * ambiguity means unresolvable. Returns an error message (unresolvable / config read
 * failure), or null if resolvable (or no model reference at all).
 */
export async function validateScheduleModelRef(
  root: string,
  projectId: string,
  def: Pick<ScheduleDefinition, "modelId" | "provider">,
): Promise<string | null> {
  if (def.modelId === undefined) return null;
  try {
    const cfg = await loadProjectConfig(root, projectId);
    resolveModelRef(cfg, def.modelId, def.provider);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Write a schedule file to disk (full-file replacement for POST/PUT). */
export async function writeScheduleFile(
  root: string,
  projectId: string,
  agentId: string,
  name: string,
  raw: string,
): Promise<void> {
  const dir = scheduleDir(root, projectId, agentId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.toml`), raw, "utf8");
}

/** Delete a schedule file; returns false if it doesn't exist. */
export async function deleteScheduleFile(
  root: string,
  projectId: string,
  agentId: string,
  name: string,
): Promise<boolean> {
  const file = path.join(scheduleDir(root, projectId, agentId), `${name}.toml`);
  try {
    await fs.unlink(file);
    return true;
  } catch {
    return false;
  }
}
