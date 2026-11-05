/**
 * The Agent archive's own vocabulary: the format name, the parts query both export routes take,
 * and the `manifest.json` an import reads (api/types.ts, "Agent archive", has the layout).
 *
 * The query is the contract the export dialog and `penguin agent export` share, so an absent key
 * always means the dialog's default and a malformed one is a 400, never a silent default.
 */
import { THINKING_LEVEL_NAMES } from "@prismshadow/penguin-core";
import type { MCPServerConfig, ThinkingLevelName } from "@prismshadow/penguin-core";
import type {
  AgentArchiveDefinition,
  AgentArchiveManifest,
  AgentArchiveParts,
  TraceSelection,
} from "../api/types.js";
import { badRequest } from "../http/errors.js";
import { MAX_LAST_SESSIONS } from "./limits.js";

export const ARCHIVE_FORMAT = "penguin-agent-zip/1";
export const MANIFEST_FILE = "manifest.json";
/** `traces/sessions.json`: the sessions-table facts of every Session the zip carries. */
export const SESSIONS_FILE = "sessions.json";

/** The export dialog's defaults: everything but schedules and Traces. */
export const DEFAULT_PARTS: AgentArchiveParts = {
  skills: true,
  hooks: true,
  memory: true,
  workbenches: true,
  workbenchData: true,
  schedules: false,
  traces: { kind: "none" },
};

/** The parts whose directory lives directly under `agent_state/`, by part. */
export const PART_DIRS = {
  skills: "skills",
  hooks: "hooks",
  memory: "memory",
  workbenches: "workbenches",
  schedules: "schedule",
} as const;

export type DirPart = keyof typeof PART_DIRS;
export const DIR_PARTS = Object.keys(PART_DIRS) as DirPart[];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date as written in a Trace's date directory, and one that exists. */
export function isLocalDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `none`, `last:<N>` or `<from>..<to>`; anything else is a 400 naming the accepted forms. */
export function parseTraceSelection(raw: string): TraceSelection {
  if (raw === "none") return { kind: "none" };
  const last = /^last:(\d{1,4})$/.exec(raw);
  if (last !== null) {
    const count = Number(last[1]);
    if (count < 1 || count > MAX_LAST_SESSIONS) {
      throw badRequest(`traces=last:<N> takes 1 to ${MAX_LAST_SESSIONS} Sessions.`);
    }
    return { kind: "last", count };
  }
  const range = /^([^.]+)\.\.([^.]+)$/.exec(raw);
  if (range !== null && isLocalDate(range[1]!) && isLocalDate(range[2]!)) {
    if (range[1]! > range[2]!) throw badRequest("traces=<from>..<to> needs from on or before to.");
    return { kind: "range", from: range[1]!, to: range[2]! };
  }
  throw badRequest("traces must be none, last:<N> or <from>..<to> (dates as YYYY-MM-DD).");
}

/** The parts a request names, each absent key at the dialog's default. */
export function partsFromQuery(query: (name: string) => string | undefined): AgentArchiveParts {
  const flag = (name: keyof Omit<AgentArchiveParts, "traces">): boolean => {
    const raw = query(name);
    if (raw === undefined) return DEFAULT_PARTS[name];
    if (raw === "1") return true;
    if (raw === "0") return false;
    throw badRequest(`${name} must be 0 or 1.`);
  };
  const traces = query("traces");
  return {
    skills: flag("skills"),
    hooks: flag("hooks"),
    memory: flag("memory"),
    workbenches: flag("workbenches"),
    workbenchData: flag("workbenchData"),
    schedules: flag("schedules"),
    traces: traces === undefined ? DEFAULT_PARTS.traces : parseTraceSelection(traces),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(r: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = r[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw badRequest(`manifest.json: ${key} must be a string of at most ${max} characters.`);
  }
  return value;
}

function stringList(r: Record<string, unknown>, key: string): string[] {
  const value = r[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw badRequest(`manifest.json: ${key} must be an array of strings.`);
  }
  return value as string[];
}

/** `manifest.parts` as written, every flag a boolean and the selection one of the three kinds. */
function partsOf(raw: unknown): AgentArchiveParts {
  const r = asRecord(raw);
  if (r === null) throw badRequest("manifest.json: parts must be an object.");
  const flag = (key: keyof Omit<AgentArchiveParts, "traces">): boolean => {
    const value = r[key] ?? false;
    if (typeof value !== "boolean")
      throw badRequest(`manifest.json: parts.${key} must be a boolean.`);
    return value;
  };
  const traces = asRecord(r.traces);
  let selection: TraceSelection = { kind: "none" };
  if (traces?.kind === "last" && typeof traces.count === "number") {
    selection = { kind: "last", count: traces.count };
  } else if (
    traces?.kind === "range" &&
    typeof traces.from === "string" &&
    typeof traces.to === "string"
  ) {
    selection = { kind: "range", from: traces.from, to: traces.to };
  } else if (r.traces !== undefined && traces?.kind !== "none") {
    throw badRequest("manifest.json: parts.traces must be none, last or range.");
  }
  return {
    skills: flag("skills"),
    hooks: flag("hooks"),
    memory: flag("memory"),
    workbenches: flag("workbenches"),
    workbenchData: flag("workbenchData"),
    schedules: flag("schedules"),
    traces: selection,
  };
}

/** Shape-checks `definition`; the config service validates the values when it applies them. */
function definitionOf(raw: unknown): AgentArchiveDefinition {
  const r = asRecord(raw);
  if (r === null) throw badRequest("manifest.json: definition must be an object.");
  const out: AgentArchiveDefinition = {};
  if (r.mcpServers !== undefined) {
    if (!Array.isArray(r.mcpServers)) {
      throw badRequest("manifest.json: definition.mcpServers must be an array.");
    }
    out.mcpServers = r.mcpServers.map((entry, i) => {
      const server = asRecord(entry);
      if (server === null || typeof server.name !== "string" || asRecord(server.config) === null) {
        throw badRequest(
          `manifest.json: definition.mcpServers[${i}] must be { name: string, config: object }.`,
        );
      }
      return { name: server.name, config: server.config as Record<string, unknown> };
    }) satisfies MCPServerConfig[];
  }
  if (r.model !== undefined) {
    const model = asRecord(r.model);
    if (model === null) throw badRequest("manifest.json: definition.model must be an object.");
    const level = model.thinkingLevel;
    if (level !== undefined && !THINKING_LEVEL_NAMES.includes(level as ThinkingLevelName)) {
      throw badRequest(
        `manifest.json: definition.model.thinkingLevel must be one of ${THINKING_LEVEL_NAMES.join(", ")}.`,
      );
    }
    for (const key of ["maxTokens", "timeoutMs"] as const) {
      if (model[key] !== undefined && typeof model[key] !== "number") {
        throw badRequest(`manifest.json: definition.model.${key} must be a number.`);
      }
    }
    out.model = {
      ...(level !== undefined ? { thinkingLevel: level as ThinkingLevelName } : {}),
      ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens as number } : {}),
      ...(model.timeoutMs !== undefined ? { timeoutMs: model.timeoutMs as number } : {}),
    };
  }
  if (r.tools !== undefined) {
    const tools = asRecord(r.tools);
    if (tools === null) throw badRequest("manifest.json: definition.tools must be an object.");
    out.tools = { builtin: stringList(tools, "builtin") };
  }
  return out;
}

/**
 * Checks a parsed `manifest.json`. `present` answers which parts' directories the zip holds: a
 * hand-written manifest may leave `parts` out, and then the zip carries what it holds.
 */
export function parseManifest(
  raw: unknown,
  present: (part: keyof Omit<AgentArchiveParts, "traces">) => boolean,
): AgentArchiveManifest {
  const r = asRecord(raw);
  if (r === null) throw badRequest("manifest.json must be a JSON object.");
  if (r.format !== ARCHIVE_FORMAT) {
    throw badRequest(
      `manifest.json: unsupported format ${JSON.stringify(r.format)}; expected ${JSON.stringify(ARCHIVE_FORMAT)}.`,
    );
  }
  const agentId = optionalText(r, "agentId", 64) ?? "";
  const name = optionalText(r, "name", 100);
  const description = optionalText(r, "description", 2000);
  const source = asRecord(r.source);
  const exportedBy = asRecord(r.exportedBy);
  return {
    format: ARCHIVE_FORMAT,
    exportedAt: typeof r.exportedAt === "string" ? r.exportedAt : "",
    ...(typeof exportedBy?.penguinVersion === "string"
      ? { exportedBy: { penguinVersion: exportedBy.penguinVersion } }
      : {}),
    ...(source !== null &&
    typeof source.projectId === "string" &&
    typeof source.agentId === "string" &&
    typeof source.version === "number"
      ? {
          source: { projectId: source.projectId, agentId: source.agentId, version: source.version },
        }
      : {}),
    agentId,
    ...(name !== undefined && name !== "" ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    parts:
      r.parts === undefined
        ? {
            skills: present("skills"),
            hooks: present("hooks"),
            memory: present("memory"),
            workbenches: present("workbenches"),
            workbenchData: present("workbenchData"),
            schedules: present("schedules"),
            traces: { kind: "none" },
          }
        : partsOf(r.parts),
    vaultKeys: stringList(r, "vaultKeys"),
    redacted: stringList(r, "redacted"),
    ...(r.definition !== undefined ? { definition: definitionOf(r.definition) } : {}),
  };
}
