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
 * Values the entry must not hold in plain text — a token in a header, a key in `env` — are
 * written as `${KEY}` references to the Agent's vault and substituted when the server
 * connects: the YAML, the config API and the Trace only ever carry the reference. A server
 * whose references the vault cannot fill is not connected but skipped as "needs setup", and
 * one that declares OAuth sign-in (`config.oauth`) without an `Authorization` header is
 * skipped as "sign-in required" — sign-in itself is not supported yet. `${PLUGIN_ROOT}` is
 * not a vault key: installing a plugin's server replaces it with the package's directory.
 *
 * Invalid entries never break Session creation: each problem is reported as a warning and
 * the entry is skipped (the same stance Environment takes on unrecognized builtin tool
 * names), so one typo in a hand-edited YAML cannot take the whole Agent down.
 * Docs: /docs/tools § "MCP servers".
 */
import type { MCPServerConfig, ToolPermission } from "../../interfaces/index.js";

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
  /**
   * The vault keys whose values were filled into this server's fields (names only). A failure
   * the server answers with can repeat what it was sent — a request line, a header, its own
   * environment on stderr — so the provider puts these references back in place of the values
   * in every error text it reports for the server.
   */
  vaultKeys?: string[];
}

/**
 * Why a valid entry is not connected: vault keys it references are missing (`keys`, names
 * only), or it wants an OAuth sign-in.
 */
export type MCPServerSkip =
  { reason: "needs_setup"; keys: string[] } | { reason: "sign_in_required" };

/** A valid entry that cannot connect yet: reported per server at every connect phase, never contacted. */
export interface SkippedMCPServer {
  name: string;
  transport: ResolvedMCPTransport["kind"];
  skip: MCPServerSkip;
}

/** Result of resolving a full `mcpServers` list: the servers to connect, the valid ones that cannot connect yet, and human-readable warnings for the invalid rest. */
export interface ResolveMCPServersResult {
  servers: ResolvedMCPServer[];
  skipped: SkippedMCPServer[];
  warnings: string[];
}

/** Server names embed into tool names (`mcp__<name>__<tool>`), so they stay in a filename-safe alphabet. */
export const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SERVER_NAME_PATTERN = MCP_SERVER_NAME_PATTERN;

/** A `${KEY}` reference to a vault value in an entry's string values; `KEY` follows the vault's key rule. Global: use it with `matchAll` / `replace`, never `test`. */
export const VAULT_REF_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Reserved reference to the directory of the plugin package that installed the entry, replaced at install time — never a vault key. */
export const PLUGIN_ROOT_REF = "${PLUGIN_ROOT}";
const PLUGIN_ROOT_KEY = "PLUGIN_ROOT";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `value` with `fn` applied to every string inside it (object values and array items, at any depth; keys untouched). */
export function mapConfigStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapConfigStrings(item, fn));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapConfigStrings(item, fn)]),
    );
  }
  return value;
}

/** Every distinct `${KEY}` referenced by any string value of `config`, in first-seen order (`${PLUGIN_ROOT}` excluded). */
export function collectVaultRefs(config: Record<string, unknown>): string[] {
  const keys: string[] = [];
  mapConfigStrings(config, (text) => {
    for (const match of text.matchAll(VAULT_REF_PATTERN)) {
      const key = match[1]!;
      if (key !== PLUGIN_ROOT_KEY && !keys.includes(key)) keys.push(key);
    }
    return text;
  });
  return keys;
}

/**
 * `config` with every `${KEY}` replaced by the vault's value, or the keys the vault does not
 * hold (then nothing is substituted: a server never connects with a literal placeholder). One
 * pass: a value that itself contains `${…}` is not read again. A config without references
 * comes back as the same object.
 */
export function substituteVaultRefs(
  config: Record<string, unknown>,
  vault: Readonly<Record<string, string>>,
): { config: Record<string, unknown> } | { missing: string[] } {
  const refs = collectVaultRefs(config);
  if (refs.length === 0) return { config };
  const missing = refs.filter((key) => !Object.hasOwn(vault, key));
  if (missing.length > 0) return { missing };
  return {
    config: mapConfigStrings(config, (text) =>
      text.replace(VAULT_REF_PATTERN, (whole, key: string) =>
        key === PLUGIN_ROOT_KEY ? whole : vault[key]!,
      ),
    ) as Record<string, unknown>,
  };
}

/**
 * Whether an entry's string values are read as `${KEY}` vault references. Every entry, the
 * hand-written ones included: one rule wherever the entry came from (a plugin's install or
 * the user's own edit).
 */
export function readsVaultReferences(_entry: MCPServerConfig): boolean {
  return true;
}

/**
 * Whether an entry needs an OAuth sign-in before it can connect: it declares `oauth` and sends
 * no `Authorization` header of its own (a bearer token in the vault is the alternative a
 * server may offer). Sign-in is not supported yet, so such an entry is skipped.
 */
export function needsSignIn(config: Record<string, unknown>): boolean {
  if (config["oauth"] === undefined) return false;
  const headers = config["headers"];
  return !(
    isRecord(headers) && Object.keys(headers).some((key) => key.toLowerCase() === "authorization")
  );
}

/** The human-readable reason of a skip — key names only, never a value. */
export function mcpSkipMessage(skip: MCPServerSkip): string {
  if (skip.reason === "sign_in_required") {
    return "requires OAuth sign-in, which this version does not support yet";
  }
  return skip.keys.length === 1
    ? `needs setup: vault key ${skip.keys[0]} is not set`
    : `needs setup: vault keys ${skip.keys.join(", ")} are not set`;
}

/**
 * Whether a URL's `${KEY}` references reach its authority — the user info, the host or the
 * port — rather than its path, query or fragment. Decided the way the connection reads the
 * address: by the URL parser, given two different stand-ins for every reference, so no spelling
 * slips past (`https:${KEY}` without slashes, backslashes, a tab or a space the parser drops).
 */
function referencesReachAuthority(url: string): boolean {
  const authority = (standIn: string): string | null => {
    try {
      const parsed = new URL(url.replace(VAULT_REF_PATTERN, standIn));
      return `${parsed.username}:${parsed.password}@${parsed.host}`;
    } catch {
      return null;
    }
  };
  return authority("a") !== authority("b");
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
    // A vault reference decides a value sent to the server, never which server is contacted:
    // the address stays as written (a path or a query may still take one).
    if (referencesReachAuthority(url)) {
      throw new Error(`"url" cannot take a \${KEY} vault reference in its host`);
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
 * Resolves a whole `mcpServers` list against the Agent's vault: invalid entries and duplicate
 * names become warnings and are dropped; a valid entry whose references the vault cannot fill,
 * or that needs an OAuth sign-in, is `skipped`; the rest come back typed — references
 * substituted — and ready to connect. An entry is validated with its references as written (a
 * reference belongs in a header, `env`, `args` or `oauth`, never in the address), then
 * resolved again with the values.
 */
export function resolveMCPServers(
  entries: MCPServerConfig[],
  vault: Readonly<Record<string, string>> = {},
): ResolveMCPServersResult {
  const servers: ResolvedMCPServer[] = [];
  const skipped: SkippedMCPServer[] = [];
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
    const { name } = resolved;
    if (seen.has(name)) {
      warnings.push(`MCP server "${name}" skipped: duplicate server name`);
      continue;
    }
    seen.add(name);
    const transport = resolved.transport.kind;
    let config = entry.config;
    if (readsVaultReferences(entry)) {
      const substituted = substituteVaultRefs(entry.config, vault);
      if ("missing" in substituted) {
        skipped.push({
          name,
          transport,
          skip: { reason: "needs_setup", keys: substituted.missing },
        });
        continue;
      }
      config = substituted.config;
    }
    if (needsSignIn(config)) {
      skipped.push({ name, transport, skip: { reason: "sign_in_required" } });
      continue;
    }
    if (config !== entry.config) {
      try {
        resolved = {
          ...resolveMCPServer({ ...entry, config }),
          vaultKeys: collectVaultRefs(entry.config),
        };
      } catch {
        // The resolver's reason would quote the value it refused, a vault value among them.
        warnings.push(
          `MCP server "${name}" skipped: invalid once its vault references are filled in`,
        );
        continue;
      }
    }
    servers.push(resolved);
  }
  return { servers, skipped, warnings };
}
