/**
 * An Agent's export: a zip of its directory as it is on disk. `<agentId>/agent_state/…` is the
 * State less what a snapshot leaves out and the parts left out; `<agentId>/traces/<date>/…` is
 * every file of the chosen Sessions, a subagent Session following its parent. The vault never
 * travels, and a vault value of 8 characters or more in a Trace becomes `[vault:<KEY>]`. Only
 * regular files travel. Past the import's caps the export is 413 `archive_too_large`, so every
 * export imports.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import {
  agentStateDir,
  loadAgentVault,
  parseTraceLines,
  tracesDir,
} from "@prismshadow/penguin-core";
import type { AgentArchiveQuery } from "../api/types.js";
import { HttpError, badRequest } from "../http/errors.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { TraceIndex, TraceIndexStore } from "../mechanisms/traces.js";
import { STATE_FILE } from "../workbenches/store.js";
import { MAX_ENTRIES, MAX_PACKAGE_BYTES, MAX_UNPACKED_BYTES } from "./agent-zip.js";
import { isGitEntry, isLeftOut } from "./snapshot-service.js";

export interface AgentExportDeps {
  root: string;
  traceIndex: Pick<TraceIndex, "reconcileAgent">;
  traceStore: Pick<TraceIndexStore, "listFilesByAgent" | "listSessionsByAgent">;
  sessions: Pick<SessionIndex, "listByAgent">;
}

/** The State folder of each part; `workbenchData` is each workbench's `state.json`. */
const PART_DIRS: Record<string, string> = {
  skills: "skills",
  hooks: "hooks",
  memory: "memory",
  workbenches: "workbenches",
  schedules: "schedule",
};

const tooLarge = () =>
  new HttpError(
    413,
    "archive_too_large",
    `The export exceeds what an import takes (${MAX_ENTRIES} entries, 512MB unpacked, 64MB zipped).`,
  );

/** Each part's flag: `1` carried, `0` left out, absent its default (all but schedules). */
function partsOf(query: AgentArchiveQuery): Record<string, boolean> {
  return Object.fromEntries(
    [...Object.keys(PART_DIRS), "workbenchData"].map((name) => {
      const value = query[name as keyof AgentArchiveQuery];
      if (value !== undefined && value !== "0" && value !== "1") {
        throw badRequest(`${name} must be 0 or 1.`);
      }
      return [name, value === undefined ? name !== "schedules" : value === "1"];
    }),
  );
}

/** Whether a State path (below `agent_state/`) travels. */
function carried(parts: Record<string, boolean>, rel: string): boolean {
  if (isLeftOut(`agent_state/${rel}`) || isGitEntry(`agent_state/${rel}`)) return false;
  const [top, , file, ...rest] = rel.split("/");
  if (Object.keys(PART_DIRS).some((part) => PART_DIRS[part] === top && !parts[part])) return false;
  const data = top === "workbenches" && file?.toLowerCase() === STATE_FILE && rest.length === 0;
  return !data || parts.workbenchData!;
}

interface Candidate {
  sessionId: string;
  lastActive: string;
  files: { date: string; index: number }[];
}

/**
 * The Sessions `traces` picks: none, the last N parents by activity (a Session with no index row
 * counts as active on its newest date folder), or the parents with a date folder in the range;
 * with every Session of the Agent by id, for their subagent Sessions to follow.
 */
async function picked(
  deps: AgentExportDeps,
  projectId: string,
  agentId: string,
  traces: string | undefined,
): Promise<{ chosen: Candidate[]; all: Map<string, Candidate> }> {
  const all = new Map<string, Candidate>();
  if (traces === undefined || traces === "none") return { chosen: [], all };
  const last = /^last:(\d{1,3})$/.exec(traces);
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(traces);
  const count = Number(last?.[1]);
  if (!(count >= 1 && count <= 500) && !(range && range[1]! <= range[2]!)) {
    throw badRequest("traces must be none, last:<1-500> or <yyyy-mm-dd>..<yyyy-mm-dd>.");
  }
  await deps.traceIndex.reconcileAgent(projectId, agentId);
  const rows = new Map(deps.sessions.listByAgent(projectId, agentId).map((r) => [r.sessionId, r]));
  for (const f of deps.traceStore.listFilesByAgent(projectId, agentId)) {
    const s = all.get(f.sessionId) ?? {
      sessionId: f.sessionId,
      lastActive: rows.get(f.sessionId)?.lastActiveAt ?? "",
      files: [],
    };
    s.files.push({ date: f.date, index: f.fileIndex });
    if (!rows.has(f.sessionId) && f.date > s.lastActive) s.lastActive = f.date;
    all.set(f.sessionId, s);
  }
  const subagents = new Set(
    deps.traceStore
      .listSessionsByAgent(projectId, agentId)
      .filter((f) => f.source === "subagent")
      .map((f) => f.sessionId),
  );
  const parents = [...all.values()].filter((s) => !subagents.has(s.sessionId));
  const chosen = range
    ? parents.filter((s) => s.files.some((f) => f.date >= range[1]! && f.date <= range[2]!))
    : parents.sort((a, b) => (b.lastActive > a.lastActive ? 1 : -1)).slice(0, count);
  return { chosen, all };
}

export async function exportAgent(
  deps: AgentExportDeps,
  projectId: string,
  agentId: string,
  query: AgentArchiveQuery,
): Promise<Uint8Array> {
  const parts = partsOf(query);
  const { chosen, all } = await picked(deps, projectId, agentId, query.traces);
  const files: Record<string, Uint8Array> = {};
  let count = 0;
  let bytes = 0;
  const add = (name: string, data: Uint8Array) => {
    bytes += data.byteLength;
    if (++count > MAX_ENTRIES || bytes > MAX_UNPACKED_BYTES) throw tooLarge();
    files[`${agentId}/${name}`] = data;
  };

  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (!carried(parts, child)) continue;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), child);
      else if (entry.isFile())
        add(`agent_state/${child}`, await fs.readFile(path.join(dir, entry.name)));
    }
  };
  await walk(agentStateDir(deps.root, projectId, agentId), "");

  // Longest first, so a value holding another is replaced whole; each in its JSON spelling too.
  const vault = chosen.length > 0 ? await loadAgentVault(deps.root, projectId, agentId) : {};
  const secrets = Object.entries(vault)
    .filter(([, value]) => value.length >= 8)
    .flatMap(([key, value]) =>
      [value, JSON.stringify(value).slice(1, -1)].map((v): [string, string] => [v, key]),
    )
    .sort(([a], [b]) => b.length - a.length);
  const taken = new Set(chosen.map((s) => s.sessionId));
  for (let s = chosen.shift(); s !== undefined; s = chosen.shift()) {
    for (const { date, index } of s.files) {
      const name = `${s.sessionId}_${String(index).padStart(3, "0")}.jsonl`;
      let text = await fs.readFile(
        path.join(tracesDir(deps.root, projectId, agentId), date, name),
        "utf8",
      );
      for (const [value, key] of secrets) text = text.split(value).join(`[vault:${key}]`);
      add(`traces/${date}/${name}`, new TextEncoder().encode(text));
      for (const { payload } of parseTraceLines(text)) {
        const pointer = payload as { type?: unknown; session_id?: unknown };
        const child = pointer.type === "subagent" ? all.get(String(pointer.session_id)) : undefined;
        if (child !== undefined && !taken.has(child.sessionId)) {
          taken.add(child.sessionId);
          chosen.push(child);
        }
      }
    }
  }
  const zip = zipSync(files);
  if (zip.byteLength > MAX_PACKAGE_BYTES) throw tooLarge();
  return zip;
}
