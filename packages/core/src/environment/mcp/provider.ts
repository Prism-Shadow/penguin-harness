/**
 * McpToolProvider — connects the configured MCP Servers and bridges their tools into
 * Environment as BuiltinTool instances.
 *
 * Naming: every MCP tool is exposed to the LLM as `mcp__<server>__<tool>`, which keeps the
 * flat tool namespace collision-free (builtin names never carry the prefix, and the server
 * name — validated to a safe alphabet — separates servers from each other).
 *
 * Lifecycle: connection and tool discovery are lazy and happen exactly once per Environment
 * (single-flight) — `Environment.listTools()` at Session assembly triggers it; all servers
 * connect in parallel, each bounded by its `connectTimeoutMs`. A server that fails to
 * connect (or an invalid config entry) is reported as a stderr warning and skipped — MCP
 * problems never break Session creation, matching Environment's stance on unrecognized
 * builtin tool names. Discovery is a session-lifetime snapshot: `tools/list_changed`
 * notifications are ignored.
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
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult, FetchLike, Tool, Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { McpServerConnectResult, OmniMessage } from "../../omnimessage/index.js";
import type { MCPServerConfig, ToolDefinition, ToolPermission } from "../../interfaces.js";
import type { BuiltinTool, ToolResult } from "../tools/types.js";
import { resolveMCPServers, type ResolvedMCPServer } from "./config.js";

/** Prefix marking a tool as MCP-provided; the full form is `mcp__<server>__<tool>`. */
export const MCP_TOOL_PREFIX = "mcp__";

/** Builds the LLM-visible name of an MCP tool. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

/**
 * Largest delay setTimeout can represent (~24.8 days): used as the SDK per-request timeout
 * so it never fires before Environment's own tool timeout, which is the single authority
 * (it aborts the shared signal; a larger value would overflow to an immediate fire).
 */
const MAX_SDK_TIMEOUT_MS = 2_147_483_647;

/** Rolling stderr tail kept per stdio server for connect-failure diagnostics (chars). */
const STDERR_TAIL_LIMIT = 2048;

/** MCP handshake client info; informational only (shows up in server logs). */
const CLIENT_INFO = { name: "penguin-harness", version: "0.2.1" };

export interface McpToolProviderOptions {
  /** Session Workspace: the default working directory for stdio server processes. */
  workspaceDir?: string;
  /** Warning sink; defaults to a `[penguin]`-prefixed stderr line. */
  warn?: (message: string) => void;
}

/** One connected server: its client plus the tools discovered on it. */
interface McpConnection {
  server: ResolvedMCPServer;
  client: Client;
  tools: Tool[];
}

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
  /** Single-flight connect+discovery; resolved results live in the fields below. */
  private ensurePromise: Promise<void> | null = null;
  /** Successfully connected servers, kept for close(). */
  private readonly connections: McpConnection[] = [];
  /** Full tool name (`mcp__server__tool`) → executable wrapper. */
  private readonly byName = new Map<string, BuiltinTool>();
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
  }

  /** Connects (once) and returns the LLM-facing definitions of every discovered MCP tool. */
  async listTools(): Promise<ToolDefinition[]> {
    await this.ensure();
    return this.defs;
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
   * Non-MCP names resolve to undefined without triggering a connect.
   */
  async resolveTool(name: string): Promise<BuiltinTool | undefined> {
    if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
    await this.ensure();
    return this.byName.get(name);
  }

  /** Permission of a discovered MCP tool (undefined before discovery or for unknown names). */
  toolPermission(name: string): ToolPermission | undefined {
    const def = this.byName.get(name)?.definition;
    return def?.permission;
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

  private async connectAll(): Promise<void> {
    for (const warning of this.configWarnings) this.warn(warning);
    // Connect in parallel, then register in config order so tool listing order is stable.
    // Each server's outcome (status + wall time, feeding the mcp_connect_end event) is
    // recorded either way; a failure also keeps the existing warning behavior.
    const settled = await Promise.all(
      this.servers.map(
        async (server): Promise<{ conn: McpConnection | null; result: McpServerConnectResult }> => {
          const startedAt = performance.now();
          const durationMs = (): number => Math.round(performance.now() - startedAt);
          try {
            const conn = await this.connectServer(server);
            return {
              conn,
              result: {
                server: server.name,
                transport: server.transport.kind,
                status: "ok",
                duration_ms: durationMs(),
                tools: conn.tools.length,
              },
            };
          } catch (err) {
            this.warn(`MCP server "${server.name}" unavailable: ${describeError(err)}`);
            return {
              conn: null,
              result: {
                server: server.name,
                transport: server.transport.kind,
                status: "failed",
                duration_ms: durationMs(),
                error: describeError(err),
              },
            };
          }
        },
      ),
    );
    this.results = settled.map((s) => s.result);
    for (const { conn } of settled) {
      if (!conn) continue;
      if (this.closed) {
        void conn.client.close().catch(() => {});
        continue;
      }
      this.connections.push(conn);
      for (const tool of conn.tools) this.register(conn, tool);
    }
  }

  private async connectServer(server: ResolvedMCPServer): Promise<McpConnection> {
    const client = new Client(CLIENT_INFO);
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
      await client.connect(transport, { timeout: server.connectTimeoutMs });
      const listed = await client.listTools(undefined, { timeout: server.connectTimeoutMs });
      return { server, client, tools: listed.tools };
    } catch (err) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      const detail = describeError(err);
      throw new Error(stderrTail ? `${detail}; server stderr: ${stderrTail.trim()}` : detail);
    }
  }

  private register(conn: McpConnection, tool: Tool): void {
    const name = mcpToolName(conn.server.name, tool.name);
    if (this.byName.has(name)) {
      this.warn(
        `MCP server "${conn.server.name}" listed tool "${tool.name}" twice; keeping the first.`,
      );
      return;
    }
    const description =
      tool.description ?? tool.title ?? `MCP tool "${tool.name}" on server "${conn.server.name}".`;
    // readOnlyHint is an untrusted hint: only an explicit true relaxes to "r".
    const permission: ToolPermission = tool.annotations?.readOnlyHint === true ? "r" : "rw";
    const wrapper: BuiltinTool = {
      name,
      definition: {
        name,
        description,
        parameters: tool.inputSchema as Record<string, unknown>,
        permission,
        ...(conn.server.timeoutMs !== undefined ? { timeoutMs: conn.server.timeoutMs } : {}),
        ...(conn.server.maxOutputLength !== undefined
          ? { maxOutputLength: conn.server.maxOutputLength }
          : {}),
      },
      execute: async function* (args, ctx): AsyncGenerator<OmniMessage, ToolResult> {
        const result = await conn.client.callTool(
          { name: tool.name, arguments: args },
          {
            timeout: MAX_SDK_TIMEOUT_MS,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          },
        );
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
    this.byName.set(name, wrapper);
    this.defs.push({
      name,
      description,
      ...(wrapper.definition.parameters !== undefined
        ? { parameters: wrapper.definition.parameters }
        : {}),
    });
  }
}
