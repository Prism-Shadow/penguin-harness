/**
 * McpToolProvider — connects the configured MCP Servers and bridges their tools into
 * Environment as BuiltinTool instances.
 *
 * Naming: direct exposure presents every MCP tool as `mcp__<server>__<tool>`, which keeps the
 * flat tool namespace collision-free. Gateway exposure keeps only `search_tools` / `call_tool`
 * in the LLM schema and carries the target name inside a versioned reference. In full lazy mode,
 * Environment registers built-in tools in the same private catalog.
 *
 * Lifecycle: connection and tool discovery are lazy and happen exactly once per Environment
 * (single-flight) — `Environment.listTools()` at Session assembly triggers it; all servers
 * connect in parallel, each bounded by its `connectTimeoutMs`. A server that fails to
 * connect (or an invalid config entry) is reported as a stderr warning and skipped — MCP
 * problems never break Session creation, matching Environment's stance on unrecognized
 * builtin tool names. Direct exposure keeps a session-lifetime snapshot. Auto makes one decision
 * from the initial MCP Schema estimate and freezes it. Gateway exposure refreshes only its
 * private catalog on `tools/list_changed`; its two model-visible schemas never change.
 *
 * Execution: a call is bridged to `client.callTool` with the Environment-merged abort
 * signal passed through. The SDK's own per-request timeout is pushed out of the way
 * (`MAX_SDK_TIMEOUT_MS`) so Environment stays the single timekeeper — its per-tool
 * `timeoutMs` (server entry override or Environment default) aborts the signal, which
 * cancels the in-flight request. Result content maps as: text blocks → output text; image
 * blocks → `images` data URLs; audio/binary-resource blocks → placeholder lines;
 * `structuredContent` is serialized only when no text block was present; `isError` →
 * `stopReason: "failed"`. Permission for the frontend's read-only mode comes from the
 * spec's `readOnlyHint` annotation (`true` → `"r"`, anything else → `"rw"` — hints are
 * untrusted, so the default is the restrictive direction).
 * Docs: /docs/tools § "MCP servers".
 */
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult, FetchLike, Tool, Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { McpServerConnectResult, OmniMessage } from "../../omnimessage/index.js";
import { VERSION } from "../../index.js";
import type {
  MCPServerConfig,
  ToolExposure,
  ToolDefinition,
  ToolPermission,
} from "../../interfaces.js";
import { approximateTokens } from "../../llm/context-limits.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "../tools/types.js";
import { searchToolCatalog } from "../tool-catalog.js";
import { resolveMCPServers, type ResolvedMCPServer } from "./config.js";

/** Prefix marking a tool as MCP-provided; the full form is `mcp__<server>__<tool>`. */
export const MCP_TOOL_PREFIX = "mcp__";

/** Fixed private-catalog search tool used by adaptive and lazy exposure. */
export const TOOL_SEARCH_NAME = "search_tools";

/** Fixed execution gateway for references returned by {@link TOOL_SEARCH_NAME}. */
export const TOOL_CALL_NAME = "call_tool";

const TOOL_SEARCH_DEFINITION = {
  name: TOOL_SEARCH_NAME,
  description:
    "Search configured tools that are not exposed as native model tools. Results include a " +
    "versioned tool_ref and the input schema required by call_tool. If a search " +
    "returns no matches, do not retry synonymous queries without new information.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Capability, service, tool name, or parameter to search for.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "Maximum matches to return; defaults to 5.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  permission: "r" as const,
};

const TOOL_CALL_DEFINITION = {
  name: TOOL_CALL_NAME,
  description:
    "Execute a tool returned by search_tools. Copy tool_ref and tool_name exactly, " +
    "and construct arguments according to its input_schema.",
  parameters: {
    type: "object",
    properties: {
      tool_ref: {
        type: "string",
        description: "Versioned tool reference returned by search_tools.",
      },
      tool_name: {
        type: "string",
        description: "Human-readable tool name returned with tool_ref.",
      },
      arguments: {
        type: "object",
        description: "Arguments matching the input_schema returned for this tool_ref.",
        additionalProperties: true,
      },
    },
    required: ["tool_ref", "tool_name", "arguments"],
    additionalProperties: false,
  },
  // This is only a conservative fallback. Approval resolves the referenced tool's actual
  // permission before deciding whether a call can be auto-approved.
  permission: "rw" as const,
};

interface ToolBinding {
  sourceId: string;
  definition: ToolDefinition;
  tool: BuiltinTool;
  /** Extra contract material, such as an MCP output schema, included in the versioned ref. */
  contract?: unknown;
}

interface ToolDispatchTarget extends ToolBinding {
  ref: string;
  schemaDigest: string;
  validate: ValidateFunction;
}

type ToolStaleReason =
  "tool_removed" | "schema_changed" | "permission_changed" | "contract_changed";

interface ToolStaleReference {
  sourceId: string;
  toolName: string;
  reason: ToolStaleReason;
  replacement?: ToolDispatchTarget;
}

export type ToolDispatchResolution =
  | { kind: "resolved"; tool: BuiltinTool; args: Record<string, unknown>; name: string }
  | { kind: "failed"; message: string };

/** JSON value with recursively sorted object keys, used as the stable digest input. */
function canonicalJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function modelDefinition(definition: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  };
}

function dispatchFailure(
  code: string,
  message: string,
  options?: {
    retryable?: boolean;
    details?: Array<{ path: string; message: string; keyword: string }>;
    metadata?: Record<string, unknown>;
  },
): ToolDispatchResolution {
  return {
    kind: "failed",
    message: JSON.stringify(
      {
        error: code,
        message,
        retryable: options?.retryable ?? code === "invalid_tool_arguments",
        ...(options?.details && options.details.length > 0 ? { details: options.details } : {}),
        ...options?.metadata,
      },
      null,
      2,
    ),
  };
}

function validationDetails(errors: ErrorObject[] | null | undefined): Array<{
  path: string;
  message: string;
  keyword: string;
}> {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    message: error.message ?? "does not match the tool schema",
    keyword: error.keyword,
  }));
}

/** Builds the LLM-visible name of an MCP tool. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

/**
 * What LLM APIs accept as a native tool name (the strictest common contract:
 * `[a-zA-Z0-9_-]`, ≤128 chars). MCP itself does not restrict names. Direct exposure skips
 * incompatible names because one bad schema would reject every Request; lazy dispatch carries
 * them as ordinary string data and can therefore keep them in its private catalog.
 */
const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Largest delay setTimeout can represent (~24.8 days): used as the SDK per-request timeout
 * so it never fires before Environment's own tool timeout, which is the single authority
 * (it aborts the shared signal; a larger value would overflow to an immediate fire).
 */
const MAX_SDK_TIMEOUT_MS = 2_147_483_647;

/** Rolling stderr tail kept per stdio server for connect-failure diagnostics (chars). */
const STDERR_TAIL_LIMIT = 2048;

/**
 * MCP handshake client info; informational only (shows up in server logs). A function,
 * not a const: the VERSION import is circular (index → agent → environment → here), so
 * the live binding must be read at connect time, after every module has evaluated —
 * a top-level read would hit the temporal dead zone.
 */
function clientInfo(): { name: string; version: string } {
  return { name: "penguin-harness", version: VERSION };
}

export interface McpToolProviderOptions {
  /** Session Workspace: the default working directory for stdio server processes. */
  workspaceDir?: string;
  /** Warning sink; defaults to a `[penguin]`-prefixed stderr line. */
  warn?: (message: string) => void;
  /** Model-facing exposure policy; missing preserves the historical direct mode. */
  exposure?: ToolExposure;
  /** Built-in tools included in the private catalog when every tool is lazy. */
  catalogTools?: Array<{ definition: ToolDefinition; tool: BuiltinTool }>;
}

/** One connected server: its client plus the tools discovered on it. */
interface McpConnection {
  server: ResolvedMCPServer;
  client: Client;
  tools: Tool[];
  catalogReady: boolean;
  refreshRequested: boolean;
  refreshPromise: Promise<void> | null;
}

/** Bounds invalid references retained for actionable stale-reference errors. */
const MAX_STALE_TOOL_REFS = 512;

/** Auto mode switches the MCP portion to the gateway above this initial schema estimate. */
export const DEFAULT_TOOL_EXPOSURE_THRESHOLD_TOKENS = 2048;

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Wraps global fetch to add the configured headers to every request (stream GET and POSTs alike). */
function fetchWithHeaders(headers: Record<string, string>): FetchLike {
  return (url, init) => {
    const merged = new Headers(init?.headers);
    for (const [key, value] of Object.entries(headers)) {
      if (!merged.has(key)) merged.set(key, value);
    }
    return fetch(url, { ...init, headers: merged });
  };
}

/**
 * Flattens a CallToolResult into Environment's output shape: joined text plus data-URL
 * images. Defensive against loosely-shaped blocks — an unknown block type becomes a
 * placeholder line instead of an exception.
 */
export function renderCallToolResult(result: CallToolResult): { text: string; images: string[] } {
  const parts: string[] = [];
  const images: string[] = [];
  for (const block of result.content ?? []) {
    const b = block as Record<string, unknown>;
    switch (b["type"]) {
      case "text":
        if (typeof b["text"] === "string") parts.push(b["text"]);
        break;
      case "image":
        images.push(`data:${String(b["mimeType"])};base64,${String(b["data"])}`);
        break;
      case "audio":
        parts.push(`[audio content: ${String(b["mimeType"])}]`);
        break;
      case "resource_link":
        parts.push(
          `[resource: ${String(b["uri"])}]` +
            (typeof b["description"] === "string" ? ` ${b["description"]}` : ""),
        );
        break;
      case "resource": {
        const resource = b["resource"] as Record<string, unknown> | undefined;
        if (resource && typeof resource["text"] === "string") {
          parts.push(resource["text"]);
        } else {
          parts.push(`[resource: ${String(resource?.["uri"] ?? "unknown")} (binary)]`);
        }
        break;
      }
      default:
        parts.push(`[unsupported content type: ${String(b["type"])}]`);
    }
  }
  let text = parts.join("\n");
  // Servers with an outputSchema may return structured output only; serialize it rather
  // than handing the model an empty result (when text blocks exist they already carry the
  // serialized form per spec guidance, so this stays duplication-free).
  if (text === "" && result.structuredContent !== undefined) {
    text = JSON.stringify(result.structuredContent, null, 2);
  }
  return { text, images };
}

export class McpToolProvider {
  private readonly servers: ResolvedMCPServer[];
  private readonly configWarnings: string[];
  private readonly workspaceDir: string | undefined;
  private readonly warn: (message: string) => void;
  private readonly exposure: ToolExposure;
  /** Auto is resolved once after initial discovery and remains fixed for the Session. */
  private autoUsesGateway: boolean | null = null;
  private readonly catalogTools: Array<{ definition: ToolDefinition; tool: BuiltinTool }>;
  private readonly staticTargetNames: string[] = [];
  private readonly searchTool: BuiltinTool;
  private readonly callTool: BuiltinTool;
  /** Created only when gateway exposure registers its first tool; direct mode pays no AJV setup cost. */
  private schemaValidator: Ajv2020 | null = null;
  /** Single-flight connect+discovery; resolved results live in the fields below. */
  private ensurePromise: Promise<void> | null = null;
  /** Attempt token + abort handle of the in-flight connect; cancelConnect() invalidates the token so a cancelled attempt registers nothing. */
  private attempt = 0;
  private connectAbort: AbortController | null = null;
  /** Successfully connected servers, kept for close(). */
  private readonly connections: McpConnection[] = [];
  /** Full tool name (`mcp__server__tool`) → executable wrapper. */
  private readonly byName = new Map<string, BuiltinTool>();
  /** Active content-addressed references in the private tool catalog. */
  private readonly byRef = new Map<string, ToolDispatchTarget>();
  private readonly targetByName = new Map<string, ToolDispatchTarget>();
  /** Recently invalidated references, retained so callers receive an actionable error. */
  private readonly staleByRef = new Map<string, ToolStaleReference>();
  /** Private catalog revision; diagnostic only and never enters the model tool schemas. */
  private catalogGeneration = 0;
  /** LLM-facing definitions in stable server-config order. */
  private defs: ToolDefinition[] = [];
  /** Per-server connect outcomes (config order), populated by the single-flight connect; feeds the mcp_connect_end event. */
  private results: McpServerConnectResult[] = [];
  private closed = false;

  constructor(entries: MCPServerConfig[], options?: McpToolProviderOptions) {
    const resolved = resolveMCPServers(entries);
    this.servers = resolved.servers;
    this.configWarnings = resolved.warnings;
    this.workspaceDir = options?.workspaceDir;
    this.warn = options?.warn ?? ((message) => process.stderr.write(`[penguin] ${message}\n`));
    this.exposure = options?.exposure ?? "direct";
    this.catalogTools = options?.catalogTools ?? [];
    const provider = this;
    this.searchTool = {
      name: TOOL_SEARCH_NAME,
      definition: TOOL_SEARCH_DEFINITION,
      execute: async function* (
        args: Record<string, unknown>,
        ctx: ToolExecutionContext,
      ): AsyncGenerator<OmniMessage, ToolResult> {
        await provider.awaitCatalogRefresh();
        const query = typeof args["query"] === "string" ? args["query"].trim() : "";
        if (query === "") {
          yield partialToolCallOutput({
            eventType: "delta",
            output: "[tool search requires a non-empty `query`]",
            toolCallId: ctx.toolCallId,
          });
          return { stopReason: "failed" };
        }
        const requestedLimit =
          typeof args["limit"] === "number" && Number.isFinite(args["limit"])
            ? Math.floor(args["limit"])
            : 5;
        const limit = Math.min(10, Math.max(1, requestedLimit));
        const matches = provider.searchMatches(query, limit);
        const result = {
          query,
          catalog_generation: provider.catalogGeneration,
          matches: matches.map(({ ref, schemaDigest, sourceId, definition, tool }) => ({
            tool_ref: ref,
            tool_name: definition.name,
            source: sourceId,
            ...(definition.description !== undefined
              ? { description: definition.description }
              : {}),
            permission: tool.definition.permission ?? "rw",
            schema_digest: `sha256:${schemaDigest}`,
            input_schema: definition.parameters ?? { type: "object" },
          })),
          note:
            matches.length > 0
              ? "Call call_tool with a returned tool_ref, tool_name, and schema-valid arguments."
              : "No matching tools were found. Do not retry synonymous queries unless the user provides new information.",
        };
        yield partialToolCallOutput({
          eventType: "delta",
          output: JSON.stringify(result, null, 2),
          toolCallId: ctx.toolCallId,
        });
        return { stopReason: "completed" };
      },
    };
    this.callTool = {
      name: TOOL_CALL_NAME,
      definition: TOOL_CALL_DEFINITION,
      execute: async function* (_args, ctx): AsyncGenerator<OmniMessage, ToolResult> {
        yield partialToolCallOutput({
          eventType: "delta",
          output: "[tool dispatch could not resolve the requested tool reference]",
          toolCallId: ctx.toolCallId,
        });
        return { stopReason: "failed" };
      },
    };
    if (this.exposure === "lazy") this.registerStaticCatalogTools();
  }

  /** Connects once and returns the immutable model-visible tool surface for this Session. */
  async listTools(): Promise<ToolDefinition[]> {
    await this.ensure();
    if (!this.usesGateway()) return [...this.defs];
    return [modelDefinition(TOOL_SEARCH_DEFINITION), modelDefinition(TOOL_CALL_DEFINITION)];
  }

  /** Names of the (validly configured) servers this provider will contact, in config order. */
  serverNames(): string[] {
    return this.servers.map((s) => s.name);
  }

  /** Per-server connect outcomes; empty before the first listTools()/resolveTool() completed. */
  connectResults(): McpServerConnectResult[] {
    return this.results;
  }

  /**
   * Resolves an executable wrapper by full tool name; connects first if discovery has not
   * run yet (executeTool can arrive without a prior listTools on embedder-driven runs).
   * Lazy gateway names connect on demand; other non-MCP names resolve to undefined.
   */
  async resolveTool(name: string): Promise<BuiltinTool | undefined> {
    if (this.exposure !== "direct" && (name === TOOL_SEARCH_NAME || name === TOOL_CALL_NAME)) {
      await this.ensure();
    }
    if (this.usesGateway() && name === TOOL_SEARCH_NAME) {
      return this.searchTool;
    }
    if (this.usesGateway() && name === TOOL_CALL_NAME) {
      return this.callTool;
    }
    if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
    await this.ensure();
    if (this.usesGateway()) return undefined;
    return this.byName.get(name);
  }

  /** Resolves the referenced tool permission without trusting the model-provided display name. */
  toolPermission(name: string, rawArguments?: string): ToolPermission | undefined {
    if (this.usesGateway() && name === TOOL_SEARCH_NAME) return "r";
    if (this.usesGateway() && name === TOOL_CALL_NAME) {
      const args = this.parseDispatchArguments(rawArguments);
      if (!args) return undefined;
      const target = this.byRef.get(args.toolRef);
      if (!target || target.definition.name !== args.toolName) return undefined;
      return target.tool.definition.permission ?? "rw";
    }
    if (this.usesGateway()) return undefined;
    const def = this.byName.get(name)?.definition;
    return def?.permission;
  }

  /** Resolves and validates a fixed-gateway call into the current private binding. */
  async resolveDispatch(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolDispatchResolution | undefined> {
    if (!this.usesGateway() || name !== TOOL_CALL_NAME) return undefined;
    await this.awaitCatalogRefresh();
    const parsed = this.parseDispatchObject(args);
    if (!parsed) {
      return dispatchFailure(
        "invalid_tool_reference",
        "tool_ref, tool_name, and an object-valued arguments field are required; search again if the reference is unavailable.",
      );
    }
    const target = this.byRef.get(parsed.toolRef);
    if (!target) {
      const stale = this.staleByRef.get(parsed.toolRef);
      if (stale) {
        if (stale.toolName !== parsed.toolName) {
          return dispatchFailure(
            "tool_reference_mismatch",
            "tool_name does not match the tool formerly bound to tool_ref. Copy both fields from the same search result.",
          );
        }
        const replacement = stale.replacement;
        const replacementMetadata = replacement
          ? {
              replacement: {
                tool_ref: replacement.ref,
                tool_name: replacement.definition.name,
                permission: replacement.tool.definition.permission ?? "rw",
                schema_digest: `sha256:${replacement.schemaDigest}`,
                input_schema: replacement.definition.parameters ?? { type: "object" },
              },
            }
          : {};
        if (stale.reason === "tool_removed") {
          return dispatchFailure(
            "tool_removed",
            `${stale.toolName} is no longer present in the tool catalog. Run search_tools to choose another tool.`,
            {
              retryable: false,
              metadata: { stale_reason: stale.reason, ...replacementMetadata },
            },
          );
        }
        return dispatchFailure(
          "stale_tool_reference",
          `${stale.toolName} changed after this reference was issued. Use the replacement contract or run search_tools again.`,
          {
            retryable: true,
            metadata: { stale_reason: stale.reason, ...replacementMetadata },
          },
        );
      }
      return dispatchFailure(
        "unknown_tool_reference",
        "The tool_ref is unknown or belongs to a different tool contract. Run search_tools again.",
      );
    }
    if (target.definition.name !== parsed.toolName) {
      return dispatchFailure(
        "tool_reference_mismatch",
        "tool_name does not match the tool bound to tool_ref. Copy both fields from the same search result.",
      );
    }
    if (!target.validate(parsed.arguments)) {
      return dispatchFailure(
        "invalid_tool_arguments",
        `Arguments do not match the input schema for ${target.definition.name}.`,
        { details: validationDetails(target.validate.errors) },
      );
    }
    return {
      kind: "resolved",
      tool: target.tool,
      args: parsed.arguments,
      name: target.definition.name,
    };
  }

  /** Closes every connected client (stdio child processes included). Idempotent. */
  async close(): Promise<void> {
    this.closed = true;
    const open = this.connections.splice(0);
    await Promise.allSettled(open.map((conn) => conn.client.close()));
  }

  /** Fire-and-forget close for Environment's synchronous dispose(). */
  closeQuietly(): void {
    void this.close().catch(() => {});
  }

  private ensure(): Promise<void> {
    this.ensurePromise ??= this.connectAll();
    return this.ensurePromise;
  }

  private usesGateway(): boolean {
    return this.exposure === "lazy" || (this.exposure === "auto" && this.autoUsesGateway === true);
  }

  private registerStaticCatalogTools(): void {
    for (const { definition, tool } of this.catalogTools) {
      if (definition.name === TOOL_SEARCH_NAME || definition.name === TOOL_CALL_NAME) {
        this.warn(
          `Tool "${definition.name}" cannot join the private catalog: the name is reserved.`,
        );
        continue;
      }
      if (this.targetByName.has(definition.name)) {
        this.warn(`Tool "${definition.name}" appears more than once; keeping the first.`);
        continue;
      }
      const target = this.buildDispatchTarget({
        sourceId: "builtin",
        definition,
        tool,
      });
      if (!target) continue;
      const collision = this.byRef.get(target.ref);
      if (collision && collision.definition.name !== definition.name) {
        this.warn(
          `Tool "${definition.name}" cannot join the private catalog: its reference collides with "${collision.definition.name}".`,
        );
        continue;
      }
      this.byRef.set(target.ref, target);
      this.targetByName.set(definition.name, target);
      this.staticTargetNames.push(definition.name);
      this.defs.push(definition);
    }
  }

  /**
   * Cancels the in-flight connect attempt (a user abort mid-connect): pending SDK
   * connects are aborted, connections the attempt already established are closed, and
   * the provider resets to the unconnected state — the next listTools() reconnects from
   * scratch. A no-op when no attempt is in flight (an already-connected provider keeps
   * its toolset).
   */
  cancelConnect(): void {
    if (this.ensurePromise === null || this.connectAbort === null) return;
    this.attempt += 1;
    this.connectAbort.abort();
    this.connectAbort = null;
    this.ensurePromise = null;
    this.results = [];
    this.byName.clear();
    this.byRef.clear();
    this.targetByName.clear();
    this.staleByRef.clear();
    this.catalogGeneration = 0;
    this.autoUsesGateway = null;
    this.staticTargetNames.length = 0;
    this.defs = [];
    if (this.exposure === "lazy") this.registerStaticCatalogTools();
    const open = this.connections.splice(0);
    for (const conn of open) void conn.client.close().catch(() => {});
  }

  private async connectAll(): Promise<void> {
    for (const warning of this.configWarnings) this.warn(warning);
    const attempt = ++this.attempt;
    const ac = new AbortController();
    this.connectAbort = ac;
    // Connect in parallel, then register in config order so tool listing order is stable.
    // Each server's outcome (status + wall time, feeding the mcp_connect_end event) is
    // recorded either way; a failure also keeps the existing warning behavior.
    const settled = await Promise.all(
      this.servers.map(
        async (server): Promise<{ conn: McpConnection | null; result: McpServerConnectResult }> => {
          const startedAt = performance.now();
          const durationMs = (): number => Math.round(performance.now() - startedAt);
          try {
            const conn = await this.connectServer(server, ac.signal);
            return {
              conn,
              result: {
                server: server.name,
                transport: server.transport.kind,
                status: "completed",
                duration_ms: durationMs(),
                tools: conn.tools.length,
              },
            };
          } catch (err) {
            const aborted = ac.signal.aborted;
            if (!aborted) {
              this.warn(`MCP server "${server.name}" unavailable: ${describeError(err)}`);
            }
            return {
              conn: null,
              result: {
                server: server.name,
                transport: server.transport.kind,
                status: aborted ? "aborted" : "failed",
                duration_ms: durationMs(),
                ...(aborted ? {} : { error: describeError(err) }),
              },
            };
          }
        },
      ),
    );
    if (attempt !== this.attempt) {
      // Cancelled while settling: close whatever connected and register nothing — the
      // next attempt starts from scratch.
      for (const { conn } of settled) {
        if (conn) void conn.client.close().catch(() => {});
      }
      throw new Error("MCP connect cancelled");
    }
    this.connectAbort = null;
    this.results = settled.map((s) => s.result);
    for (const { conn, result } of settled) {
      if (!conn) continue;
      if (this.closed) {
        void conn.client.close().catch(() => {});
        continue;
      }
      this.connections.push(conn);
      let registered = 0;
      for (const tool of conn.tools) {
        if (this.register(conn, tool)) registered += 1;
      }
      conn.catalogReady = true;
      if (conn.refreshRequested) this.queueCatalogRefresh(conn);
      // The reported count is what actually joined the toolset (duplicates and
      // LLM-unusable names are skipped), keeping it consistent with tool_list_ready.
      result.tools = registered;
    }
    if (this.exposure === "auto") {
      const estimatedSchemaTokens = approximateTokens(JSON.stringify(this.defs));
      this.autoUsesGateway = estimatedSchemaTokens >= DEFAULT_TOOL_EXPOSURE_THRESHOLD_TOKENS;
      if (this.autoUsesGateway) this.activateAutoGateway();
    }
    if (this.usesGateway() && this.targetByName.size > 0) {
      this.catalogGeneration = 1;
      for (const conn of this.connections) {
        if (conn.refreshRequested) this.queueCatalogRefresh(conn);
      }
    }
  }

  /** Searches the current private catalog without changing the model-visible tool surface. */
  private searchMatches(query: string, limit: number): ToolDispatchTarget[] {
    return this.searchRankedMatches(query, limit).map(({ metadata }) => metadata);
  }

  /** Auto compiles gateway-only validation only after the initial schema estimate crosses the threshold. */
  private activateAutoGateway(): void {
    for (const conn of this.connections) {
      for (const tool of conn.tools) {
        const name = mcpToolName(conn.server.name, tool.name);
        if (!LLM_TOOL_NAME_PATTERN.test(name) || this.targetByName.has(name)) continue;
        const target = this.buildMcpDispatchTarget(conn, tool);
        if (!target) continue;
        const collision = this.byRef.get(target.ref);
        if (collision && collision.definition.name !== name) {
          this.warn(
            `MCP tool "${name}" cannot be added to the private catalog: its tool reference collides with "${collision.definition.name}".`,
          );
          continue;
        }
        this.byRef.set(target.ref, target);
        this.targetByName.set(name, target);
      }
    }
  }

  private searchRankedMatches(query: string, limit = this.defs.length) {
    const entries = this.defs.flatMap((definition) => {
      const target = this.targetByName.get(definition.name);
      if (!target) return [];
      const parts = definition.name.split("__");
      return [
        {
          definition,
          metadata: target,
          aliases: parts.slice(1),
        },
      ];
    });
    return searchToolCatalog(entries, query, limit);
  }

  private parseDispatchArguments(
    rawArguments: string | undefined,
  ): { toolRef: string; toolName: string; arguments: Record<string, unknown> } | null {
    if (rawArguments === undefined) return null;
    try {
      const parsed: unknown = JSON.parse(rawArguments);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      return this.parseDispatchObject(parsed as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private parseDispatchObject(
    args: Record<string, unknown>,
  ): { toolRef: string; toolName: string; arguments: Record<string, unknown> } | null {
    const toolRef = args["tool_ref"];
    const toolName = args["tool_name"];
    const toolArguments = args["arguments"];
    if (
      typeof toolRef !== "string" ||
      toolRef === "" ||
      typeof toolName !== "string" ||
      toolName === "" ||
      toolArguments === null ||
      typeof toolArguments !== "object" ||
      Array.isArray(toolArguments)
    ) {
      return null;
    }
    return {
      toolRef,
      toolName,
      arguments: toolArguments as Record<string, unknown>,
    };
  }

  /** Waits for every list-changed refresh that has already been scheduled. */
  private async awaitCatalogRefresh(): Promise<void> {
    if (!this.usesGateway()) return;
    for (;;) {
      const pending = this.connections.flatMap((conn) =>
        conn.refreshPromise ? [conn.refreshPromise] : [],
      );
      if (pending.length === 0) return;
      await Promise.all(pending);
    }
  }

  /** Coalesces notification bursts into a single per-connection refresh loop. */
  private queueCatalogRefresh(conn: McpConnection): void {
    conn.refreshRequested = true;
    if (!this.usesGateway() || this.closed) return;
    if (!conn.catalogReady || conn.refreshPromise) return;
    conn.refreshPromise = this.refreshCatalogLoop(conn).finally(() => {
      conn.refreshPromise = null;
    });
  }

  private async refreshCatalogLoop(conn: McpConnection): Promise<void> {
    while (conn.refreshRequested && !this.closed) {
      conn.refreshRequested = false;
      try {
        const listed = await conn.client.listTools(undefined, {
          timeout: conn.server.connectTimeoutMs,
        });
        if (!this.closed) this.applyGatewayCatalog(conn, listed.tools);
      } catch (err) {
        if (!this.closed) {
          this.warn(
            `MCP server "${conn.server.name}" catalog refresh failed; keeping the previous catalog: ${describeError(err)}`,
          );
        }
      }
    }
  }

  /**
   * Atomically replaces one server's private lazy catalog. Equal contracts rebind to the
   * current client wrapper under the same ref. Changed/removed contracts become tombstones.
   */
  private applyGatewayCatalog(conn: McpConnection, tools: Tool[]): void {
    const previous = new Map<string, ToolDispatchTarget>();
    for (const [name, target] of this.targetByName) {
      if (target.sourceId === `mcp:${conn.server.name}`) previous.set(name, target);
    }

    const next = new Map<string, ToolDispatchTarget>();
    const nextByRef = new Map<string, ToolDispatchTarget>();
    const listedNames = new Set<string>();
    for (const tool of tools) {
      const name = mcpToolName(conn.server.name, tool.name);
      listedNames.add(name);
      if (next.has(name)) {
        this.warn(
          `MCP server "${conn.server.name}" listed tool "${tool.name}" twice during catalog refresh; keeping the first.`,
        );
        continue;
      }
      const target = this.buildMcpDispatchTarget(conn, tool);
      if (!target) continue;
      const collision = nextByRef.get(target.ref) ?? this.byRef.get(target.ref);
      if (collision && collision.definition.name !== target.definition.name) {
        this.warn(
          `MCP tool "${name}" cannot be added to the lazy catalog: its tool reference collides with "${collision.definition.name}".`,
        );
        continue;
      }
      next.set(name, target);
      nextByRef.set(target.ref, target);
    }

    // Remove this server's active bindings first, then install the complete new set. No
    // model-visible definition is touched: defs remains only the searchable private catalog.
    for (const [name, target] of previous) {
      this.targetByName.delete(name);
      this.byName.delete(name);
      if (this.byRef.get(target.ref) === target) this.byRef.delete(target.ref);
    }
    for (const [name, target] of next) {
      this.targetByName.set(name, target);
      this.byName.set(name, target.tool);
      this.byRef.set(target.ref, target);
      this.staleByRef.delete(target.ref);
    }

    for (const [name, oldTarget] of previous) {
      const replacement = next.get(name);
      if (replacement?.ref === oldTarget.ref) {
        // Same name, schema, permission and description: only the execution binding moved.
        this.staleByRef.delete(oldTarget.ref);
        continue;
      }
      let reason: ToolStaleReason;
      if (!listedNames.has(name)) reason = "tool_removed";
      else if (replacement && replacement.schemaDigest !== oldTarget.schemaDigest) {
        reason = "schema_changed";
      } else if (
        replacement &&
        replacement.tool.definition.permission !== oldTarget.tool.definition.permission
      ) {
        reason = "permission_changed";
      } else {
        reason = "contract_changed";
      }
      this.rememberStale(oldTarget.ref, {
        sourceId: oldTarget.sourceId,
        toolName: oldTarget.definition.name,
        reason,
        ...(replacement ? { replacement } : {}),
      });
    }

    // A reference may survive more than one catalog revision. Keep every retained
    // tombstone pointed at the latest active contract, never at another stale ref.
    for (const stale of this.staleByRef.values()) {
      if (stale.sourceId === `mcp:${conn.server.name}`) {
        const current = next.get(stale.toolName);
        if (current) stale.replacement = current;
        else if (!listedNames.has(stale.toolName)) {
          stale.reason = "tool_removed";
          delete stale.replacement;
        }
      }
    }

    conn.tools = tools;
    this.rebuildCatalogDefinitions();
    this.catalogGeneration += 1;
  }

  private rebuildCatalogDefinitions(): void {
    const statics = this.staticTargetNames.flatMap((name) => {
      const target = this.targetByName.get(name);
      return target ? [target.definition] : [];
    });
    const dynamic = this.connections.flatMap((conn) =>
      conn.tools.flatMap((tool) => {
        const target = this.targetByName.get(mcpToolName(conn.server.name, tool.name));
        return target ? [target.definition] : [];
      }),
    );
    this.defs = [...statics, ...dynamic];
  }

  private rememberStale(ref: string, stale: ToolStaleReference): void {
    this.staleByRef.delete(ref);
    this.staleByRef.set(ref, stale);
    while (this.staleByRef.size > MAX_STALE_TOOL_REFS) {
      const oldest = this.staleByRef.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.staleByRef.delete(oldest);
    }
  }

  private async connectServer(
    server: ResolvedMCPServer,
    signal?: AbortSignal,
  ): Promise<McpConnection> {
    const client = new Client(clientInfo());
    const conn: McpConnection = {
      server,
      client,
      tools: [],
      catalogReady: false,
      refreshRequested: false,
      refreshPromise: null,
    };
    // Direct mode intentionally preserves its initial native-tool snapshot. In lazy mode
    // the notification refreshes only the private catalog; listTools() still returns the
    // same two gateway schemas for the lifetime of the Environment.
    if (this.exposure !== "direct") {
      client.setNotificationHandler("notifications/tools/list_changed", () => {
        this.queueCatalogRefresh(conn);
      });
    }
    let stderrTail = "";
    let transport: Transport;
    const t = server.transport;
    if (t.kind === "stdio") {
      const stdio = new StdioClientTransport({
        command: t.command,
        args: t.args,
        // Safe inherited defaults plus the entry's own env — and nothing else: the Agent
        // vault is deliberately NOT injected into MCP server processes (unlike command
        // subprocesses); a variable a server needs must be listed in the entry's env.
        env: { ...getDefaultEnvironment(), ...t.env },
        ...(t.cwd !== undefined || this.workspaceDir !== undefined
          ? { cwd: t.cwd ?? this.workspaceDir }
          : {}),
        stderr: "pipe",
      });
      // The tail makes spawn/startup failures diagnosable ("command not found", stack
      // traces); after a successful connect it keeps draining into the ring, never printed.
      stdio.stderr?.on("data", (chunk: unknown) => {
        stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
      });
      transport = stdio;
    } else if (t.kind === "http") {
      transport = new StreamableHTTPClientTransport(
        new URL(t.url),
        t.headers ? { fetch: fetchWithHeaders(t.headers) } : {},
      );
    } else {
      transport = new SSEClientTransport(
        new URL(t.url),
        t.headers ? { fetch: fetchWithHeaders(t.headers) } : {},
      );
    }
    try {
      const startedAt = Date.now();
      await client.connect(transport, {
        timeout: server.connectTimeoutMs,
        ...(signal ? { signal } : {}),
      });
      // One budget covers connect + discovery: the SDK's `timeout` is per-request, so
      // discovery gets whatever the handshake left over — granting the full value to
      // both calls would let the worst case run to twice the documented total.
      const remainingMs = Math.max(1, server.connectTimeoutMs - (Date.now() - startedAt));
      const listed = await client.listTools(undefined, {
        timeout: remainingMs,
        ...(signal ? { signal } : {}),
      });
      conn.tools = listed.tools;
      return conn;
    } catch (err) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      const detail = describeError(err);
      throw new Error(stderrTail ? `${detail}; server stderr: ${stderrTail.trim()}` : detail);
    }
  }

  /** Returns whether the tool joined the toolset (skips are warned, never thrown). */
  private register(conn: McpConnection, tool: Tool): boolean {
    const name = mcpToolName(conn.server.name, tool.name);
    if (this.exposure !== "lazy" && !LLM_TOOL_NAME_PATTERN.test(name)) {
      this.warn(
        `MCP server "${conn.server.name}" tool "${tool.name}" skipped: the prefixed name ` +
          `is not usable as an LLM tool name (allowed: letters, digits, _ and -, ≤128 chars total).`,
      );
      return false;
    }
    if (this.byName.has(name)) {
      this.warn(
        `MCP server "${conn.server.name}" listed tool "${tool.name}" twice; keeping the first.`,
      );
      return false;
    }
    if (this.exposure !== "lazy") {
      const binding = this.buildBinding(conn, tool);
      this.byName.set(name, binding.tool);
      this.defs.push(binding.definition);
      return true;
    }
    const target = this.buildMcpDispatchTarget(conn, tool);
    if (!target) return false;
    const collision = this.byRef.get(target.ref);
    if (collision && collision.definition.name !== name) {
      this.warn(
        `MCP tool "${name}" cannot be added to the lazy catalog: its tool reference collides with "${collision.definition.name}".`,
      );
      return false;
    }
    this.byName.set(name, target.tool);
    this.defs.push(target.definition);
    this.byRef.set(target.ref, target);
    this.targetByName.set(name, target);
    return true;
  }

  /** Builds an executable wrapper without compiling any gateway-only schema state. */
  private buildBinding(conn: McpConnection, tool: Tool): ToolBinding {
    const provider = this;
    const name = mcpToolName(conn.server.name, tool.name);
    const description =
      tool.description ?? tool.title ?? `MCP tool "${tool.name}" on server "${conn.server.name}".`;
    const parameters =
      tool.inputSchema === undefined
        ? undefined
        : (structuredClone(tool.inputSchema) as Record<string, unknown>);
    // readOnlyHint is an untrusted hint: only an explicit true relaxes to "r".
    const permission: ToolPermission = tool.annotations?.readOnlyHint === true ? "r" : "rw";
    const wrapper: BuiltinTool = {
      name,
      definition: {
        name,
        description,
        parameters,
        permission,
        ...(conn.server.timeoutMs !== undefined ? { timeoutMs: conn.server.timeoutMs } : {}),
        ...(conn.server.maxOutputLength !== undefined
          ? { maxOutputLength: conn.server.maxOutputLength }
          : {}),
      },
      execute: async function* (args, ctx): AsyncGenerator<OmniMessage, ToolResult> {
        let result: CallToolResult;
        try {
          result = await conn.client.callTool(
            { name: tool.name, arguments: args },
            {
              timeout: MAX_SDK_TIMEOUT_MS,
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            },
          );
        } catch (err) {
          // Preserve direct exposure's historical error path. Lazy dispatch returns a
          // machine-readable transient failure and never retries a potentially mutating call.
          if (!provider.usesGateway() || ctx.signal?.aborted) throw err;
          // A protocol error can be the first observable sign of a missed list-changed
          // notification. Refresh in the background so the next search sees the latest
          // contract, without replaying this call (which may already have had side effects).
          provider.queueCatalogRefresh(conn);
          const retryable = permission === "r";
          yield partialToolCallOutput({
            eventType: "delta",
            output: JSON.stringify(
              {
                error: "temporarily_unavailable",
                message: `MCP tool ${name} could not be reached: ${describeError(err)}`,
                retryable,
                tool_name: name,
                ...(retryable
                  ? { retry_guidance: "Search again before retrying the read-only call." }
                  : {
                      retry_guidance:
                        "Do not retry automatically because the call may have side effects.",
                    }),
              },
              null,
              2,
            ),
            toolCallId: ctx.toolCallId,
          });
          return { stopReason: "failed" };
        }
        const rendered = renderCallToolResult(result);
        const failed = result.isError === true;
        const text =
          rendered.text === "" && failed && rendered.images.length === 0
            ? "[tool reported an error with no message]"
            : rendered.text;
        if (text !== "") {
          yield partialToolCallOutput({
            eventType: "delta",
            output: text,
            toolCallId: ctx.toolCallId,
          });
        }
        return {
          stopReason: failed ? "failed" : "completed",
          ...(rendered.images.length > 0 ? { images: rendered.images } : {}),
        };
      },
    };
    const definition: ToolDefinition = {
      name,
      description,
      ...(wrapper.definition.parameters !== undefined
        ? { parameters: wrapper.definition.parameters }
        : {}),
    };
    return {
      sourceId: `mcp:${conn.server.name}`,
      definition,
      tool: wrapper,
      contract: tool.outputSchema ?? null,
    };
  }

  /** Adds local validation and a content-addressed reference to an MCP binding. */
  private buildMcpDispatchTarget(conn: McpConnection, tool: Tool): ToolDispatchTarget | null {
    return this.buildDispatchTarget(this.buildBinding(conn, tool));
  }

  /** Compiles validation and creates a content-addressed reference for any tool source. */
  private buildDispatchTarget(binding: ToolBinding): ToolDispatchTarget | null {
    const { definition } = binding;
    const name = definition.name;
    const description = definition.description ?? "";
    const permission = binding.tool.definition.permission ?? "rw";

    try {
      const schema = definition.parameters ?? { type: "object" };
      const validator = (this.schemaValidator ??= new Ajv2020({ allErrors: true, strict: false }));
      const validate = validator.compile(schema);
      const schemaDigest = sha256(canonicalJson(schema));
      const contractDigest = sha256(canonicalJson(binding.contract ?? null));
      const descriptionDigest = sha256(description);
      const policyDigest = sha256(
        canonicalJson({
          permission,
          timeout_ms: binding.tool.definition.timeoutMs ?? null,
          max_output_length: binding.tool.definition.maxOutputLength ?? null,
        }),
      );
      const refDigest = sha256(
        canonicalJson({
          name,
          source: binding.sourceId,
          schema_digest: schemaDigest,
          contract_digest: contractDigest,
          description_digest: descriptionDigest,
          policy_digest: policyDigest,
        }),
      );
      return {
        ...binding,
        ref: `tr_${refDigest.slice(0, 32)}`,
        schemaDigest,
        validate,
      };
    } catch (err) {
      // Lazy search omits a tool whose schema cannot be validated locally instead of
      // dispatching unvalidated generic arguments.
      this.warn(
        `Tool "${name}" is unavailable through lazy dispatch: its input schema could not be compiled (${describeError(err)}).`,
      );
      return null;
    }
  }
}
