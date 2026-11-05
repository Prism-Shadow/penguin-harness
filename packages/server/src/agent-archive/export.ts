/**
 * The Agent archive's export half: what a zip with the chosen parts holds (`planArchive`, which
 * the preview reports and the download streams), and the zip itself, streamed entry by entry
 * from disk (`zipStream`) so nothing is buffered whole.
 *
 * The config always travels: `system_config.yaml` with every literal MCP credential blanked
 * (mcp-credentials.ts; named in `manifest.redacted`), `AGENTS.md` and
 * `tools/`. The vault never does; its key names go to `manifest.vaultKeys`. A part's directory
 * travels as it is on disk, minus what never travels in any package (agent-state-layout.ts) and,
 * for workbenches, the server's own files beside their source (`.build/`, `.harness/`,
 * `.plugin.json`, `node_modules/`) and their data unless it is selected. Only regular files
 * travel: a link is left out, so nothing outside the Agent State can leak through one. A name
 * this server's own import would refuse (one Windows cannot hold) is left out too.
 */
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { Zip, ZipDeflate } from "fflate";
import { agentDir, agentStateDir, buildInfo, loadAgentVault } from "@prismshadow/penguin-core";
import type {
  AgentArchiveManifest,
  AgentArchiveParts,
  AgentArchivePreview,
  AgentArchiveSessionRef,
} from "../api/types.js";
import { formatLocalDate } from "../internal/dates.js";
import { isGitEntry, isLeftOut } from "../services/agent-state-layout.js";
import { CONTROL_CHARACTER, isWindowsUnsafeSegment } from "../services/zip-entries.js";
import { migrateWorkbenches } from "../workbenches/migrate.js";
import { isWorkbenchId } from "../workbenches/store.js";
import { ARCHIVE_FORMAT, DIR_PARTS, MANIFEST_FILE, PART_DIRS, SESSIONS_FILE } from "./manifest.js";
import type { DirPart } from "./manifest.js";
import { redactSystemConfig } from "./mcp-credentials.js";
import { selectSessions } from "./traces.js";
import type { SelectedSession, TraceSelectionDeps } from "./traces.js";

/** The server's own files beside a workbench's source, at any depth inside its folder. */
const WORKBENCH_SERVER_DIRS = new Set([".build", ".harness", "node_modules"]);

/** One entry of the zip: a file read from disk up to `size` bytes, or bytes in hand. */
export interface ArchiveEntry {
  /** The path inside the zip, under the top-level `<agentId>/`. */
  name: string;
  source: { file: string } | { bytes: Uint8Array };
  size: number;
  mtime: Date;
}

export interface PlannedArchive {
  manifest: AgentArchiveManifest;
  /** `manifest.json` first. */
  entries: ArchiveEntry[];
  preview: AgentArchivePreview;
  /** `<agentId>-<yyyymmdd>.zip`, the local date of the export. */
  fileName: string;
}

export type ExportDeps = TraceSelectionDeps;

interface FoundFile {
  /** Relative to `agent_state/`, `/`-separated. */
  rel: string;
  abs: string;
  size: number;
  mtime: Date;
}

/** A path every disk this Agent State may travel to keeps as it is, so the import takes it. */
function isPortable(rel: string): boolean {
  return !CONTROL_CHARACTER.test(rel) && !rel.split("/").some(isWindowsUnsafeSegment);
}

/** Regular files under `abs`, depth first; `keep` prunes by the path relative to `agent_state/`. */
async function walk(
  abs: string,
  rel: string,
  keep: (rel: string, directory: boolean) => boolean,
  out: FoundFile[],
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return; // Absent (a part the Agent never had) or gone mid-walk: nothing of it travels.
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const childRel = `${rel}/${entry.name}`;
    const childAbs = path.join(abs, entry.name);
    if (isLeftOut(`agent_state/${childRel}`) || isGitEntry(childRel) || !isPortable(childRel)) {
      continue;
    }
    if (entry.isDirectory()) {
      if (keep(childRel, true)) await walk(childAbs, childRel, keep, out);
    } else if (entry.isFile() && keep(childRel, false)) {
      const stat = await fs.lstat(childAbs).catch(() => null);
      if (stat?.isFile())
        out.push({ rel: childRel, abs: childAbs, size: stat.size, mtime: stat.mtime });
    }
  }
}

/** Which paths of a part travel (`rel` is relative to `agent_state/`). */
function partFilter(
  part: DirPart,
  parts: AgentArchiveParts,
): (rel: string, dir: boolean) => boolean {
  if (part === "schedules") {
    // `schedule/<name>.toml` only: never the archive of expired schedules below it.
    return (rel, dir) => !dir && rel.split("/").length === 2 && rel.endsWith(".toml");
  }
  if (part !== "workbenches") return () => true;
  return (rel, dir) => {
    const [, id, ...inside] = rel.split("/");
    if (id === undefined || !isWorkbenchId(id)) return false;
    if (inside.length === 0) return dir;
    if (inside.some((segment) => WORKBENCH_SERVER_DIRS.has(segment))) return false;
    if (inside.length === 1 && !dir) {
      const name = inside[0]!.toLowerCase();
      if (name === ".plugin.json") return false;
      if (name === "state.json") return parts.workbenchData;
    }
    return true;
  };
}

function sessionRef(session: SelectedSession): AgentArchiveSessionRef {
  return {
    sessionId: session.facts.sessionId,
    title: session.facts.title,
    createdAt: session.facts.createdAt,
  };
}

const encoder = new TextEncoder();

/**
 * Everything an export with `parts` holds, read now: the manifest, the entries in zip order and
 * the counts the preview reports. Workbenches still in the layout before Agent State move in
 * first, so the archive has them.
 */
export async function planArchive(
  deps: ExportDeps,
  projectId: string,
  agentId: string,
  parts: AgentArchiveParts,
): Promise<PlannedArchive> {
  await migrateWorkbenches(agentDir(deps.root, projectId, agentId));
  const stateDir = agentStateDir(deps.root, projectId, agentId);
  const now = deps.now();
  const prefix = `${agentId}/`;
  const entries: ArchiveEntry[] = [];
  const fileEntry = (file: FoundFile): ArchiveEntry => ({
    name: `${prefix}agent_state/${file.rel}`,
    source: { file: file.abs },
    size: file.size,
    mtime: file.mtime,
  });

  // The config: always.
  const configFile = path.join(stateDir, "system_config.yaml");
  const [configText, configStat] = await Promise.all([
    fs.readFile(configFile, "utf8"),
    fs.stat(configFile),
  ]);
  const config = redactSystemConfig(configText);
  const configBytes = encoder.encode(config.text);
  entries.push({
    name: `${prefix}agent_state/system_config.yaml`,
    source: { bytes: configBytes },
    size: configBytes.byteLength,
    mtime: configStat.mtime,
  });
  const agentsMd = await fs.lstat(path.join(stateDir, "AGENTS.md")).catch(() => null);
  if (agentsMd?.isFile()) {
    entries.push(
      fileEntry({
        rel: "AGENTS.md",
        abs: path.join(stateDir, "AGENTS.md"),
        size: agentsMd.size,
        mtime: agentsMd.mtime,
      }),
    );
  }
  const tools: FoundFile[] = [];
  await walk(path.join(stateDir, "tools"), "tools", () => true, tools);
  entries.push(...tools.map(fileEntry));

  const preview: AgentArchivePreview = {
    parts: {
      skills: { files: 0, bytes: 0 },
      hooks: { files: 0, bytes: 0 },
      memory: { files: 0, bytes: 0 },
      workbenches: { files: 0, bytes: 0 },
      schedules: { files: 0, bytes: 0 },
    },
    traces: { sessions: 0, files: 0, bytes: 0, skipped: [], newest: null, oldest: null },
    totalBytes: 0,
    vaultKeys: [],
    redacted: config.redacted,
  };
  for (const part of DIR_PARTS) {
    if (!parts[part]) continue;
    const found: FoundFile[] = [];
    const dir = PART_DIRS[part];
    await walk(path.join(stateDir, dir), dir, partFilter(part, parts), found);
    preview.parts[part] = {
      files: found.length,
      bytes: found.reduce((sum, file) => sum + file.size, 0),
    };
    entries.push(...found.map(fileEntry));
  }

  const selected = await selectSessions(deps, projectId, agentId, parts.traces);
  if (parts.traces.kind !== "none") {
    const facts = encoder.encode(
      `${JSON.stringify(
        selected.sessions.map((s) => s.facts),
        null,
        2,
      )}\n`,
    );
    entries.push({
      name: `${prefix}traces/${SESSIONS_FILE}`,
      source: { bytes: facts },
      size: facts.byteLength,
      mtime: now,
    });
    for (const session of selected.sessions) {
      for (const file of session.files) {
        const base = `${session.facts.sessionId}_${String(file.index).padStart(3, "0")}.jsonl`;
        entries.push({
          name: `${prefix}traces/${file.date}/${base}`,
          source: { file: file.path },
          size: file.size,
          mtime: now,
        });
        preview.traces.files += 1;
        preview.traces.bytes += file.size;
      }
    }
    const topLevel = selected.sessions
      .filter((s) => s.facts.parentSessionId === undefined)
      .sort((a, b) => (a.facts.createdAt < b.facts.createdAt ? -1 : 1));
    preview.traces.sessions = selected.sessions.length;
    preview.traces.skipped = selected.skipped;
    preview.traces.oldest = topLevel.length > 0 ? sessionRef(topLevel[0]!) : null;
    preview.traces.newest = topLevel.length > 0 ? sessionRef(topLevel.at(-1)!) : null;
  }

  const vaultKeys = Object.keys(await loadAgentVault(deps.root, projectId, agentId)).sort();
  preview.vaultKeys = vaultKeys;
  const manifest: AgentArchiveManifest = {
    format: ARCHIVE_FORMAT,
    exportedAt: now.toISOString(),
    exportedBy: { penguinVersion: buildInfo().version },
    source: { projectId, agentId, version: config.version },
    agentId,
    ...(config.name !== undefined ? { name: config.name } : {}),
    ...(config.description !== undefined ? { description: config.description } : {}),
    parts,
    vaultKeys,
    redacted: config.redacted,
  };
  const manifestBytes = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  entries.unshift({
    name: `${prefix}${MANIFEST_FILE}`,
    source: { bytes: manifestBytes },
    size: manifestBytes.byteLength,
    mtime: now,
  });
  preview.totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  return {
    manifest,
    entries,
    preview,
    fileName: `${agentId}-${formatLocalDate(now).replaceAll("-", "")}.zip`,
  };
}

/** A zip records a DOS timestamp: 1980 to 2099, local time. */
function zipTime(date: Date): Date {
  const earliest = new Date(1980, 0, 1, 0, 0, 0);
  const latest = new Date(2099, 11, 31, 23, 59, 58);
  const t = date.getTime();
  if (Number.isNaN(t) || t < earliest.getTime()) return earliest;
  return t > latest.getTime() ? latest : date;
}

const READ_CHUNK = 64 * 1024;

/** One entry's deflate stream, stamped with its file's time. */
function deflated(entry: ArchiveEntry): ZipDeflate {
  const file = new ZipDeflate(entry.name, { level: 6 });
  file.mtime = zipTime(entry.mtime);
  return file;
}

/** The zip's bytes, entry after entry, each file read from disk as it is written. */
async function* zipChunks(entries: readonly ArchiveEntry[]): AsyncGenerator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, data) => {
    if (err !== null) failure = err;
    else if (data.byteLength > 0) queue.push(data);
  });
  /** What the zip has produced since the last call, in one new buffer. */
  const produced = (): Uint8Array | null => {
    if (failure !== null) throw failure;
    if (queue.length === 0) return null;
    const out = new Uint8Array(queue.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let at = 0;
    for (const chunk of queue) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    queue.length = 0;
    return out;
  };
  for (const entry of entries) {
    if ("bytes" in entry.source) {
      const file = deflated(entry);
      zip.add(file);
      file.push(entry.source.bytes, true);
    } else {
      let handle: FileHandle;
      try {
        handle = await fs.open(entry.source.file, "r");
      } catch (err) {
        // Listed a moment ago and gone by now (an Agent's edit, a Session deleted): left out.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      try {
        const file = deflated(entry);
        zip.add(file);
        // Up to the size listed: a Session still running exports the prefix written by then.
        let left = entry.size;
        while (left > 0) {
          const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK, left));
          const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
          if (bytesRead === 0) break;
          left -= bytesRead;
          file.push(chunk.subarray(0, bytesRead));
          const out = produced();
          if (out !== null) yield out;
        }
        file.push(new Uint8Array(0), true);
      } finally {
        await handle.close();
      }
    }
    const out = produced();
    if (out !== null) yield out;
  }
  zip.end();
  const out = produced();
  if (out !== null) yield out;
}

/**
 * The zip as a response body, pulled entry by entry: a slow reader holds the export at the entry
 * it is on rather than letting it buffer. A failure part-way (a disk error) ends the stream with
 * an error, which the client sees as a cut-off download, and is logged.
 */
export function zipStream(
  entries: readonly ArchiveEntry[],
  log: (line: string) => void,
): ReadableStream<Uint8Array> {
  const chunks = zipChunks(entries);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done === true) controller.close();
        else controller.enqueue(next.value);
      } catch (err) {
        log(`[agent-archive] export failed part-way: ${String(err)}`);
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
