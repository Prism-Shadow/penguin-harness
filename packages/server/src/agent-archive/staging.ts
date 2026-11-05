/**
 * An uploaded Agent archive zip, checked and written out into a staging folder: what the import
 * then turns into an Agent. Nothing here touches an Agent.
 *
 * Everything is decided from the central directory before a byte is inflated: the entry count,
 * every declared size against the caps, every name (no absolute path, backslash, `..`, control
 * character or name Windows cannot hold; no two names a case-folding disk takes for one; no link
 * or other special entry), and the layout (`manifest.json` at the root or in exactly one
 * top-level directory). Then each kept entry is inflated straight to disk with a byte counter
 * that stops it past its declared size or past the total cap, and its CRC is checked.
 *
 * Kept: `manifest.json`, `agent_state/**` (minus what never travels — the vault, staging
 * leftovers, a `.git` path segment, a workbench's `.build/` and `node_modules/` — and the
 * directory of any part the manifest marks false, the expired schedules, and a workbench's data
 * unless the manifest carries it), and `traces/sessions.json` with the `traces/<date>/<id>_NNN.jsonl`
 * files. Anything else in the zip is ignored.
 */
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import type { AgentArchiveManifest, ArchivedSessionFacts } from "../api/types.js";
import { HttpError, badRequest } from "../http/errors.js";
import { isGitEntry, isLeftOut } from "../services/agent-state-layout.js";
import { assertSafeEntryPath } from "../services/skill-import-limits.js";
import type { StagedTraceSession } from "../services/trace-service.js";
import {
  CONTROL_CHARACTER,
  assertDistinct,
  entryDataOffset,
  isWindowsUnsafeSegment,
  readZipDirectory,
} from "../services/zip-entries.js";
import type { ZipDirectoryEntry } from "../services/zip-entries.js";
import { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_INFLATED_BYTES, archiveTooLarge } from "./limits.js";
import { DIR_PARTS, MANIFEST_FILE, PART_DIRS, SESSIONS_FILE, parseManifest } from "./manifest.js";

/** An archive written out to staging, whichever format it came in. */
export interface StagedArchive {
  manifest: AgentArchiveManifest;
  /** The archive's one top-level directory, when it has one: the id an import falls back to. */
  topDir: string | null;
  /** The staged `agent_state/` (absent on disk for a zip that carries only a definition). */
  stateDir: string;
  /** Whether `agent_state/system_config.yaml` came with the archive. */
  hasConfig: boolean;
  /** The Sessions `traces/sessions.json` lists, each with its staged files. */
  sessions: StagedTraceSession[];
}

/** The manifest and the sessions list are read into memory; bigger than this, they are not ours. */
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const TRACE_FILE = /^traces\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9_-]{1,128})_(\d{3})\.jsonl$/;

/** Where an entry lands under the staging folder, or null when the import does not take it. */
type Placement =
  | { kind: "manifest" }
  | { kind: "sessions" }
  | { kind: "state"; rel: string }
  | { kind: "trace"; date: string; sessionId: string; index: number };

function placementOf(rel: string): Placement | null {
  if (rel === MANIFEST_FILE) return { kind: "manifest" };
  if (rel === `traces/${SESSIONS_FILE}`) return { kind: "sessions" };
  const trace = TRACE_FILE.exec(rel);
  if (trace !== null) {
    return { kind: "trace", date: trace[1]!, sessionId: trace[2]!, index: Number(trace[3]) };
  }
  if (rel.startsWith("agent_state/") && !isLeftOut(rel) && !isGitEntry(rel)) {
    return { kind: "state", rel: rel.slice("agent_state/".length) };
  }
  return null;
}

/** Whether the manifest's parts let a path under `agent_state/` in. */
function partAllows(manifest: AgentArchiveManifest, rel: string): boolean {
  const [top, second, ...rest] = rel.split("/");
  for (const part of DIR_PARTS) {
    if (top !== PART_DIRS[part]) continue;
    if (!manifest.parts[part]) return false;
    if (part === "schedules")
      return rest.length === 0 && second !== undefined && second.endsWith(".toml");
    if (part === "workbenches" && rest.length === 1) {
      const name = rest[0]!.toLowerCase();
      if (name === ".plugin.json") return false;
      if (name === "state.json") return manifest.parts.workbenchData;
    }
    if (part === "workbenches") {
      return !rest.some((s) => s === ".build" || s === ".harness" || s === "node_modules");
    }
    return true;
  }
  return true;
}

/**
 * Inflates one entry to `target`, counting what it writes: past the entry's declared size or the
 * archive's running total it stops, and an entry that ends short of its size or fails its CRC
 * is refused.
 */
async function inflateEntry(
  upload: string,
  handle: FileHandle,
  entry: ZipDirectoryEntry,
  target: string,
  budget: { left: number },
): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (entry.compressedSize === 0) {
    if (entry.size !== 0) throw badRequest(`Zip entry is damaged: ${entry.name}`);
    await fs.writeFile(target, "");
    return;
  }
  const start = await entryDataOffset(handle, entry);
  let written = 0;
  let crc = 0;
  const count = async function* (source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      written += chunk.byteLength;
      if (written > entry.size)
        throw badRequest(`Zip entry is larger than it declares: ${entry.name}`);
      budget.left -= chunk.byteLength;
      if (budget.left < 0) throw archiveTooLarge("The archive inflates past the 1GiB limit.");
      crc = zlib.crc32(chunk, crc);
      yield chunk;
    }
  };
  const read = createReadStream(upload, { start, end: start + entry.compressedSize - 1 });
  try {
    if (entry.method === 8) {
      await pipeline(read, zlib.createInflateRaw(), count, createWriteStream(target));
    } else {
      await pipeline(read, count, createWriteStream(target));
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badRequest(`Zip entry is damaged: ${entry.name}`);
  }
  if (written !== entry.size || crc !== entry.crc32) {
    throw badRequest(`Zip entry is damaged: ${entry.name}`);
  }
}

async function readJsonFile(file: string, what: string): Promise<unknown> {
  try {
    return JSON.parse((await fs.readFile(file, "utf8")).replace(/^﻿/, ""));
  } catch {
    throw badRequest(`${what} is not valid JSON.`);
  }
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** One `sessions.json` row as the facts type, or null when it does not name a Session. */
function factsOf(raw: unknown): ArchivedSessionFacts | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || r.sessionId === "") return null;
  return {
    sessionId: r.sessionId,
    files: typeof r.files === "number" && Number.isInteger(r.files) ? r.files : 0,
    createdAt: str(r.createdAt),
    lastActiveAt: str(r.lastActiveAt),
    title: strOrNull(r.title),
    archivedAt: strOrNull(r.archivedAt),
    keptAt: strOrNull(r.keptAt),
    approvalMode: str(r.approvalMode) as ArchivedSessionFacts["approvalMode"],
    thinkingLevel: strOrNull(r.thinkingLevel) as ArchivedSessionFacts["thinkingLevel"],
    client: str(r.client),
    workspace: str(r.workspace),
    provider: str(r.provider),
    modelId: str(r.modelId),
    ...(typeof r.parentSessionId === "string" ? { parentSessionId: r.parentSessionId } : {}),
  };
}

/** Checks the zip at `upload` and writes what the import takes into `extracted/`. */
export async function stageZip(upload: string, extracted: string): Promise<StagedArchive> {
  const directory = await readZipDirectory(upload, {
    maxEntries: MAX_ENTRIES,
    tooLarge: archiveTooLarge,
  });
  let declared = 0;
  for (const entry of directory) {
    assertSafeEntryPath(entry.name);
    if (CONTROL_CHARACTER.test(entry.name)) {
      throw badRequest(`Invalid zip entry path (control character): ${JSON.stringify(entry.name)}`);
    }
    if (entry.special) {
      throw badRequest(
        `An Agent archive holds regular files only; this entry is a link: ${entry.name}`,
      );
    }
    if (entry.size > MAX_ENTRY_BYTES) {
      throw archiveTooLarge(`Zip entry exceeds the 256MiB limit: ${entry.name}`);
    }
    declared += entry.size;
    if (declared > MAX_INFLATED_BYTES) {
      throw archiveTooLarge("The archive declares more than the 1GiB limit.");
    }
  }
  // macOS's Archive Utility adds `__MACOSX/` (resource forks) beside the folder it zipped.
  const files = directory.filter(
    (entry) => !entry.name.endsWith("/") && !entry.name.startsWith("__MACOSX/"),
  );
  const names = files.map((entry) => entry.name);
  let prefix = "";
  let topDir: string | null = null;
  if (!names.includes(MANIFEST_FILE)) {
    const tops = new Set(names.map((name) => name.split("/", 1)[0]!));
    const only = tops.size === 1 ? [...tops][0]! : undefined;
    if (only === undefined || !names.includes(`${only}/${MANIFEST_FILE}`)) {
      throw badRequest(
        "The zip must contain manifest.json at its root, or exactly one top-level directory containing it.",
      );
    }
    prefix = `${only}/`;
    topDir = only;
  }

  const placed = new Map<ZipDirectoryEntry, Placement>();
  for (const entry of files) {
    const placement = placementOf(entry.name.slice(prefix.length));
    if (placement === null) continue;
    if (placement.kind === "state" && placement.rel.split("/").some(isWindowsUnsafeSegment)) {
      throw badRequest(`Zip entry has a name Windows cannot hold: ${entry.name}`);
    }
    placed.set(entry, placement);
  }
  assertDistinct(
    [...placed.values()].flatMap((p) => (p.kind === "state" ? [p.rel] : [])),
    `${prefix}agent_state/`,
  );

  const handle = await fs.open(upload, "r");
  try {
    const budget = { left: MAX_INFLATED_BYTES };
    const manifestEntry = files.find((entry) => entry.name === `${prefix}${MANIFEST_FILE}`)!;
    if (manifestEntry.size > MAX_JSON_BYTES) throw badRequest("manifest.json is too large.");
    const manifestFile = path.join(extracted, MANIFEST_FILE);
    await inflateEntry(upload, handle, manifestEntry, manifestFile, budget);
    const stateRels = [...placed.values()].flatMap((p) => (p.kind === "state" ? [p.rel] : []));
    const present = (dir: string): boolean => stateRels.some((rel) => rel.startsWith(`${dir}/`));
    const manifest = parseManifest(await readJsonFile(manifestFile, "manifest.json"), (part) =>
      part === "workbenchData"
        ? stateRels.some((rel) => /^workbenches\/[^/]+\/state\.json$/i.test(rel))
        : present(PART_DIRS[part]),
    );

    const stateDir = path.join(extracted, "agent_state");
    const traceDir = path.join(extracted, "traces");
    const traceFiles = new Map<string, StagedTraceSession["files"]>();
    let sessionsFile: string | null = null;
    for (const [entry, placement] of placed) {
      if (placement.kind === "manifest") continue;
      if (placement.kind === "state") {
        if (!partAllows(manifest, placement.rel)) continue;
        await inflateEntry(
          upload,
          handle,
          entry,
          path.join(stateDir, ...placement.rel.split("/")),
          budget,
        );
      } else if (placement.kind === "sessions") {
        if (entry.size > MAX_JSON_BYTES) throw badRequest("traces/sessions.json is too large.");
        sessionsFile = path.join(traceDir, SESSIONS_FILE);
        await inflateEntry(upload, handle, entry, sessionsFile, budget);
      } else {
        const target = path.join(
          traceDir,
          placement.date,
          `${placement.sessionId}_${String(placement.index).padStart(3, "0")}.jsonl`,
        );
        await inflateEntry(upload, handle, entry, target, budget);
        const list = traceFiles.get(placement.sessionId) ?? [];
        list.push({ index: placement.index, date: placement.date, path: target });
        traceFiles.set(placement.sessionId, list);
      }
    }

    const sessions: StagedTraceSession[] = [];
    if (sessionsFile !== null) {
      const rows = await readJsonFile(sessionsFile, "traces/sessions.json");
      if (!Array.isArray(rows)) throw badRequest("traces/sessions.json must be an array.");
      const listed = new Set<string>();
      for (const row of rows) {
        const facts = factsOf(row);
        if (facts === null || listed.has(facts.sessionId)) continue;
        listed.add(facts.sessionId);
        sessions.push({ facts, files: traceFiles.get(facts.sessionId) ?? [] });
      }
    }
    const hasConfig = await fs
      .lstat(path.join(stateDir, "system_config.yaml"))
      .then((stat) => stat.isFile())
      .catch(() => false);
    return { manifest, topDir, stateDir, hasConfig, sessions };
  } finally {
    await handle.close();
  }
}
