/**
 * MCP Server config resolution — turns the open `MCPServerConfig.config` object stored in
 * `system_config.yaml` (`tools.mcpServers[]`) into a typed transport description.
 *
 * The stored shape stays `{ name, config }` (the seam pinned by the architecture spec): the
 * inner `config` is schema-free at the interface layer and only interpreted here, at
 * Environment assembly time. Three transports are supported:
 *
 * - `stdio` — spawn a local server process and speak MCP over stdin/stdout
 *   (`command` / `args` / `env` / `cwd`);
 * - `http` — Streamable HTTP, the current spec's remote transport (`url` / `headers`);
 * - `sse` — the legacy HTTP+SSE transport, kept for servers that have not migrated
 *   (`url` / `headers`).
 *
 * `transport` may be omitted when unambiguous: an entry with `command` resolves to `stdio`,
 * an entry with `url` resolves to `http`; `sse` must always be explicit.
 *
 * `permission` sets the approval level PenguinHarness applies to every tool of the server —
 * `"auto"` (the default) trusts each tool's own `readOnlyHint`, `"r"` or `"rw"` overrides it.
 *
 * Invalid entries never break Session creation: each problem is reported as a warning and
 * the entry is skipped (the same stance Environment takes on unrecognized builtin tool
 * names), so one typo in a hand-edited YAML cannot take the whole Agent down.
 * Docs: /docs/tools § "MCP servers".
 */
import type { MCPServerConfig, ToolPermission } from "../../interfaces.js";

/** Default per-server budget for connecting + initial handshake (ms). */
export const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 10_000;

/**
 * How a server's tools get their permission: `"auto"` trusts each tool's `readOnlyHint`
 * annotation, an explicit level applies to every tool of the server regardless of what it
 * advertises.
 */
export type MCPServerPermissionMode = "auto" | ToolPermission;

/** Permission mode of an entry that does not set one. */
export const DEFAULT_MCP_PERMISSION: MCPServerPermissionMode = "auto";

/** Typed transport description resolved from one `mcpServers` entry. */
export type ResolvedMCPTransport =
  | {
      kind: "stdio";
      command: string;
      args: string[];
      /** Extra environment variables for the server process (spread over the SDK's safe defaults; the Agent vault is not injected). */
      env?: Record<string, string>;
      /** Server process working directory; defaults to the Session's Workspace. */
      cwd?: string;
    }
  | { kind: "http"; url: string; headers?: Record<string, string> }
  | { kind: "sse"; url: string; headers?: Record<string, string> };

/** One validated MCP Server ready for the provider to connect. */
export interface ResolvedMCPServer {
  /** Server name; scopes its tools as `mcp__<name>__<tool>`. */
  name: string;
  transport: ResolvedMCPTransport;
  /** Budget for connect + handshake + tool discovery, per server (ms). */
  connectTimeoutMs: number;
  /** Per-call execution timeout applied to every tool of this server (Environment default when unset). */
  timeoutMs?: number;
  /** Output cap applied to every tool of this server (Environment default when unset). */
  maxOutputLength?: number;
  /**
   * Permission forced onto every tool of this server. Unset means `"auto"`: each tool keeps
   * the permission its own `readOnlyHint` annotation implies.
   */
  permission?: ToolPermission;
}

/** Result of resolving a full `mcpServers` list: valid servers plus human-readable warnings for the skipped rest. */
export interface ResolveMCPServersResult {
  servers: ResolvedMCPServer[];
  warnings: string[];
}

/** Server names embed into tool names (`mcp__<name>__<tool>`), so they stay in a filename-safe alphabet. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reads an optional string-to-string map field (env / headers); null = invalid. */
function readStringMap(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") return null;
    out[k] = v;
  }
  return out;
}

/** Reads an optional positive-integer field (ms budgets, char caps); null = invalid, undefined = absent. */
function readPositiveInt(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/**
 * Reads the optional permission mode; `undefined` (absent or `"auto"`) leaves every tool to
 * its own annotation, `null` = invalid.
 */
function readPermission(value: unknown): ToolPermission | undefined | null {
  const mode: unknown = value === undefined ? DEFAULT_MCP_PERMISSION : value;
  if (mode === "auto") return undefined;
  if (mode === "r" || mode === "rw") return mode;
  return null;
}

/**
 * Resolves one entry; throws with a human-readable reason on an invalid one (the caller
 * turns it into a warning and skips the entry).
 */
export function resolveMCPServer(entry: MCPServerConfig): ResolvedMCPServer {
  const name = entry.name;
  if (typeof name !== "string" || !SERVER_NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid server name ${JSON.stringify(name)} (letters, digits, "_" and "-" only)`,
    );
  }
  const config = entry.config;
  if (!isRecord(config)) {
    throw new Error(`"config" must be an object`);
  }

  const explicit = config["transport"];
  if (explicit !== undefined && explicit !== "stdio" && explicit !== "http" && explicit !== "sse") {
    throw new Error(
      `unknown transport ${JSON.stringify(explicit)} (expected "stdio", "http" or "sse")`,
    );
  }
  // Inference when unambiguous: command => stdio, url => http; sse stays explicit.
  const kind =
    explicit ??
    (typeof config["command"] === "string"
      ? "stdio"
      : typeof config["url"] === "string"
        ? "http"
        : undefined);
  if (kind === undefined) {
    throw new Error(`cannot infer transport: set "transport", or provide "command" / "url"`);
  }

  let transport: ResolvedMCPTransport;
  if (kind === "stdio") {
    const command = config["command"];
    if (typeof command !== "string" || command.trim() === "") {
      throw new Error(`stdio transport requires a non-empty "command"`);
    }
    const rawArgs = config["args"];
    if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
      throw new Error(`"args" must be an array of strings`);
    }
    const args = (rawArgs ?? []) as unknown[];
    if (!args.every((a): a is string => typeof a === "string")) {
      throw new Error(`"args" must be an array of strings`);
    }
    const env = readStringMap(config["env"]);
    if (env === null) throw new Error(`"env" must be a map of string values`);
    const cwd = config["cwd"];
    if (cwd !== undefined && typeof cwd !== "string") {
      throw new Error(`"cwd" must be a string`);
    }
    transport = {
      kind,
      command,
      args,
      ...(env !== undefined ? { env } : {}),
      ...(cwd !== undefined ? { cwd } : {}),
    };
  } else {
    const url = config["url"];
    if (typeof url !== "string") {
      throw new Error(`${kind} transport requires a "url"`);
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`"url" is not a valid URL: ${JSON.stringify(url)}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`"url" must use http(s), got ${JSON.stringify(parsed.protocol)}`);
    }
    const headers = readStringMap(config["headers"]);
    if (headers === null) throw new Error(`"headers" must be a map of string values`);
    transport = { kind, url, ...(headers !== undefined ? { headers } : {}) };
  }

  const connectTimeoutMs = readPositiveInt(config["connectTimeoutMs"]);
  if (connectTimeoutMs === null) {
    throw new Error(`"connectTimeoutMs" must be a positive number of milliseconds`);
  }
  const timeoutMs = readPositiveInt(config["timeoutMs"]);
  if (timeoutMs === null) throw new Error(`"timeoutMs" must be a positive number of milliseconds`);
  const maxOutputLength = readPositiveInt(config["maxOutputLength"]);
  if (maxOutputLength === null) throw new Error(`"maxOutputLength" must be a positive number`);
  const permission = readPermission(config["permission"]);
  if (permission === null) {
    throw new Error(`"permission" must be "auto", "r" or "rw"`);
  }

  return {
    name,
    transport,
    connectTimeoutMs: connectTimeoutMs ?? DEFAULT_MCP_CONNECT_TIMEOUT_MS,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxOutputLength !== undefined ? { maxOutputLength } : {}),
    ...(permission !== undefined ? { permission } : {}),
  };
}

/**
 * Resolves a whole `mcpServers` list: invalid entries and duplicate names become warnings
 * and are skipped; the rest come back typed and ready to connect.
 */
export function resolveMCPServers(entries: MCPServerConfig[]): ResolveMCPServersResult {
  const servers: ResolvedMCPServer[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    let resolved: ResolvedMCPServer;
    try {
      resolved = resolveMCPServer(entry);
    } catch (err) {
      const label = typeof entry?.name === "string" ? entry.name : JSON.stringify(entry?.name);
      warnings.push(
        `MCP server "${label}" skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (seen.has(resolved.name)) {
      warnings.push(`MCP server "${resolved.name}" skipped: duplicate server name`);
      continue;
    }
    seen.add(resolved.name);
    servers.push(resolved);
  }
  return { servers, warnings };
}
