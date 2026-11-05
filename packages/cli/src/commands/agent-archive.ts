/**
 * `penguin agent export` and `penguin agent import`: an Agent as a zip, the file the Agents page's
 * export and import dialogs write and read (the server's api/types.ts, "Agent archive").
 *
 *   penguin agent export <agent-id> [--out <file|dir>] [--no-skills] [--no-hooks] [--no-memory]
 *                        [--no-workbenches] [--no-workbench-data] [--schedules]
 *                        [--traces none|last:<N>|<from>..<to>]
 *                        [--project-id <id>] [--json] [--server <url>]
 *   penguin agent import <file.zip|file.tar.gz|directory> [--agent-id <id>] [--overwrite]
 *                        [--project-id <id>] [--json] [--server <url>]
 *
 * `export` chooses the parts the way the export dialog does, with its defaults: the config always;
 * Skills, hooks, memory and workbenches with their data unless left out; schedules only when asked,
 * since they run on the install that imports them; no Traces unless `--traces` selects some. Every
 * part goes in the query explicitly. A malformed `--traces` is refused before any request. The
 * preview is asked first with the same parts: what the export leaves out (its notes, such as a
 * part whose folder is a link, and the Sessions with a file larger than an import accepts) goes to
 * stderr, and a selection the server would refuse stops there, before any download. The zip
 * streams to the path `--out` gives, under the name the server gives it.
 *
 * `import` uploads a zip or an old `.tar.gz` Agent State package as it is, or a folder laid out as
 * the zip — `manifest.json` at its root, the way the `agent-porting` Skill writes one — zipped here
 * in memory, so no `zip` binary is needed. Either is refused before anything is sent when it is
 * larger than an import accepts. `--overwrite` replaces an existing Agent's state (Project owners
 * only; the server writes a backup first). The text report says what was created or replaced, what
 * came along, which Sessions did not, what is left to fill in and the server's notes; `--json`
 * prints the server's response.
 * Docs: /docs/cli § "penguin agent export" and "penguin agent import".
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  AGENT_ARCHIVE_MAX_LAST_SESSIONS,
  AGENT_ARCHIVE_MAX_UPLOAD_BYTES,
} from "@prismshadow/penguin-server/api";
import type {
  AgentArchiveImportResponse,
  AgentArchivePreview,
} from "@prismshadow/penguin-server/api";
import { ApiError, resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import type { UploadBody } from "../client.js";
import type { Messages } from "../i18n.js";
import { zipFolder } from "../zip-folder.js";

const enc = encodeURIComponent;
const MiB = 1024 * 1024;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date written YYYY-MM-DD that exists (no 2026-02-30). */
function isDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * `--traces` as the server reads it: `none`, `last:<N>` with N from 1 to the server's cap, or `<from>..<to>`
 * with real dates and `from` on or before `to`. Answers the query value, or null for anything else.
 */
function traceSelection(raw: string): string | null {
  const value = raw.trim();
  if (value === "none") return value;
  const last = /^last:(\d+)$/.exec(value);
  if (last !== null) {
    const count = Number(last[1]);
    return count >= 1 && count <= AGENT_ARCHIVE_MAX_LAST_SESSIONS ? `last:${count}` : null;
  }
  const range = /^([^.]+)\.\.([^.]+)$/.exec(value);
  if (range === null) return null;
  const from = range[1]!;
  const to = range[2]!;
  return isDate(from) && isDate(to) && from <= to ? value : null;
}

interface ExportOpts {
  out?: string;
  /** Commander's `--no-*` flags: true unless left out. */
  skills: boolean;
  hooks: boolean;
  memory: boolean;
  workbenches: boolean;
  workbenchData: boolean;
  schedules?: boolean;
  traces?: string;
  projectId?: string;
  json?: boolean;
  server?: string;
}

interface ImportOpts {
  agentId?: string;
  overwrite?: boolean;
  projectId?: string;
  json?: boolean;
  server?: string;
}

/** The parts query both archive routes take, every part spelled out. */
function partsQuery(opts: ExportOpts, traces: string): string {
  const flag = (on: boolean) => (on ? "1" : "0");
  return new URLSearchParams({
    skills: flag(opts.skills),
    hooks: flag(opts.hooks),
    memory: flag(opts.memory),
    workbenches: flag(opts.workbenches),
    // A workbench's data means nothing without the workbench, as in the dialog.
    workbenchData: flag(opts.workbenches && opts.workbenchData),
    schedules: flag(opts.schedules === true),
    traces,
  }).toString();
}

/**
 * Where `--out` puts the zip: absent, the server's filename in the current directory; an existing
 * directory (or a path written with a trailing separator), that directory; anything else, a file
 * path whose parent is created.
 *
 * `name` comes from the server's Content-Disposition, so only its last segment is used — a server
 * answering `filename="../../.ssh/authorized_keys"` must not write outside `--out` — and `fallback`
 * stands in when nothing usable is left.
 */
async function resolveOutPath(
  out: string | undefined,
  name: string | null,
  fallback: string,
): Promise<string> {
  const base = name === null ? "" : path.basename(name);
  const fileName = base === "" || base === "." || base === ".." ? fallback : base;
  if (out === undefined || out === "") return path.resolve(fileName);
  const target = path.resolve(out);
  const isDir =
    out.endsWith("/") ||
    out.endsWith(path.sep) ||
    (await fs.promises.stat(target).then(
      (s) => s.isDirectory(),
      () => false,
    ));
  if (isDir) {
    await fs.promises.mkdir(target, { recursive: true });
    return path.join(target, fileName);
  }
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  return target;
}

/** A byte count as people read it: B, then KiB, MiB or GiB. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * What `import <path>` uploads: a folder holding `manifest.json`, zipped here; any other file as it
 * is, streamed from disk (the server tells a zip from a `.tar.gz` by its first bytes). Throws,
 * nothing sent, for a missing path, a folder without a manifest, or more than an import accepts.
 */
async function uploadBody(
  source: string,
  t: Messages,
  maxUploadBytes: number,
): Promise<UploadBody> {
  const stat = await fs.promises.stat(source).catch(() => null);
  if (stat === null) throw new Error(t.agent.importNotFound(source));
  const maxMib = maxUploadBytes / MiB;
  if (stat.isDirectory()) {
    const manifest = await fs.promises.stat(path.join(source, "manifest.json")).catch(() => null);
    if (manifest === null || !manifest.isFile()) throw new Error(t.agent.importNoManifest(source));
    const zip = await zipFolder(source, maxUploadBytes);
    if (zip === null) throw new Error(t.agent.importTooLarge(source, maxMib));
    return zip;
  }
  if (stat.size > maxUploadBytes) throw new Error(t.agent.importTooLarge(source, maxMib));
  return () => fs.createReadStream(source);
}

/** What `import` holds an upload to before sending it: the server's cap, unless a test lowers it. */
export interface ArchiveLimits {
  maxUploadBytes: number;
}

/** What an export leaves out, from its preview, as stderr lines (empty when nothing is left out). */
function exportWarnings(t: Messages, preview: AgentArchivePreview): string {
  const lines: string[] = [];
  const list = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(title, ...items.map((item) => `  - ${item}`));
  };
  list(
    t.agent.archiveNotesTitle(),
    preview.notes.map((note) => t.agent.archiveNote(note)),
  );
  list(
    t.agent.exportSkippedTitle(),
    preview.traces.skipped.map((s) => s.sessionId),
  );
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/** Why the server would refuse this export, in the CLI's words. */
function refusalMessage(t: Messages, refusal: NonNullable<AgentArchivePreview["refusal"]>): string {
  const limit = formatSize(refusal.limit);
  switch (refusal.reason) {
    case "entries":
      return t.agent.exportRefused.entries(refusal.limit);
    case "inflated":
      return t.agent.exportRefused.inflated(limit);
    case "entry":
      return t.agent.exportRefused.entry(refusal.subject, limit);
    default:
      // A reason from a newer server.
      return t.agent.exportRefused.other();
  }
}

/** The text report of an import: what was created or replaced, what came along, what did not. */
function importReport(t: Messages, projectId: string, res: AgentArchiveImportResponse): string {
  const lines = [
    res.mode === "created"
      ? t.agent.importCreated(res.agent.agentId, projectId, res.version)
      : t.agent.importOverwritten(res.agent.agentId, projectId, res.version, res.previousVersion),
  ];
  if (res.backup !== undefined) lines.push(t.agent.importBackup(res.backup));
  lines.push(t.agent.importCounts(res.imported));
  const list = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(title, ...items.map((item) => `  - ${item}`));
  };
  list(
    t.agent.importSkippedTitle(),
    res.skippedTraces.map((s) => {
      const reason = t.agent.importSkippedReason(s.reason);
      return `${s.sessionId} (${s.detail !== undefined ? `${reason}: ${s.detail}` : reason})`;
    }),
  );
  list(t.agent.importToFillTitle(), res.toFill);
  list(
    t.agent.archiveNotesTitle(),
    res.notes.map((note) => t.agent.archiveNote(note)),
  );
  return `${lines.join("\n")}\n`;
}

export function registerArchiveCommands(
  agent: Command,
  t: Messages,
  limits: ArchiveLimits = { maxUploadBytes: AGENT_ARCHIVE_MAX_UPLOAD_BYTES },
): void {
  agent
    .command("export <agent-id>")
    .description(t.agent.exportDesc)
    .option("--out <path>", t.agent.exportOut)
    .option("--no-skills", t.agent.exportNoSkills)
    .option("--no-hooks", t.agent.exportNoHooks)
    .option("--no-memory", t.agent.exportNoMemory)
    .option("--no-workbenches", t.agent.exportNoWorkbenches)
    .option("--no-workbench-data", t.agent.exportNoWorkbenchData)
    .option("--schedules", t.agent.exportSchedules)
    .option("--traces <selection>", t.agent.exportTraces(AGENT_ARCHIVE_MAX_LAST_SESSIONS))
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (agentIdArg: string, opts: ExportOpts) => {
      const traces = opts.traces === undefined ? "none" : traceSelection(opts.traces);
      if (traces === null)
        throw new Error(
          t.agent.exportTracesInvalid(String(opts.traces), AGENT_ARCHIVE_MAX_LAST_SESSIONS),
        );
      const agentId = agentIdArg.trim();
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const archive = `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/archive`;
      const query = partsQuery(opts, traces);
      const preview = await client.request<AgentArchivePreview>(
        "GET",
        `${archive}/preview?${query}`,
      );
      const warnings = exportWarnings(t, preview);
      if (warnings !== "") process.stderr.write(warnings);
      if (preview.refusal !== undefined) throw new Error(refusalMessage(t, preview.refusal));
      const { file, bytes } = await client.download(`${archive}?${query}`, (name) =>
        resolveOutPath(opts.out, name, `${agentId}.zip`),
      );
      if (opts.json === true) {
        const notes = preview.notes;
        process.stdout.write(`${JSON.stringify({ agentId, projectId, file, bytes, notes })}\n`);
        return;
      }
      process.stdout.write(`${t.agent.exported(agentId, file, formatSize(bytes))}\n`);
    });

  agent
    .command("import <path>")
    .description(t.agent.importDesc)
    .option("--agent-id <id>", t.agent.importAgentId)
    .option("--overwrite", t.agent.importOverwrite)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (input: string, opts: ImportOpts) => {
      const body = await uploadBody(path.resolve(input), t, limits.maxUploadBytes);
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const query = new URLSearchParams();
      if (opts.agentId !== undefined) query.set("agentId", String(opts.agentId).trim());
      if (opts.overwrite === true) query.set("overwrite", "1");
      const search = query.toString();
      let res: AgentArchiveImportResponse;
      try {
        res = await client.upload<AgentArchiveImportResponse>(
          "POST",
          `/api/projects/${enc(projectId)}/agents/import${search === "" ? "" : `?${search}`}`,
          body,
        );
      } catch (err) {
        if (err instanceof ApiError && err.code === "agent_exists") {
          throw new Error(`${err.message}\n${t.agent.importExistsHint()}`);
        }
        throw err;
      }
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      process.stdout.write(importReport(t, projectId, res));
    });
}
