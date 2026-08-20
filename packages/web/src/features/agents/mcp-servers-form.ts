/**
 * MCP Server form helpers — conversion between the structured Add/Edit form and the
 * stored `tools.mcpServers` entries (`{ name, config }`).
 *
 * The form covers the known transport fields; unknown `config` keys an entry may carry
 * (hand-written YAML, future fields) ride along in `extras` and are merged back on save,
 * so the form never destroys what it does not understand. Validation errors come back as
 * codes (plus a line number for the multiline fields); the component maps them to
 * localized messages.
 */
import type { MCPServerConfig, ToolPermission } from "@prismshadow/penguin-core/interfaces";

export type McpTransportKind = "stdio" | "http" | "sse";

/**
 * Permission setting of one server: `"auto"` leaves every tool to the `readOnlyHint` it
 * advertises, an explicit level applies to all of them instead.
 */
export type McpPermissionMode = "auto" | ToolPermission;

/** Permission mode of an entry that does not set one (core's DEFAULT_MCP_PERMISSION). */
export const MCP_PERMISSION_DEFAULT: McpPermissionMode = "auto";

/** Editable string state backing the Add/Edit modal (multiline fields stay raw text). */
export interface McpServerFormState {
  name: string;
  transport: McpTransportKind;
  command: string;
  /** One argument per line (blank lines ignored). */
  argsText: string;
  /** One `KEY=value` per line. */
  envText: string;
  cwd: string;
  url: string;
  /** One `Header-Name: value` per line. */
  headersText: string;
  connectTimeoutMs: string;
  timeoutMs: string;
  maxOutputLength: string;
  permission: McpPermissionMode;
  /** Unrecognized config keys of the entry being edited; merged back verbatim on save. */
  extras: Record<string, unknown>;
}

export type McpFormField =
  | "name"
  | "command"
  | "url"
  | "env"
  | "headers"
  | "connectTimeoutMs"
  | "timeoutMs"
  | "maxOutputLength";

export type McpFormErrorCode =
  | "required"
  | "name_charset"
  | "url_invalid"
  | "kv_line"
  | "number"
  /** Same-name collision against the other configured entries (set by the section, not formToServer). */
  | "duplicate";

export interface McpFormError {
  code: McpFormErrorCode;
  /** 1-based offending line for `kv_line` errors. */
  line?: number;
}

export type McpFormResult =
  | { ok: true; server: MCPServerConfig }
  | { ok: false; errors: Partial<Record<McpFormField, McpFormError>> };

/** Same server-name alphabet the core resolver enforces (`mcp__<name>__<tool>` prefix). */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Effective defaults for the budget fields, shown prefilled in the form instead of empty
 * boxes. Pinned to core's values: DEFAULT_MCP_CONNECT_TIMEOUT_MS
 * (core environment/mcp/config.ts), DEFAULT_TOOL_TIMEOUT_MS and
 * DEFAULT_MAX_OUTPUT_LENGTH (core environment/environment.ts) — re-declared here because
 * importing core's runtime into the browser bundle is off the table. A saved value equal
 * to its default is NOT written to the entry (the stored config keeps following future
 * default changes).
 */
export const MCP_BUDGET_DEFAULTS = {
  connectTimeoutMs: 10_000,
  timeoutMs: 120_000,
  maxOutputLength: 16_000,
} as const;

const KNOWN_CONFIG_KEYS = new Set([
  "transport",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "connectTimeoutMs",
  "timeoutMs",
  "maxOutputLength",
  "permission",
]);

export function emptyMcpForm(): McpServerFormState {
  return {
    name: "",
    // The Add modal opens on http: remote servers are the common case, and a URL field is
    // the gentler first impression than command/args.
    transport: "http",
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    url: "",
    headersText: "",
    connectTimeoutMs: String(MCP_BUDGET_DEFAULTS.connectTimeoutMs),
    timeoutMs: String(MCP_BUDGET_DEFAULTS.timeoutMs),
    maxOutputLength: String(MCP_BUDGET_DEFAULTS.maxOutputLength),
    permission: MCP_PERMISSION_DEFAULT,
    extras: {},
  };
}

function mapToLines(value: unknown, sep: string): string {
  if (value === null || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}${sep}${String(v)}`)
    .join("\n");
}

/** Effective transport of a stored entry (same inference as the core resolver: explicit wins, else url → http, command → stdio). */
export function transportOf(entry: MCPServerConfig): McpTransportKind {
  const c = entry.config;
  return c["transport"] === "http" || c["transport"] === "sse" || c["transport"] === "stdio"
    ? c["transport"]
    : typeof c["url"] === "string"
      ? "http"
      : "stdio";
}

/** Effective permission mode of a stored entry (an unrecognized value reads as the default). */
export function permissionOf(entry: MCPServerConfig): McpPermissionMode {
  const p = entry.config["permission"];
  return p === "r" || p === "rw" || p === "auto" ? p : MCP_PERMISSION_DEFAULT;
}

/** Loads a stored entry into form state (tolerates loosely-shaped configs). */
export function serverToForm(entry: MCPServerConfig): McpServerFormState {
  const c = entry.config;
  const transport = transportOf(entry);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (!KNOWN_CONFIG_KEYS.has(k)) extras[k] = v;
  }
  return {
    name: entry.name,
    transport,
    command: typeof c["command"] === "string" ? c["command"] : "",
    argsText: Array.isArray(c["args"]) ? c["args"].map((a) => String(a)).join("\n") : "",
    envText: mapToLines(c["env"], "="),
    cwd: typeof c["cwd"] === "string" ? c["cwd"] : "",
    url: typeof c["url"] === "string" ? c["url"] : "",
    headersText: mapToLines(c["headers"], ": "),
    // Unset budgets show their effective default (a real number beats an empty box);
    // saving that number back is normalized away (see formToServer).
    connectTimeoutMs: String(
      typeof c["connectTimeoutMs"] === "number"
        ? c["connectTimeoutMs"]
        : MCP_BUDGET_DEFAULTS.connectTimeoutMs,
    ),
    timeoutMs: String(
      typeof c["timeoutMs"] === "number" ? c["timeoutMs"] : MCP_BUDGET_DEFAULTS.timeoutMs,
    ),
    maxOutputLength: String(
      typeof c["maxOutputLength"] === "number"
        ? c["maxOutputLength"]
        : MCP_BUDGET_DEFAULTS.maxOutputLength,
    ),
    permission: permissionOf(entry),
    extras,
  };
}

/** Parses `KEY<sep>value` lines; blank lines are skipped; returns the 1-based bad line on failure. */
export function parseKeyValueLines(
  text: string,
  sep: "=" | ":",
): { ok: true; map: Record<string, string> } | { ok: false; line: number } {
  const map: Record<string, string> = {};
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const at = line.indexOf(sep);
    const key = at >= 0 ? line.slice(0, at).trim() : "";
    if (at < 0 || key === "") return { ok: false, line: i + 1 };
    map[key] = line.slice(at + 1).trim();
  }
  return { ok: true, map };
}

function parseBudget(
  text: string,
): { ok: true; value: number | undefined } | { ok: false; error: McpFormError } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return { ok: false, error: { code: "number" } };
  return { ok: true, value: n };
}

/** Validates form state and builds the `{ name, config }` entry (extras merged back first, so known fields win). */
export function formToServer(form: McpServerFormState): McpFormResult {
  const errors: Partial<Record<McpFormField, McpFormError>> = {};
  const name = form.name.trim();
  if (name === "") errors.name = { code: "required" };
  else if (!SERVER_NAME_PATTERN.test(name)) errors.name = { code: "name_charset" };

  const config: Record<string, unknown> = { ...form.extras, transport: form.transport };
  if (form.transport === "stdio") {
    const command = form.command.trim();
    if (command === "") errors.command = { code: "required" };
    else config["command"] = command;
    const args = form.argsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (args.length > 0) config["args"] = args;
    const env = parseKeyValueLines(form.envText, "=");
    if (!env.ok) errors.env = { code: "kv_line", line: env.line };
    else if (Object.keys(env.map).length > 0) config["env"] = env.map;
    const cwd = form.cwd.trim();
    if (cwd !== "") config["cwd"] = cwd;
  } else {
    const url = form.url.trim();
    if (url === "") errors.url = { code: "required" };
    else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors.url = { code: "url_invalid" };
        } else {
          config["url"] = url;
        }
      } catch {
        errors.url = { code: "url_invalid" };
      }
    }
    const headers = parseKeyValueLines(form.headersText, ":");
    if (!headers.ok) errors.headers = { code: "kv_line", line: headers.line };
    else if (Object.keys(headers.map).length > 0) config["headers"] = headers.map;
  }

  for (const field of ["connectTimeoutMs", "timeoutMs", "maxOutputLength"] as const) {
    const parsed = parseBudget(form[field]);
    if (!parsed.ok) errors[field] = parsed.error;
    // A value equal to the effective default is not written: the entry keeps following
    // future default changes instead of pinning today's number.
    else if (parsed.value !== undefined && parsed.value !== MCP_BUDGET_DEFAULTS[field]) {
      config[field] = parsed.value;
    }
  }

  // Same normalization as the budgets: the default is not written, so the entry keeps
  // following the default rather than pinning today's value.
  if (form.permission !== MCP_PERMISSION_DEFAULT) config["permission"] = form.permission;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, server: { name, config } };
}
