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
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";

export type McpTransportKind = "stdio" | "http" | "sse";

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

export type McpFormErrorCode = "required" | "name_charset" | "url_invalid" | "kv_line" | "number";

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
    connectTimeoutMs: "",
    timeoutMs: "",
    maxOutputLength: "",
    extras: {},
  };
}

function mapToLines(value: unknown, sep: string): string {
  if (value === null || typeof value !== "object") return "";
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${k}${sep}${String(v)}`)
    .join("\n");
}

/** Loads a stored entry into form state (tolerates loosely-shaped configs). */
export function serverToForm(entry: MCPServerConfig): McpServerFormState {
  const c = entry.config;
  const transport =
    c["transport"] === "http" || c["transport"] === "sse" || c["transport"] === "stdio"
      ? c["transport"]
      : typeof c["url"] === "string"
        ? "http"
        : "stdio";
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
    connectTimeoutMs:
      typeof c["connectTimeoutMs"] === "number" ? String(c["connectTimeoutMs"]) : "",
    timeoutMs: typeof c["timeoutMs"] === "number" ? String(c["timeoutMs"]) : "",
    maxOutputLength: typeof c["maxOutputLength"] === "number" ? String(c["maxOutputLength"]) : "",
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
    else if (parsed.value !== undefined) config[field] = parsed.value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, server: { name, config } };
}
