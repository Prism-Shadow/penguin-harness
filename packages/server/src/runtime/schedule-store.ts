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
import { atomicWriteFile, resolveModelRef, scheduleDir } from "@prismshadow/penguin-core";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import { cacheable, statMtime } from "../internal/mtime-gate.js";
import {
  parseScheduleFile,
  type ScheduleDefinition,
  type ScheduleParseResult,
} from "./schedule-file.js";

export interface ScheduleFileEntry {
  name: string;
  raw: string;
  parsed: ScheduleParseResult;
}

/** One cached schedule file: its parsed entry plus the stat the parse is valid for. */
interface CachedScheduleFile {
  /** Gate-cacheable mtime (a fresh mtime is stored as a never-matching sentinel). */
  mtimeMs: number;
  sizeBytes: number;
  entry: ScheduleFileEntry;
}

/** One Agent's cached schedule dir: last seen dir mtime (null = did not exist) + files in listing order. */
interface CachedScheduleDir {
  mtimeMs: number | null;
  files: Map<string, CachedScheduleFile>;
}

/**
 * mtime-gated schedule-dir scans (the trace-index house pattern: disk stays the
 * single source of truth, mtime is the change signal, fresh mtimes are never cached
 * as clean, single-flight per Agent). The scheduler tick and the schedules routes
 * both list through here, so the steady state costs stats instead of a full
 * readdir + readFile + TOML parse of every file every 30s:
 *
 * - Unchanged dir mtime → the name set is intact (create/delete/rename all move it);
 *   one stat per known file then catches in-place edits (a content write moves only
 *   the FILE's mtime, never the dir's). No readdir, no reads.
 * - Changed dir mtime / first look / `force` → one readdir, then re-read only the
 *   files whose mtime/size moved; unchanged files reuse their cached parse.
 * - Missing dir → cached as such; a later create is caught by the same stat.
 *
 * Manual edits are picked up by the next pass because every variant moves an mtime
 * this gate stats; the routes' write paths additionally force/invalidate for
 * immediate effect (see Scheduler.reconcileAgent / dropEntry).
 */
export class ScheduleFileCache {
  private readonly seen = new Map<string, CachedScheduleDir>();
  private readonly inflight = new Map<string, Promise<ScheduleFileEntry[]>>();
  /** Test observability: gateStats = dir stat calls; dirScans = readdir passes; fileReads = schedule-file content reads. */
  readonly counters = { gateStats: 0, dirScans: 0, fileReads: 0 };

  constructor(private readonly root: string) {}

  private keyOf(projectId: string, agentId: string): string {
    return `${projectId}\0${agentId}`;
  }

  /**
   * Lists this Agent's schedule files (a missing directory is treated as empty).
   * `force` ignores the dir-mtime gate (write paths' immediate-effect entry); a
   * forced call issued while a scan is in flight chains a fresh pass behind it.
   * The returned entries are shared with the cache — callers must not mutate them.
   */
  list(
    projectId: string,
    agentId: string,
    opts: { force?: boolean } = {},
  ): Promise<ScheduleFileEntry[]> {
    const key = this.keyOf(projectId, agentId);
    const existing = this.inflight.get(key);
    if (existing) {
      return opts.force === true
        ? existing.then(() => this.list(projectId, agentId, opts))
        : existing;
    }
    const run = this.scan(projectId, agentId, opts.force === true).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  /** Write-time invalidation (route delete path): the next list re-scans regardless of mtimes. */
  invalidate(projectId: string, agentId: string): void {
    this.seen.delete(this.keyOf(projectId, agentId));
  }

  /** Drops every cached Agent of the Projects NOT in `live` (deleted Projects stop being ticked, so sweep here). */
  retainProjects(live: ReadonlySet<string>): void {
    for (const key of this.seen.keys()) {
      if (!live.has(key.slice(0, key.indexOf("\0")))) this.seen.delete(key);
    }
  }

  private async scan(
    projectId: string,
    agentId: string,
    force: boolean,
  ): Promise<ScheduleFileEntry[]> {
    const key = this.keyOf(projectId, agentId);
    const dir = scheduleDir(this.root, projectId, agentId);
    const cached = this.seen.get(key);
    this.counters.gateStats += 1;
    const dirMtime = await statMtime(dir);
    if (dirMtime === null) {
      this.seen.set(key, { mtimeMs: null, files: new Map() });
      return [];
    }
    const next: CachedScheduleDir = { mtimeMs: cacheable(dirMtime), files: new Map() };
    let names: string[];
    if (!force && cached !== undefined && cached.mtimeMs !== null && cached.mtimeMs === dirMtime) {
      // Same dir mtime (sentinels never match): the name set is unchanged; only
      // in-place content edits are possible, and the per-file stats below catch those.
      next.mtimeMs = cached.mtimeMs;
      names = [...cached.files.keys()];
    } else {
      this.counters.dirScans += 1;
      let listing: string[];
      try {
        listing = await fs.readdir(dir);
      } catch {
        // Deleted between stat and readdir: treat as missing; a later pass settles it.
        this.seen.set(key, { mtimeMs: null, files: new Map() });
        return [];
      }
      // Sort the full file names before stripping the suffix — the pre-existing listing order.
      names = listing
        .sort()
        .filter((f) => f.endsWith(".toml"))
        .map((f) => f.slice(0, -".toml".length));
    }
    const entries: ScheduleFileEntry[] = [];
    for (const name of names) {
      const file = await this.revalidate(dir, name, cached?.files.get(name));
      if (file === null) continue; // Deleted during reconciliation: revisit next round.
      next.files.set(name, file);
      entries.push(file.entry);
    }
    this.seen.set(key, next);
    return entries;
  }

  /** Reuses the cached parse while the file's stat still matches; re-reads otherwise. */
  private async revalidate(
    dir: string,
    name: string,
    cached: CachedScheduleFile | undefined,
  ): Promise<CachedScheduleFile | null> {
    const file = path.join(dir, `${name}.toml`);
    let stat: { mtimeMs: number; size: number };
    try {
      stat = await fs.stat(file);
    } catch {
      return null;
    }
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.size) return cached;
    this.counters.fileReads += 1;
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return null;
    }
    return {
      mtimeMs: cacheable(stat.mtimeMs),
      sizeBytes: stat.size,
      entry: { name, raw, parsed: parseScheduleFile(name, raw) },
    };
  }
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

/** Project-config source for model-ref validation (ProjectConfigService: same semantics as core's loadProjectConfig, served from its mtime-gated cache). */
export interface ScheduleConfigSource {
  loadConfig(projectId: string): Promise<ProjectConfig>;
}

/**
 * Config check for a schedule's model reference (shared by save and reconciliation):
 * the reference is a complete `(provider, model_id)` pair and must name an entry in the
 * Project config — nothing is inferred, so a pair that matches no entry is simply an
 * error. Returns an error message (no such model / half a reference / config read
 * failure), or null when the pair is configured (or there is no model reference at all).
 */
export async function validateScheduleModelRef(
  configs: ScheduleConfigSource,
  projectId: string,
  def: Pick<ScheduleDefinition, "modelId" | "provider">,
): Promise<string | null> {
  if (def.modelId === undefined && def.provider === undefined) return null;
  // parseScheduleFile already rejects half a reference, so this only guards callers that
  // build a definition by hand — the missing half is reported, never guessed.
  if (def.modelId === undefined || def.provider === undefined) {
    return "provider and model_id must be given together (a model reference is always a pair); omit both to use the Project's default model";
  }
  try {
    const cfg = await configs.loadConfig(projectId);
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
  await atomicWriteFile(path.join(dir, `${name}.toml`), raw, { followSymlinks: true });
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
