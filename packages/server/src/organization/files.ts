/**
 * The organization files — parsing, validation and canonical serialization. Pure string
 * work, no I/O: the store reads and writes, the service decides.
 *
 * Intent files (`org_config.toml`, `org_chart.yaml`, calendar events, tickets, the
 * handbook, `channel.toml`) are edited by people and employees; the API is a validating
 * writer over the same format, so a hand-edited file and an API-written one parse under one
 * set of rules. Fact files (`desks.toml`, a ticket's `sessions` and `history` fields,
 * message lines) are written by the server only. An invalid file is reported, never
 * repaired in place.
 */
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  Document as YamlDocument,
  isMap,
  isSeq,
  parse as parseYaml,
  stringify as stringifyYaml,
} from "yaml";
import type {
  OrgApprovalMode,
  OrgChannelMessage,
  OrgChannelNoticeKind,
  OrgLanguage,
  OrgStatus,
  OrgTicketHistoryAction,
  OrgTicketHistoryEntry,
  OrgTicketPriority,
  OrgTicketStatus,
} from "../api/types.js";
import { parseScheduleFile } from "../runtime/schedule-file.js";
import type { ScheduleDefinition } from "../runtime/schedule-file.js";
import { SEMANTIC_ID_PATTERN } from "../services/ids.js";
import { DEFAULT_CHANNEL_ID, ceoAgentId, isTicketColumn } from "./paths.js";
import { parsePrincipal, splitPrincipalList } from "./principal.js";
import { isValidTimeZone } from "./zoned.js";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

// ---------------------------------------------------------------------------
// org_config.toml
// ---------------------------------------------------------------------------

export interface OrgConfig {
  name: string;
  mission: string;
  status: OrgStatus;
  timezone: string;
  approvalMode: OrgApprovalMode;
  mentionChainLimit: number;
  budgetWarnRatio: number;
  budgetPauseRatio: number;
  createdBy: string;
  /** The shared workspace root when it is not the organization's own `workspace/`: an absolute directory that exists. */
  workspace?: string;
  /** The model desks and ticket sessions run on when the employee entry names none; absent = the Project default. */
  model?: { provider: string; modelId: string };
  /** The working language everything the organization produces is written in; absent = detected from the mission ({@link orgLanguage}). */
  language?: OrgLanguage;
}

/**
 * The language of a piece of text as the organization uses it: one Han character anywhere
 * makes it Chinese, everything else is English. Deliberately coarse — a mission is one or
 * two sentences, and the question it answers is which of the two sets of templates the
 * company writes in, not what locale it is in.
 */
export function detectLanguage(text: string): OrgLanguage {
  return /\p{Script=Han}/u.test(text) ? "zh" : "en";
}

/**
 * The organization's effective working language: the field when it is set, else the
 * language of the mission. An organization written before the field existed therefore
 * needs no migration — it reads as whatever its mission is written in.
 */
export function orgLanguage(config: OrgConfig): OrgLanguage {
  return config.language ?? detectLanguage(config.mission);
}

/**
 * The bounds `parseOrgConfig` holds the two numeric settings to. Exported because the write
 * path has to refuse exactly what the loader would: a value past them is written happily and
 * then fails to parse on the next load, which marks the organization invalid and stops every
 * automatic trigger until somebody edits the file by hand.
 */
export const MENTION_CHAIN_LIMIT_MAX = 100;
export const BUDGET_RATIO_MAX = 10;

export const ORG_CONFIG_DEFAULTS = {
  status: "active" as OrgStatus,
  approvalMode: "allow-all" as OrgApprovalMode,
  mentionChainLimit: 3,
  budgetWarnRatio: 0.8,
  budgetPauseRatio: 1.0,
};

/**
 * The CEO's monthly budget in USD when organization creation names none. Budgets are
 * compared on the cumulative line — the employee plus every subordinate — so the CEO's
 * budget is the whole company's: a new organization is capped rather than unbounded, and
 * the number is raised (or cleared) once the board knows what the mission costs.
 */
export const DEFAULT_CEO_BUDGET = 100;

function tomlTable(raw: string): ParseResult<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = parseToml(raw);
  } catch (err) {
    return fail(`Failed to parse TOML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object") return fail("Content is not a TOML table");
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function parseOrgConfig(raw: string): ParseResult<OrgConfig> {
  const t = tomlTable(raw);
  if (!t.ok) return t;
  const table = t.value;
  const name = table["name"];
  if (typeof name !== "string" || name.trim() === "")
    return fail("name must be a non-empty string");
  const mission = table["mission"];
  if (typeof mission !== "string") return fail("mission must be a string");
  const status = table["status"] ?? ORG_CONFIG_DEFAULTS.status;
  if (status !== "active" && status !== "paused") return fail("status must be active or paused");
  const timezone = table["timezone"] ?? "UTC";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    return fail("timezone must be a valid IANA timezone");
  }
  const approvalMode = table["approval_mode"] ?? ORG_CONFIG_DEFAULTS.approvalMode;
  if (approvalMode !== "allow-all" && approvalMode !== "read-only" && approvalMode !== "deny-all") {
    return fail("approval_mode must be allow-all, read-only or deny-all");
  }
  const limit = table["mention_chain_limit"] ?? ORG_CONFIG_DEFAULTS.mentionChainLimit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 0 ||
    limit > MENTION_CHAIN_LIMIT_MAX
  ) {
    return fail(`mention_chain_limit must be an integer between 0 and ${MENTION_CHAIN_LIMIT_MAX}`);
  }
  const warn = table["budget_warn_ratio"] ?? ORG_CONFIG_DEFAULTS.budgetWarnRatio;
  const pause = table["budget_pause_ratio"] ?? ORG_CONFIG_DEFAULTS.budgetPauseRatio;
  for (const [key, v] of [
    ["budget_warn_ratio", warn],
    ["budget_pause_ratio", pause],
  ] as const) {
    if (typeof v !== "number" || !(v > 0) || v > BUDGET_RATIO_MAX)
      return fail(`${key} must be a number in (0, ${BUDGET_RATIO_MAX}]`);
  }
  const createdBy = table["created_by"];
  if (typeof createdBy !== "string" || createdBy === "")
    return fail("created_by must be a non-empty string");
  const workspace = table["workspace"];
  if (workspace !== undefined && (typeof workspace !== "string" || !path.isAbsolute(workspace))) {
    return fail("workspace must be an absolute path");
  }
  const language = table["language"];
  if (language !== undefined && language !== "zh" && language !== "en") {
    return fail("language must be zh or en");
  }
  let model: { provider: string; modelId: string } | undefined;
  if (table["model"] !== undefined) {
    const m = table["model"];
    if (m === null || typeof m !== "object") return fail("model must be a table");
    const provider = (m as Record<string, unknown>)["provider"];
    const modelId = (m as Record<string, unknown>)["model_id"];
    if (
      typeof provider !== "string" ||
      provider === "" ||
      typeof modelId !== "string" ||
      modelId === ""
    ) {
      return fail("model needs both provider and model_id");
    }
    model = { provider, modelId };
  }
  return {
    ok: true,
    value: {
      name: name.trim(),
      mission: mission.trim(),
      status,
      timezone,
      approvalMode,
      mentionChainLimit: limit,
      budgetWarnRatio: warn as number,
      budgetPauseRatio: pause as number,
      createdBy,
      ...(typeof workspace === "string" ? { workspace } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(language !== undefined ? { language } : {}),
    },
  };
}

export function serializeOrgConfig(cfg: OrgConfig): string {
  const table = {
    name: cfg.name,
    mission: cfg.mission,
    status: cfg.status,
    timezone: cfg.timezone,
    approval_mode: cfg.approvalMode,
    mention_chain_limit: cfg.mentionChainLimit,
    budget_warn_ratio: cfg.budgetWarnRatio,
    budget_pause_ratio: cfg.budgetPauseRatio,
    created_by: cfg.createdBy,
    ...(cfg.language !== undefined ? { language: cfg.language } : {}),
    ...(cfg.workspace !== undefined ? { workspace: cfg.workspace } : {}),
    ...(cfg.model !== undefined
      ? { model: { provider: cfg.model.provider, model_id: cfg.model.modelId } }
      : {}),
  };
  return [
    "# org_config.toml — organization settings (the id is the directory name and never changes).",
    "# status: active | paused (paused stops every automatic trigger; people can still talk to any desk).",
    "# approval_mode: allow-all | read-only | deny-all for desk and ticket sessions.",
    "# language: zh | en — the working language of everything the organization writes (optional; detected from the mission when absent).",
    "# workspace: an absolute directory used as the shared workspace instead of ./workspace (optional).",
    "# [model]: provider + model_id for desks and ticket sessions when the employee names none (optional).",
    stringifyToml(table),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// org_chart.yaml
// ---------------------------------------------------------------------------

export interface OrgEmployee {
  agentId: string;
  title: string;
  /** null for the CEO, the root. */
  reportsTo: string | null;
  duties?: string;
  /** A sub-directory of the shared workspace (`.` = all of it) or an absolute path. */
  workspace: string;
  budget?: number;
  model?: { provider: string; modelId: string };
}

export interface OrgChart {
  employees: OrgEmployee[];
}

function employeeFrom(item: unknown, index: number): ParseResult<OrgEmployee> {
  if (item === null || typeof item !== "object")
    return fail(`employees[${index}] is not a mapping`);
  const e = item as Record<string, unknown>;
  const agentId = e["agent_id"];
  if (typeof agentId !== "string" || !SEMANTIC_ID_PATTERN.test(agentId)) {
    return fail(`employees[${index}].agent_id is missing or not a valid Agent id`);
  }
  const title = e["title"];
  if (typeof title !== "string" || title.trim() === "") {
    return fail(`${agentId}: title must be a non-empty string`);
  }
  const reportsTo = e["reports_to"] ?? null;
  if (reportsTo !== null && (typeof reportsTo !== "string" || reportsTo === "")) {
    return fail(`${agentId}: reports_to must be an Agent id or null`);
  }
  const duties = e["duties"];
  if (duties !== undefined && typeof duties !== "string")
    return fail(`${agentId}: duties must be a string`);
  const workspace = e["workspace"] ?? ".";
  if (typeof workspace !== "string" || workspace.trim() === "") {
    return fail(`${agentId}: workspace must be a non-empty string`);
  }
  const budget = e["budget"];
  if (budget !== undefined && budget !== null && (typeof budget !== "number" || !(budget >= 0))) {
    return fail(`${agentId}: budget must be a number >= 0`);
  }
  let model: { provider: string; modelId: string } | undefined;
  if (e["model"] !== undefined && e["model"] !== null) {
    const m = e["model"];
    if (m === null || typeof m !== "object") return fail(`${agentId}: model must be a mapping`);
    const provider = (m as Record<string, unknown>)["provider"];
    const modelId = (m as Record<string, unknown>)["model_id"];
    if (
      typeof provider !== "string" ||
      provider === "" ||
      typeof modelId !== "string" ||
      modelId === ""
    ) {
      return fail(`${agentId}: model needs both provider and model_id`);
    }
    model = { provider, modelId };
  }
  return {
    ok: true,
    value: {
      agentId,
      title: title.trim(),
      reportsTo: reportsTo as string | null,
      ...(typeof duties === "string" && duties.trim() !== "" ? { duties: duties.trim() } : {}),
      workspace: workspace.trim(),
      ...(typeof budget === "number" ? { budget } : {}),
      ...(model !== undefined ? { model } : {}),
    },
  };
}

/**
 * Parse and validate the employee tree: unique valid ids, exactly one root and it is the
 * CEO (`<orgId>_ceo`), every `reports_to` names another employee, and no cycles — every
 * employee walks up to the root.
 */
export function parseOrgChart(raw: string, orgId: string): ParseResult<OrgChart> {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    return fail(`Failed to parse YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== "object") return fail("Content is not a YAML mapping");
  const list = (parsed as Record<string, unknown>)["employees"];
  if (!Array.isArray(list)) return fail("employees must be a list");
  const employees: OrgEmployee[] = [];
  const seen = new Set<string>();
  for (const [i, item] of list.entries()) {
    const r = employeeFrom(item, i);
    if (!r.ok) return r;
    if (seen.has(r.value.agentId)) return fail(`duplicate employee: ${r.value.agentId}`);
    seen.add(r.value.agentId);
    employees.push(r.value);
  }
  const roots = employees.filter((e) => e.reportsTo === null);
  if (roots.length !== 1) return fail("exactly one employee must have reports_to: null (the CEO)");
  if (roots[0]!.agentId !== ceoAgentId(orgId)) {
    return fail(`the root employee must be the CEO ${ceoAgentId(orgId)}`);
  }
  for (const e of employees) {
    if (e.reportsTo === null) continue;
    if (e.reportsTo === e.agentId) return fail(`${e.agentId} reports to itself`);
    if (!seen.has(e.reportsTo))
      return fail(`${e.agentId} reports to unknown employee ${e.reportsTo}`);
  }
  const byId = new Map(employees.map((e) => [e.agentId, e]));
  for (const e of employees) {
    let cur: OrgEmployee | undefined = e;
    for (let steps = 0; cur && cur.reportsTo !== null; steps++) {
      if (steps > employees.length) return fail(`reporting line of ${e.agentId} forms a cycle`);
      cur = byId.get(cur.reportsTo);
    }
  }
  return { ok: true, value: { employees } };
}

export function serializeOrgChart(chart: OrgChart): string {
  const doc = {
    employees: chart.employees.map((e) => ({
      agent_id: e.agentId,
      title: e.title,
      reports_to: e.reportsTo,
      ...(e.duties !== undefined ? { duties: e.duties } : {}),
      workspace: e.workspace,
      ...(e.budget !== undefined ? { budget: e.budget } : {}),
      ...(e.model !== undefined
        ? { model: { provider: e.model.provider, model_id: e.model.modelId } }
        : {}),
    })),
  };
  return [
    "# org_chart.yaml — the employee tree: one employee is one Agent (no Agent, no position),",
    "# joined by reports_to into a tree rooted at the CEO. Budgets are monthly USD caps for an",
    "# employee plus every subordinate; workspace is a sub-directory of the shared workspace",
    "# (. = all of it) or an absolute path that already exists.",
    stringifyYaml(doc, { lineWidth: 0 }).trimEnd(),
    "",
  ].join("\n");
}

/** Every employee below `agentId` (children, grandchildren, …), in tree order. */
export function subordinatesOf(chart: OrgChart, agentId: string): string[] {
  const out: string[] = [];
  const walk = (id: string): void => {
    for (const e of chart.employees) {
      if (e.reportsTo === id) {
        out.push(e.agentId);
        walk(e.agentId);
      }
    }
  };
  walk(agentId);
  return out;
}

/** The reporting line above `agentId`, nearest first, ending at the root. */
export function ancestorsOf(chart: OrgChart, agentId: string): string[] {
  const byId = new Map(chart.employees.map((e) => [e.agentId, e]));
  const out: string[] = [];
  let cur = byId.get(agentId);
  while (cur && cur.reportsTo !== null && out.length <= chart.employees.length) {
    out.push(cur.reportsTo);
    cur = byId.get(cur.reportsTo);
  }
  return out;
}

// ---------------------------------------------------------------------------
// desks.toml (fact file)
// ---------------------------------------------------------------------------

export interface DeskEntry {
  sessionId: string;
  /** The resolved absolute workspace the session was opened in (immutable per session). */
  workspace: string;
  openedAt: string;
  /** Earlier desk sessions of this employee (renewals), oldest first: they still count toward the employee's cost. */
  previous: string[];
}

export type Desks = Record<string, DeskEntry>;

export function parseDesks(raw: string): ParseResult<Desks> {
  const t = tomlTable(raw);
  if (!t.ok) return t;
  const desks: Desks = {};
  for (const [agentId, value] of Object.entries(t.value)) {
    if (value === null || typeof value !== "object") return fail(`${agentId} is not a table`);
    const d = value as Record<string, unknown>;
    if (typeof d["session_id"] !== "string" || typeof d["workspace"] !== "string") {
      return fail(`${agentId}: session_id and workspace are required`);
    }
    const openedAt = d["opened_at"];
    const previous = d["previous"];
    if (
      previous !== undefined &&
      (!Array.isArray(previous) || previous.some((p) => typeof p !== "string"))
    ) {
      return fail(`${agentId}: previous must be a list of session ids`);
    }
    desks[agentId] = {
      sessionId: d["session_id"],
      workspace: d["workspace"],
      openedAt:
        openedAt instanceof Date
          ? openedAt.toISOString()
          : typeof openedAt === "string"
            ? openedAt
            : "",
      previous: (previous as string[] | undefined) ?? [],
    };
  }
  return { ok: true, value: desks };
}

export function serializeDesks(desks: Desks): string {
  const table: Record<string, unknown> = {};
  for (const [agentId, d] of Object.entries(desks)) {
    table[agentId] = {
      session_id: d.sessionId,
      workspace: d.workspace,
      opened_at: d.openedAt,
      ...(d.previous.length > 0 ? { previous: d.previous } : {}),
    };
  }
  return [
    "# desks.toml — desk ledger (a fact file the server writes): employee -> current desk session.",
    stringifyToml(table),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// calendar/<agent_id>/<name>.toml
// ---------------------------------------------------------------------------

export interface CalendarEvent extends ScheduleDefinition {
  title?: string;
}

const CALENDAR_TARGET_KEYS = ["session_id", "workspace", "model_id", "provider"] as const;

/** A schedule file without target fields: the target is always the employee's desk session. */
export function parseCalendarEvent(name: string, raw: string): ParseResult<CalendarEvent> {
  const t = tomlTable(raw);
  if (!t.ok) return t;
  for (const key of CALENDAR_TARGET_KEYS) {
    if (t.value[key] !== undefined) {
      return fail(
        `${key} is not allowed: a calendar event always goes to the employee's desk session`,
      );
    }
  }
  const title = t.value["title"];
  if (title !== undefined && typeof title !== "string") return fail("title must be a string");
  const parsed = parseScheduleFile(name, raw);
  if (!parsed.ok) return fail(parsed.error);
  return {
    ok: true,
    value: {
      ...parsed.def,
      ...(typeof title === "string" && title.trim() !== "" ? { title: title.trim() } : {}),
    },
  };
}

export function serializeCalendarEvent(fields: {
  title?: string;
  prompt: string;
  enabled: boolean;
  startAt: string;
  period?: string;
  endAt?: string;
}): string {
  const table: Record<string, unknown> = {
    ...(fields.title !== undefined ? { title: fields.title } : {}),
    prompt: fields.prompt,
    enabled: fields.enabled,
    start_at: fields.startAt,
    ...(fields.period !== undefined ? { period: fields.period } : {}),
    ...(fields.endAt !== undefined ? { end_at: fields.endAt } : {}),
  };
  return `${stringifyToml(table)}\n`;
}

// ---------------------------------------------------------------------------
// tickets/<yyyy-mm>/<column>/<yyyy-mm-dd>-<slug>.md
// ---------------------------------------------------------------------------

/** `<yyyy-mm-dd>-<slug>`; the slug is hyphen-joined lowercase English words, never a digit. */
export const TICKET_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z]+(?:-[a-z]+)*$/;

/** At most this many words in a derived slug, and at most this many characters in each. */
const SLUG_MAX_WORDS = 6;
const SLUG_MAX_WORD_LENGTH = 20;

/**
 * The slug of a ticket id, derived from a title or from a model's proposal: ASCII letters
 * only, lowercased, hyphen-joined. Digits are dropped — the id already starts with the date,
 * and `-2` on the end of a slug reads as a version rather than as a name. Text that carries
 * no Latin letters at all (a Chinese title) yields `""`, and one that yields a single word
 * says as little as none: both are the case the caller asks the model to name.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, SLUG_MAX_WORDS)
    .map((w) => w.slice(0, SLUG_MAX_WORD_LENGTH))
    .join("-");
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/**
 * The letters that make a taken id unique: `2` → `b`, `3` → `c`, … `26` → `z`, `27` → `aa`.
 * Letters rather than numbers because the slug pattern has no digits in it, and starting at
 * `b` because the first candidate is the bare slug.
 */
export function slugSuffix(n: number): string {
  let out = "";
  for (let v = n; v > 0; v = Math.floor((v - 1) / ALPHABET.length)) {
    out = `${ALPHABET[(v - 1) % ALPHABET.length]}${out}`;
  }
  return out;
}

export interface TicketDoc {
  title: string;
  status: OrgTicketStatus;
  /** The ONE responsible principal (`agent:<id>` / `user:<id>`); every ticket has one. */
  owner: string;
  parent?: string;
  notify: string[];
  priority: OrgTicketPriority;
  due?: string;
  blocked?: string;
  blockedBy?: string;
  /** Contributing session ids, in the order they were attached (fact, server-written). */
  sessions: string[];
  /** The operation log, oldest first (fact, server-written). */
  history: OrgTicketHistoryEntry[];
  goal: string;
  acceptanceCriteria: string;
  /** Plain progress sentences, without their bullet; who wrote one and when is in the history. */
  progress: string[];
  result: string;
  /** Frontmatter keys this parser does not know, kept verbatim across a round trip. */
  extra: Record<string, unknown>;
  /** Sections beyond the four fixed ones, kept verbatim. */
  extraSections: Array<{ heading: string; body: string }>;
}

const SECTION_KEYS: Record<string, "goal" | "acceptanceCriteria" | "progress" | "result"> = {
  goal: "goal",
  "acceptance criteria": "acceptanceCriteria",
  progress: "progress",
  result: "result",
};

const KNOWN_FIELDS = new Set([
  "title",
  "status",
  "owner",
  "parent",
  "notify",
  "priority",
  "due",
  "blocked",
  "blocked_by",
  "sessions",
  "history",
]);

const HISTORY_ACTIONS: readonly OrgTicketHistoryAction[] = [
  "created",
  "assigned",
  "moved",
  "blocked",
  "unblocked",
  "progress",
  "session_started",
  "session_attached",
  "edited",
];

/** How much of a progress sentence the history entry that records it carries. */
export const HISTORY_NOTE_MAX = 80;

function isPersonPrincipal(raw: string): boolean {
  const p = parsePrincipal(raw);
  return p !== null && (p.kind === "agent" || p.kind === "user");
}

type Frontmatter =
  { kind: "none" } | { kind: "unterminated" } | { kind: "ok"; yaml: string; body: string };

/** The `---` fenced block at the top of the file, and everything after it. */
function splitFrontmatter(text: string): Frontmatter {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  if (lines[i]?.trim() !== "---") return { kind: "none" };
  const start = i + 1;
  for (let j = start; j < lines.length; j++) {
    if (lines[j]!.trim() === "---") {
      return {
        kind: "ok",
        yaml: lines.slice(start, j).join("\n"),
        body: lines.slice(j + 1).join("\n"),
      };
    }
  }
  return { kind: "unterminated" };
}

/**
 * A ticket file: YAML frontmatter followed by the prose sections. The frontmatter carries
 * the fields (the title among them — there is no H1), the prose carries `## Goal`,
 * `## Acceptance criteria`, `## Progress` and `## Result`; unknown fields and unknown
 * sections survive a round trip. A file in the format that predates the frontmatter is read
 * by {@link parseLegacyTicket} and converted the next time it is written.
 */
export function parseTicket(raw: string): ParseResult<TicketDoc> {
  const text = raw.replace(/\r\n/g, "\n");
  const fm = splitFrontmatter(text);
  if (fm.kind === "none") return parseLegacyTicket(text);
  if (fm.kind === "unterminated") return fail("the frontmatter block is not closed by `---`");
  let parsed: unknown;
  try {
    parsed = parseYaml(fm.yaml);
  } catch (err) {
    return fail(
      `Failed to parse the frontmatter: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return fail("the frontmatter is not a YAML mapping");
  }
  const front = parsed as Record<string, unknown>;
  const fields = ticketFields(front);
  if (!fields.ok) return fields;
  const sections = ticketSections(fm.body);
  if (!sections.ok) return sections;
  return { ok: true, value: { ...fields.value, ...sections.value } };
}

type TicketFields = Omit<
  TicketDoc,
  "goal" | "acceptanceCriteria" | "progress" | "result" | "extraSections"
>;

/** The frontmatter's fields, validated; anything this parser does not know lands in `extra`. */
function ticketFields(front: Record<string, unknown>): ParseResult<TicketFields> {
  const str = (key: string): string => {
    const v = front[key];
    return typeof v === "string" ? v.trim() : "";
  };
  const title = str("title");
  if (title === "") return fail("title must be a non-empty string");
  const status = str("status");
  if (!isTicketColumn(status)) {
    return fail(`status must be one of the board columns, got \`${status}\``);
  }
  const owner = str("owner");
  if (!isPersonPrincipal(owner)) return fail("owner must be agent:<id> or user:<id>");
  const parent = str("parent");
  if (parent !== "" && !TICKET_ID_PATTERN.test(parent)) return fail("parent must be a ticket id");
  const notifyList = front["notify"];
  if (notifyList !== undefined && notifyList !== null && !Array.isArray(notifyList)) {
    return fail("notify must be a list of principals");
  }
  // No `notify`, or an empty one: tell the owner when it is an employee — its next sweep
  // lists the change — and nobody when a person owns it, because one @-mention per closed
  // ticket is a badge nobody asked for. A person lists itself to be told.
  const notify =
    Array.isArray(notifyList) && notifyList.length > 0
      ? notifyList.map((n) => String(n).trim())
      : defaultTicketNotify(owner);
  for (const n of notify)
    if (!isPersonPrincipal(n)) return fail(`notify entry is not a principal: ${n}`);
  const priority = str("priority") === "" ? "P2" : str("priority");
  if (priority !== "P0" && priority !== "P1" && priority !== "P2") {
    return fail("priority must be P0, P1 or P2");
  }
  const due = str("due");
  if (due !== "" && !/^\d{4}-\d{2}-\d{2}/.test(due)) return fail("due must start with yyyy-mm-dd");
  const blocked = str("blocked");
  const blockedBy = str("blocked_by");
  if (blockedBy !== "" && !TICKET_ID_PATTERN.test(blockedBy) && !isPersonPrincipal(blockedBy)) {
    return fail("blocked_by must be a ticket id or a principal");
  }
  const sessionList = front["sessions"];
  if (sessionList !== undefined && sessionList !== null && !Array.isArray(sessionList)) {
    return fail("sessions must be a list of session ids");
  }
  const sessions = Array.isArray(sessionList) ? sessionList.map((s) => String(s).trim()) : [];
  const history = parseTicketHistory(front["history"]);
  if (!history.ok) return history;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(front)) if (!KNOWN_FIELDS.has(key)) extra[key] = value;
  return {
    ok: true,
    value: {
      title,
      status,
      owner,
      ...(parent !== "" ? { parent } : {}),
      notify,
      priority,
      ...(due !== "" ? { due } : {}),
      ...(blocked !== "" ? { blocked } : {}),
      ...(blockedBy !== "" ? { blockedBy } : {}),
      sessions,
      history: history.value,
      extra,
    },
  };
}

/** The `Notify` list a ticket falls back to: its owner when an employee owns it, nobody otherwise. */
export function defaultTicketNotify(owner: string): string[] {
  return parsePrincipal(owner)?.kind === "agent" ? [owner] : [];
}

function parseTicketHistory(value: unknown): ParseResult<OrgTicketHistoryEntry[]> {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return fail("history must be a list of entries");
  const out: OrgTicketHistoryEntry[] = [];
  for (const [i, item] of value.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return fail(`history[${i}] is not a mapping`);
    }
    const e = item as Record<string, unknown>;
    const at = typeof e["at"] === "string" ? e["at"].trim() : "";
    const by = typeof e["by"] === "string" ? e["by"].trim() : "";
    const action = typeof e["action"] === "string" ? e["action"].trim() : "";
    if (!(HISTORY_ACTIONS as readonly string[]).includes(action)) {
      return fail(`history[${i}].action is not a known action: ${action}`);
    }
    const note = typeof e["note"] === "string" ? e["note"] : undefined;
    out.push({
      at,
      by,
      action: action as OrgTicketHistoryAction,
      ...(note !== undefined && note !== "" ? { note } : {}),
    });
  }
  return { ok: true, value: out };
}

type TicketProse = Pick<
  TicketDoc,
  "goal" | "acceptanceCriteria" | "progress" | "result" | "extraSections"
>;

/** The prose half: the four fixed sections, plus any others kept as written. */
function ticketSections(body: string): ParseResult<TicketProse> {
  const out: TicketProse = {
    goal: "",
    acceptanceCriteria: "",
    progress: [],
    result: "",
    extraSections: [],
  };
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of body.split("\n")) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      current = { heading: h[1]!.trim(), body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else if (line.trim() !== "") {
      return fail(`text before the first section heading: ${line}`);
    }
  }
  for (const s of sections) {
    const key = SECTION_KEYS[s.heading.toLowerCase()];
    const text = trimBlank(s.body).join("\n");
    if (key === "progress") {
      out.progress = trimBlank(s.body)
        .filter((l) => l.trim() !== "")
        .map((l) => l.trim().replace(/^[-*]\s+/, ""));
    } else if (key !== undefined) {
      out[key] = text;
    } else {
      out.extraSections.push({ heading: s.heading, body: text });
    }
  }
  return { ok: true, value: out };
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a]!.trim() === "") a++;
  while (b > a && lines[b - 1]!.trim() === "") b--;
  return lines.slice(a, b);
}

export function serializeTicket(doc: TicketDoc): string {
  const front: Record<string, unknown> = {
    title: doc.title,
    status: doc.status,
    owner: doc.owner,
    ...(doc.parent !== undefined ? { parent: doc.parent } : {}),
    notify: doc.notify,
    priority: doc.priority,
    ...(doc.due !== undefined ? { due: doc.due } : {}),
    ...(doc.blocked !== undefined && doc.blocked !== "" ? { blocked: doc.blocked } : {}),
    ...(doc.blockedBy !== undefined && doc.blockedBy !== "" ? { blocked_by: doc.blockedBy } : {}),
    sessions: doc.sessions,
    history: doc.history.map((h) => ({
      at: h.at,
      by: h.by,
      action: h.action,
      ...(h.note !== undefined && h.note !== "" ? { note: h.note } : {}),
    })),
    ...doc.extra,
  };
  const yamlDoc = new YamlDocument(front);
  // One line per list and per history entry: a ticket file is read and hand-edited, and a
  // twenty-line `sessions` block would bury the fields above it.
  for (const key of ["notify", "sessions"]) {
    const node = yamlDoc.get(key, true);
    if (isSeq(node)) node.flow = true;
  }
  const history = yamlDoc.get("history", true);
  if (isSeq(history)) for (const item of history.items) if (isMap(item)) item.flow = true;
  const sections: string[] = [
    `## Goal\n${doc.goal}`,
    `## Acceptance criteria\n${doc.acceptanceCriteria}`,
    `## Progress\n${doc.progress.map((p) => `- ${p}`).join("\n")}`,
    `## Result\n${doc.result}`,
    ...doc.extraSections.map((s) => `## ${s.heading}\n${s.body}`),
  ];
  const yaml = yamlDoc.toString({ lineWidth: 0, flowCollectionPadding: false });
  return `---\n${yaml}---\n\n${sections.map((s) => s.trimEnd()).join("\n\n")}\n`;
}

/** One progress sentence as the history records it: the first {@link HISTORY_NOTE_MAX} characters, on one line. */
export function historyNote(text: string): string {
  return text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, HISTORY_NOTE_MAX);
}

// ---------------------------------------------------------------------------
// Legacy ticket files
// ---------------------------------------------------------------------------

const LEGACY_HEADERS = new Set([
  "status",
  "initiator",
  "owner",
  "parent",
  "notify",
  "priority",
  "due",
  "blocked",
  "blocked-by",
  "sessions",
]);

/** A legacy progress line: `- <time> <principal> <text> [session:<id>]`. */
function parseLegacyProgressLine(line: string): { time: string; by: string; text: string } | null {
  const m = /^-\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line.trim());
  if (!m) return null;
  let text = m[3]!.trim();
  const s = /\s*session:(\S+)$/.exec(text);
  if (s) text = text.slice(0, s.index).trim();
  if (!isPersonPrincipal(m[2]!)) return null;
  return { time: m[1]!, by: m[2]!, text };
}

/**
 * A ticket written before the frontmatter format: `# Ticket: <title>` followed by
 * `Key: value` header lines. `Initiator` becomes the `created` history entry and, when no
 * `Owner` was set, the owner; each old progress line becomes a plain progress sentence plus
 * one `progress` history entry carrying its time and principal. Nothing is repaired on disk
 * here — the file converts to the new format the first time it is written.
 *
 * **Compatibility shim.** The frontmatter format ships in 0.2.12, so this can be deleted in
 * 0.2.13 — by then every ticket an organization still writes to has been converted; see
 * `changelog/0.2.12/2026-09-09-backward-compatibility.md`.
 */
export function parseLegacyTicket(text: string): ParseResult<TicketDoc> {
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const titleLine = /^# Ticket: (.+)$/.exec(lines[i] ?? "");
  if (!titleLine)
    return fail("the file must start with `---` (frontmatter) or `# Ticket: <title>`");
  const title = titleLine[1]!.trim();
  i++;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const headers = new Map<string, string>();
  const extra: Record<string, unknown> = {};
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "" || line.startsWith("## ")) break;
    const kv = /^([A-Za-z][A-Za-z-]*):\s?(.*)$/.exec(line);
    if (!kv) return fail(`header line is not \`Key: value\`: ${line}`);
    const key = kv[1]!.toLowerCase();
    if (LEGACY_HEADERS.has(key)) headers.set(key, kv[2]!.trim());
    else extra[kv[1]!] = kv[2]!.trim();
  }
  const status = headers.get("status") ?? "";
  if (!isTicketColumn(status))
    return fail(`Status must be one of the board columns, got \`${status}\``);
  const initiator = headers.get("initiator") ?? "";
  if (!isPersonPrincipal(initiator)) return fail("Initiator must be agent:<id> or user:<id>");
  // One owner now: an unassigned legacy ticket is owned by whoever filed it.
  const ownerHeader = headers.get("owner") ?? "";
  if (ownerHeader !== "" && !isPersonPrincipal(ownerHeader)) {
    return fail("Owner must be agent:<id> or user:<id>");
  }
  const owner = ownerHeader !== "" ? ownerHeader : initiator;
  const parent = headers.get("parent") ?? "";
  if (parent !== "" && !TICKET_ID_PATTERN.test(parent) && !LEGACY_TICKET_ID_PATTERN.test(parent)) {
    return fail("Parent must be a ticket id");
  }
  const notifyRaw = headers.get("notify");
  const notify =
    notifyRaw === undefined || notifyRaw === ""
      ? defaultTicketNotify(owner)
      : splitPrincipalList(notifyRaw);
  for (const n of notify)
    if (!isPersonPrincipal(n)) return fail(`Notify entry is not a principal: ${n}`);
  const priority = headers.get("priority") ?? "P2";
  if (priority !== "P0" && priority !== "P1" && priority !== "P2") {
    return fail("Priority must be P0, P1 or P2");
  }
  const due = headers.get("due") ?? "";
  if (due !== "" && !/^\d{4}-\d{2}-\d{2}/.test(due)) return fail("Due must start with yyyy-mm-dd");
  const blocked = headers.get("blocked") ?? "";
  const blockedBy = headers.get("blocked-by") ?? "";
  if (
    blockedBy !== "" &&
    !TICKET_ID_PATTERN.test(blockedBy) &&
    !LEGACY_TICKET_ID_PATTERN.test(blockedBy) &&
    !isPersonPrincipal(blockedBy)
  ) {
    return fail("Blocked-by must be a ticket id or a principal");
  }
  const sessions = splitPrincipalList(headers.get("sessions") ?? "");
  const prose = ticketSections(lines.slice(i).join("\n"));
  if (!prose.ok) return prose;
  // The old progress log carried the operator and the time inline; they move to the history,
  // the sentence stays. A line nothing can be read out of is kept as a sentence and nothing else.
  const history: OrgTicketHistoryEntry[] = [];
  const progress: string[] = [];
  for (const line of prose.value.progress) {
    const entry = parseLegacyProgressLine(`- ${line}`);
    if (entry === null) {
      progress.push(line);
      continue;
    }
    progress.push(entry.text);
    history.push({
      at: entry.time,
      by: entry.by,
      action: "progress",
      note: historyNote(entry.text),
    });
  }
  // Filing is what the `Initiator` header recorded; its time is the first thing that happened.
  history.unshift({ at: history[0]?.at ?? "", by: initiator, action: "created" });
  return {
    ok: true,
    value: {
      title,
      status,
      owner,
      ...(parent !== "" ? { parent } : {}),
      notify,
      priority,
      ...(due !== "" ? { due } : {}),
      ...(blocked !== "" ? { blocked } : {}),
      ...(blockedBy !== "" ? { blockedBy } : {}),
      sessions,
      history,
      ...prose.value,
      progress,
      extra,
    },
  };
}

/** Ticket ids written before the letters-only slug rule, as legacy files still reference them. */
const LEGACY_TICKET_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// channels/<channel_id>/channel.toml
// ---------------------------------------------------------------------------

/**
 * A channel's intent file. `everyone` and `members` are the two shapes of membership
 * and exactly one of them applies: the all-hands channel is `everyone = true` (every
 * employee and every Project member, no list to keep), every other channel carries the
 * explicit list its members edit through the API.
 */
export interface ChannelConfig {
  name: string;
  purpose: string;
  /** `user:<id>` / `agent:<id>` / `system` (the all-hands channel, created with the organization). */
  createdBy: string;
  /** ISO 8601 UTC. */
  createdAt: string;
  /** An archived channel is read-only: no posts, no invitations, no membership changes. */
  archived: boolean;
  /** Explicit membership; absent on the all-hands channel. */
  members?: string[];
  /** True only on the all-hands channel: membership is implicit and there is no list. */
  everyone?: boolean;
}

/**
 * Parses a channel file. The channel id decides which membership shape is legal, so it is
 * an argument rather than a field: `everyone` belongs to the all-hands channel and to no
 * other, and every other channel must list its members.
 */
export function parseChannelConfig(channelId: string, raw: string): ParseResult<ChannelConfig> {
  const t = tomlTable(raw);
  if (!t.ok) return t;
  const table = t.value;
  const name = table["name"];
  if (typeof name !== "string" || name.trim() === "")
    return fail("name must be a non-empty string");
  const purpose = table["purpose"] ?? "";
  if (typeof purpose !== "string") return fail("purpose must be a string");
  const createdBy = table["created_by"];
  if (typeof createdBy !== "string" || (createdBy !== "system" && !isPersonPrincipal(createdBy))) {
    return fail("created_by must be agent:<id>, user:<id> or system");
  }
  const createdAtRaw = table["created_at"];
  const createdAt =
    createdAtRaw instanceof Date
      ? createdAtRaw.toISOString()
      : typeof createdAtRaw === "string"
        ? createdAtRaw
        : null;
  if (createdAt === null || Number.isNaN(Date.parse(createdAt)))
    return fail("created_at must be an instant");
  const archived = table["archived"] ?? false;
  if (typeof archived !== "boolean") return fail("archived must be a boolean");
  const everyone = table["everyone"] ?? false;
  if (typeof everyone !== "boolean") return fail("everyone must be a boolean");
  if (everyone !== (channelId === DEFAULT_CHANNEL_ID)) {
    return fail(
      everyone
        ? `everyone belongs to the all-hands channel ${DEFAULT_CHANNEL_ID} and to no other`
        : `the all-hands channel ${DEFAULT_CHANNEL_ID} must be everyone = true`,
    );
  }
  const rawMembers = table["members"];
  if (everyone) {
    if (rawMembers !== undefined) return fail("an everyone channel keeps no members list");
    return {
      ok: true,
      value: {
        name: name.trim(),
        purpose: purpose.trim(),
        createdBy,
        createdAt: new Date(createdAt).toISOString(),
        archived,
        everyone: true,
      },
    };
  }
  if (!Array.isArray(rawMembers)) return fail("members must be a list of principals");
  const members: string[] = [];
  for (const m of rawMembers) {
    if (typeof m !== "string" || !isPersonPrincipal(m))
      return fail(`members entry is not a principal: ${String(m)}`);
    if (members.includes(m)) return fail(`duplicate member: ${m}`);
    members.push(m);
  }
  return {
    ok: true,
    value: {
      name: name.trim(),
      purpose: purpose.trim(),
      createdBy,
      createdAt: new Date(createdAt).toISOString(),
      archived,
      members,
    },
  };
}

export function serializeChannelConfig(cfg: ChannelConfig): string {
  const table = {
    name: cfg.name,
    purpose: cfg.purpose,
    created_by: cfg.createdBy,
    created_at: cfg.createdAt,
    archived: cfg.archived,
    ...(cfg.everyone === true ? { everyone: true } : { members: cfg.members ?? [] }),
  };
  return [
    "# channel.toml — a channel (the id is the directory name under channels/).",
    "# members: agent:<id> / user:<id>; only members read and post, and only a member's",
    "# mention reaches a desk. everyone = true marks the all-hands channel instead: every",
    "# employee and every Project member belongs to it and there is no list to keep.",
    "# archived: read-only, folded away in the UI, until a person unarchives it.",
    stringifyToml(table),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// channels/<channel_id>/<yyyy-mm-dd>.jsonl
// ---------------------------------------------------------------------------

export const CHANNEL_MESSAGE_ID_PATTERN = /^msg-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;

export function parseChannelMessageLine(line: string): ParseResult<OrgChannelMessage> {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return fail("line is not JSON");
  }
  if (v === null || typeof v !== "object") return fail("line is not a JSON object");
  const o = v as Record<string, unknown>;
  if (typeof o["id"] !== "string" || !CHANNEL_MESSAGE_ID_PATTERN.test(o["id"]))
    return fail("id is not a message id");
  if (typeof o["time"] !== "string" || Number.isNaN(Date.parse(o["time"])))
    return fail("time is not an instant");
  if (typeof o["sender"] !== "string" || parsePrincipal(o["sender"]) === null)
    return fail("sender is not a principal");
  const hop = o["hop"];
  if (typeof hop !== "number" || !Number.isInteger(hop) || hop < 0)
    return fail("hop must be a non-negative integer");
  if (typeof o["text"] !== "string") return fail("text must be a string");
  const mentions = o["mentions"] ?? [];
  if (
    !Array.isArray(mentions) ||
    mentions.some((m) => typeof m !== "string" || parsePrincipal(m) === null)
  ) {
    return fail("mentions must be a list of principals");
  }
  let refs: OrgChannelMessage["refs"];
  if (o["refs"] !== undefined) {
    const r = o["refs"];
    if (r === null || typeof r !== "object") return fail("refs must be an object");
    const rr = r as Record<string, unknown>;
    refs = {
      ...(typeof rr["ticket"] === "string" ? { ticket: rr["ticket"] } : {}),
      ...(typeof rr["session"] === "string" ? { session: rr["session"] } : {}),
      ...(typeof rr["reply_to"] === "string" ? { replyTo: rr["reply_to"] } : {}),
    };
  }
  // The kind is taken as written rather than checked against the known list: a line a newer
  // server wrote still parses here, and a client that does not know the kind shows `text`.
  let notice: OrgChannelMessage["notice"];
  if (o["notice"] !== undefined) {
    const n = o["notice"];
    if (n === null || typeof n !== "object") return fail("notice must be an object");
    const nn = n as Record<string, unknown>;
    if (typeof nn["kind"] !== "string" || nn["kind"] === "")
      return fail("notice.kind must be a non-empty string");
    const params = nn["params"] ?? {};
    if (params === null || typeof params !== "object" || Array.isArray(params))
      return fail("notice.params must be an object");
    const entries = Object.entries(params as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string"))
      return fail("notice.params values must be strings");
    notice = {
      kind: nn["kind"] as OrgChannelNoticeKind,
      params: Object.fromEntries(entries) as Record<string, string>,
    };
  }
  return {
    ok: true,
    value: {
      id: o["id"],
      time: o["time"],
      sender: o["sender"],
      hop,
      text: o["text"],
      mentions: mentions as string[],
      ...(refs !== undefined && Object.keys(refs).length > 0 ? { refs } : {}),
      ...(notice !== undefined ? { notice } : {}),
    },
  };
}

export function serializeChannelMessageLine(msg: OrgChannelMessage): string {
  const refs =
    msg.refs === undefined
      ? undefined
      : {
          ...(msg.refs.ticket !== undefined ? { ticket: msg.refs.ticket } : {}),
          ...(msg.refs.session !== undefined ? { session: msg.refs.session } : {}),
          ...(msg.refs.replyTo !== undefined ? { reply_to: msg.refs.replyTo } : {}),
        };
  return JSON.stringify({
    id: msg.id,
    time: msg.time,
    sender: msg.sender,
    hop: msg.hop,
    text: msg.text,
    mentions: msg.mentions,
    ...(refs !== undefined && Object.keys(refs).length > 0 ? { refs } : {}),
    ...(msg.notice !== undefined ? { notice: msg.notice } : {}),
  });
}

export interface MentionToken {
  /** `agent` / `user` when the writer disambiguated, absent for the short form. */
  prefix?: "agent" | "user";
  /** The bare id, or `all`. */
  id: string;
}

/** The `@` tokens in a message: `@id`, `@agent:id`, `@user:id`, `@all`; who they resolve to is the service's call. */
export function extractMentionTokens(text: string): MentionToken[] {
  const out: MentionToken[] = [];
  const re = /(^|[^A-Za-z0-9_@])@(?:(agent|user):)?([A-Za-z0-9][A-Za-z0-9_.-]*)/g;
  for (const m of text.matchAll(re)) {
    const prefix = m[2] as "agent" | "user" | undefined;
    const id = m[3]!.replace(/[.-]+$/, "");
    if (id === "") continue;
    out.push({ ...(prefix !== undefined ? { prefix } : {}), id });
  }
  return out;
}
