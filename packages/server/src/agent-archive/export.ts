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
 * travel: a link is left out — a part's own directory too, when it is one (the preview notes
 * it) — so nothing outside the Agent State can leak through one. A name this server's own
 * import would refuse (one Windows cannot hold) is left out too. In the Trace files and the
 * Sessions' titles, the Agent's secret vault values are replaced (vault-scrub.ts) and counted in
 * `manifest.redacted`, which is why `manifest.json` is the zip's last entry.
 *
 * An export is bounded by what an import accepts: a selection past the import's entry cap, past
 * what it inflates, or holding a file past its per-entry cap is refused (413), and the preview
 * says so first.
 */
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { Zip, ZipDeflate } from "fflate";
import { agentDir, agentStateDir, buildInfo, loadAgentVault } from "@prismshadow/penguin-core";
import type {
  AgentArchiveNote,
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
import { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_INFLATED_BYTES } from "./limits.js";
import { redactSystemConfig } from "./mcp-credentials.js";
import { VaultScrub, scrubJson, vaultPatterns } from "./vault-scrub.js";
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
  /** A Trace file: the vault's values are taken out of it on the way. */
  trace?: true;
}

export interface PlannedArchive {
  /** Written last, once the Trace files' vault values are counted. */
  manifest: AgentArchiveManifest;
  /** Every entry but `manifest.json`, in zip order. */
  entries: ArchiveEntry[];
  /** The values `zipStream` takes out of the Trace files. */
  vault: Readonly<Record<string, string>>;
  /** Vault values already taken out of what is in hand (the Sessions' titles). */
  scrubbedInHand: number;
  preview: AgentArchivePreview;
  /** `<agentId>-<yyyymmdd>.zip`, the local date of the export. */
  fileName: string;
}

export interface ExportDeps extends TraceSelectionDeps {
  /** The import's caps the export is bounded by; the limits' own unless a caller says otherwise. */
  caps?: { entries?: number; inflated?: number; entry?: number };
}

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
  const notes: AgentArchiveNote[] = [];
  /** Whether `dir` (relative to `agent_state/`) is a real directory to walk; a link is noted. */
  const walkable = async (dir: string): Promise<boolean> => {
    const stat = await fs.lstat(path.join(stateDir, dir)).catch(() => null);
    if (stat === null || stat.isDirectory()) return stat !== null;
    if (stat.isSymbolicLink()) {
      notes.push({
        code: "link_skipped",
        subject: dir,
        message: `agent_state/${dir} is a link, so the export leaves it out.`,
      });
    }
    return false;
  };
  const tools: FoundFile[] = [];
  if (await walkable("tools")) await walk(path.join(stateDir, "tools"), "tools", () => true, tools);
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
    entries: 0,
    vaultKeys: [],
    redacted: config.redacted,
    notes,
  };
  for (const part of DIR_PARTS) {
    if (!parts[part]) continue;
    const found: FoundFile[] = [];
    const dir = PART_DIRS[part];
    if (await walkable(dir))
      await walk(path.join(stateDir, dir), dir, partFilter(part, parts), found);
    preview.parts[part] = {
      files: found.length,
      bytes: found.reduce((sum, file) => sum + file.size, 0),
    };
    entries.push(...found.map(fileEntry));
  }

  const vault = await loadAgentVault(deps.root, projectId, agentId);
  const patterns = vaultPatterns(vault);
  let scrubbedInHand = 0;
  const selected = await selectSessions(deps, projectId, agentId, parts.traces);
  if (parts.traces.kind !== "none") {
    // A title is the first prompt's, so a pasted value travels there too; the rest of a row
    // (the Session's id, its model, its Workspace) is how the import knows it, kept as it is.
    const rows = selected.sessions.map((s) => {
      if (patterns === null || typeof s.facts.title !== "string") return s.facts;
      const [title, count] = scrubJson(s.facts.title, patterns);
      scrubbedInHand += count;
      return { ...s.facts, title: title as string };
    });
    const facts = encoder.encode(`${JSON.stringify(rows, null, 2)}\n`);
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
          trace: true,
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

  const vaultKeys = Object.keys(vault).sort();
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
  const manifestBytes = manifestOf(manifest).byteLength;
  preview.entries = entries.length + 1;
  preview.totalBytes = entries.reduce((sum, entry) => sum + entry.size, manifestBytes);
  const caps = {
    entries: deps.caps?.entries ?? MAX_ENTRIES,
    inflated: deps.caps?.inflated ?? MAX_INFLATED_BYTES,
    entry: deps.caps?.entry ?? MAX_ENTRY_BYTES,
  };
  const oversized = entries.find((entry) => entry.size > caps.entry);
  if (preview.entries > caps.entries) {
    preview.refusal = { reason: "entries", limit: caps.entries };
  } else if (preview.totalBytes > caps.inflated) {
    preview.refusal = { reason: "inflated", limit: caps.inflated };
  } else if (oversized !== undefined) {
    preview.refusal = {
      reason: "entry",
      limit: caps.entry,
      subject: oversized.name.slice(prefix.length),
    };
  }
  return {
    manifest,
    entries,
    vault,
    scrubbedInHand,
    preview,
    fileName: `${agentId}-${formatLocalDate(now).replaceAll("-", "")}.zip`,
  };
}

function manifestOf(manifest: AgentArchiveManifest): Uint8Array {
  return encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
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
/** `O_NOFOLLOW` where the platform has it (Windows has none; its listing returns no link as a file). */
const NO_FOLLOW = fsConstants.O_NOFOLLOW ?? 0;

/** One entry's deflate stream, stamped with its file's time. */
function deflated(entry: ArchiveEntry): ZipDeflate {
  const file = new ZipDeflate(entry.name, { level: 6 });
  file.mtime = zipTime(entry.mtime);
  return file;
}

/**
 * The zip's bytes, entry after entry, each file read from disk as it is written and each Trace
 * file scrubbed of the vault's values on the way; `manifest.json` last, its `redacted` naming
 * how many values were taken out.
 */
async function* zipChunks(plan: PlannedArchive): AsyncGenerator<Uint8Array> {
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
  const patterns = vaultPatterns(plan.vault);
  let scrubbed = plan.scrubbedInHand;
  let unparsed = 0;
  for (const entry of plan.entries) {
    if ("bytes" in entry.source) {
      const file = deflated(entry);
      zip.add(file);
      file.push(entry.source.bytes, true);
    } else {
      let handle: FileHandle;
      try {
        // A link put where a listed file was is not followed.
        handle = await fs.open(entry.source.file, fsConstants.O_RDONLY | NO_FOLLOW);
      } catch (err) {
        // Listed a moment ago and gone by now (an Agent's edit, a Session deleted): left out.
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ELOOP") continue;
        throw err;
      }
      try {
        const file = deflated(entry);
        zip.add(file);
        const scrub = entry.trace === true && patterns !== null ? new VaultScrub(patterns) : null;
        // Up to the size listed: a Session still running exports the prefix written by then.
        let left = entry.size;
        while (left > 0) {
          const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK, left));
          const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, null);
          if (bytesRead === 0) break;
          left -= bytesRead;
          const read = chunk.subarray(0, bytesRead);
          file.push(scrub === null ? read : scrub.push(read));
          const out = produced();
          if (out !== null) yield out;
        }
        file.push(scrub === null ? new Uint8Array(0) : scrub.end(), true);
        scrubbed += scrub?.replaced ?? 0;
        unparsed += scrub?.unparsed ?? 0;
      } finally {
        await handle.close();
      }
    }
    const out = produced();
    if (out !== null) yield out;
  }
  const manifest: AgentArchiveManifest = {
    ...plan.manifest,
    redacted: [
      ...plan.manifest.redacted,
      ...(scrubbed > 0 ? [`traces:vault-values:${scrubbed}`] : []),
      // Lines that hold a value but do not parse were scrubbed as plain text: said, not hidden.
      ...(unparsed > 0 ? [`traces:unparsed-lines:${unparsed}`] : []),
    ],
  };
  const last = deflated({
    name: `${plan.manifest.agentId}/${MANIFEST_FILE}`,
    source: { bytes: new Uint8Array(0) },
    size: 0,
    mtime: new Date(plan.manifest.exportedAt),
  });
  zip.add(last);
  last.push(manifestOf(manifest), true);
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
  plan: PlannedArchive,
  log: (line: string) => void,
): ReadableStream<Uint8Array> {
  const chunks = zipChunks(plan);
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
