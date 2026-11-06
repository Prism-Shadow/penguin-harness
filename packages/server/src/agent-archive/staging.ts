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
import { THINKING_LEVEL_NAMES } from "@prismshadow/penguin-core";
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
 * Inflates one entry to `target`, counting what it writes: past the entry's declared size it
 * stops — which, with the declared sizes already held to the caps, bounds what an archive can
 * write in all — and an entry that ends short of its size or fails its CRC is refused.
 */
async function inflateEntry(
  upload: string,
  handle: FileHandle,
  entry: ZipDirectoryEntry,
  target: string,
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

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const APPROVAL_MODES = ["allow-all", "deny-all", "read-only", "always-ask"];
const CLIENTS = ["web", "cli", "org", "api", "workbench"];
/**
 * A title as long as this install writes one, generously: a company ticket's Session takes the
 * ticket's title (up to 200) and its number.
 */
const MAX_TITLE = 1000;
const MAX_TEXT = 4096;

const isTime = (value: unknown): value is string =>
  typeof value === "string" && ISO_TIME.test(value) && !Number.isNaN(Date.parse(value));

/**
 * One `sessions.json` row: its facts, or why they do not hold up (each field's type, enum,
 * length and date checked) — the Session is then skipped as `invalid`. Null when the row does not
 * even name a Session.
 */
function rowOf(raw: unknown): { facts: ArchivedSessionFacts; problem?: string } | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionId !== "string" || r.sessionId === "") return null;
  const text = (value: unknown, max: number): value is string =>
    typeof value === "string" && value.length <= max;
  const problems: Array<[boolean, string]> = [
    [SESSION_ID.test(r.sessionId), "sessionId is not a Session id"],
    [
      typeof r.files === "number" && Number.isInteger(r.files) && r.files >= 1 && r.files <= 999,
      "files is not 1 to 999",
    ],
    [isTime(r.createdAt), "createdAt is not an ISO time"],
    [isTime(r.lastActiveAt), "lastActiveAt is not an ISO time"],
    [r.title === null || text(r.title, MAX_TITLE), `title is not text of at most ${MAX_TITLE}`],
    [r.archivedAt === null || isTime(r.archivedAt), "archivedAt is not an ISO time"],
    [r.keptAt === null || isTime(r.keptAt), "keptAt is not an ISO time"],
    [APPROVAL_MODES.includes(r.approvalMode as string), "approvalMode is not an approval mode"],
    [
      r.thinkingLevel === null || THINKING_LEVEL_NAMES.includes(r.thinkingLevel as never),
      "thinkingLevel is not a thinking level",
    ],
    [CLIENTS.includes(r.client as string), "client is not a client"],
    [text(r.workspace, MAX_TEXT), "workspace is not a path"],
    [text(r.provider, 256) && text(r.modelId, 256), "provider or modelId is not a name"],
    [
      r.parentSessionId === undefined ||
        (typeof r.parentSessionId === "string" && SESSION_ID.test(r.parentSessionId)),
      "parentSessionId is not a Session id",
    ],
  ];
  const problem = problems.find(([ok]) => !ok)?.[1];
  const facts = {
    sessionId: r.sessionId,
    files: r.files,
    createdAt: r.createdAt,
    lastActiveAt: r.lastActiveAt,
    title: r.title,
    archivedAt: r.archivedAt,
    keptAt: r.keptAt,
    approvalMode: r.approvalMode,
    thinkingLevel: r.thinkingLevel,
    client: r.client,
    workspace: r.workspace,
    provider: r.provider,
    modelId: r.modelId,
    ...(typeof r.parentSessionId === "string" ? { parentSessionId: r.parentSessionId } : {}),
  } as ArchivedSessionFacts;
  return problem === undefined ? { facts } : { facts, problem: `Its row's ${problem}.` };
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
  // Every path staging writes, Trace files included, as a disk that folds names sees it.
  assertDistinct(
    [...placed.entries()].map(([entry]) => entry.name.slice(prefix.length)),
    prefix,
  );

  const handle = await fs.open(upload, "r");
  try {
    const manifestEntry = files.find((entry) => entry.name === `${prefix}${MANIFEST_FILE}`)!;
    if (manifestEntry.size > MAX_JSON_BYTES) throw badRequest("manifest.json is too large.");
    const manifestFile = path.join(extracted, MANIFEST_FILE);
    await inflateEntry(upload, handle, manifestEntry, manifestFile);
    const stateRels = [...placed.values()].flatMap((p) => (p.kind === "state" ? [p.rel] : []));
    const present = (dir: string): boolean => stateRels.some((rel) => rel.startsWith(`${dir}/`));
    const raw = await readJsonFile(manifestFile, "manifest.json");
    const manifest = parseManifest(raw, (part) =>
      part === "workbenchData"
        ? stateRels.some((rel) => /^workbenches\/[^/]+\/state\.json$/i.test(rel))
        : present(PART_DIRS[part]),
    );
    // A manifest that names its parts says whether Traces come; one that names none brings what
    // the zip holds.
    const takeTraces =
      (raw as { parts?: unknown }).parts === undefined || manifest.parts.traces.kind !== "none";

    const stateDir = path.join(extracted, "agent_state");
    const traceDir = path.join(extracted, "traces");
    const traceFiles = new Map<string, StagedTraceSession["files"]>();
    let sessionsFile: string | null = null;
    for (const [entry, placement] of placed) {
      if (placement.kind === "manifest") continue;
      if (placement.kind === "state") {
        if (!partAllows(manifest, placement.rel)) continue;
        await inflateEntry(upload, handle, entry, path.join(stateDir, ...placement.rel.split("/")));
      } else if (!takeTraces) {
        continue;
      } else if (placement.kind === "sessions") {
        if (entry.size > MAX_JSON_BYTES) throw badRequest("traces/sessions.json is too large.");
        sessionsFile = path.join(traceDir, SESSIONS_FILE);
        await inflateEntry(upload, handle, entry, sessionsFile);
      } else {
        const target = path.join(
          traceDir,
          placement.date,
          `${placement.sessionId}_${String(placement.index).padStart(3, "0")}.jsonl`,
        );
        await inflateEntry(upload, handle, entry, target);
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
      for (const raw of rows) {
        const row = rowOf(raw);
        if (row === null || listed.has(row.facts.sessionId)) continue;
        listed.add(row.facts.sessionId);
        sessions.push({
          facts: row.facts,
          files: traceFiles.get(row.facts.sessionId) ?? [],
          ...(row.problem !== undefined ? { problem: row.problem } : {}),
        });
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
