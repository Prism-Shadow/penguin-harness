/**
 * MCP adapter — connects declared MCP servers and exposes their tools as PenguinHarness
 * BuiltinTool instances. This is the "later adapter layer" referenced in environment.ts and the
 * docs (tools.en.md / configuration.en.md: "enumerating concrete MCP tools is reserved for a
 * later adapter layer").
 *
 * Design: keep MCP entirely behind this module. Environment only knows about BuiltinTool, so we
 * wrap each enumerated MCP tool in a BuiltinTool whose execute() delegates to the connected
 * client. Tool names are namespaced as `mcp__<serverName>__<toolName>` to avoid collisions.
 *
 * Depends on @modelcontextprotocol/sdk — add it to packages/core/package.json:
 *   "dependencies": { "@modelcontextprotocol/sdk": "^1.x" }
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { MCPServerConfig, ToolDefinition, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "../tools/types.js";

const MCP_NAME_PREFIX = "mcp__";

interface McpToolEntry {
  serverName: string;
  originalName: string;
  client: Client;
  definition: ToolDefinitionConfig;
}

/**
 * Parse the free-form MCPServerConfig.config into a concrete transport.
 * Expected shapes:
 *   stdio: { command: string, args?: string[], env?: Record<string,string>, cwd?: string }
 *   sse:   { url: string, headers?: Record<string,string> }
 */
function buildTransport(serverName: string, cfg: Record<string, unknown>): StdioClientTransport | SSEClientTransport {
  if (typeof cfg.command === "string") {
    return new StdioClientTransport({
      command: cfg.command,
      args: Array.isArray(cfg.args) ? (cfg.args as string[]) : undefined,
      env: (cfg.env as Record<string, string> | undefined) ?? undefined,
      cwd: typeof cfg.cwd === "string" ? cfg.cwd : undefined,
      // Carry the server name on the transport so the connected Client can self-identify
      // (used by the mock Client in tests, ignored by the real SDK's StdioClientTransport).
      ...{ config: { serverName } } as Partial<StdioServerParameters>,
    });
  }
  if (typeof cfg.url === "string") {
    const headers = (cfg.headers as Record<string, string> | undefined) ?? undefined;
    return new SSEClientTransport(
      new URL(cfg.url),
      headers ? { requestInit: { headers } } : {},
    );
  }
  throw new Error(
    `MCP server config must specify either "command" (stdio) or "url" (sse); got: ${JSON.stringify(cfg)}`,
  );
}

export class McpToolAdapter {
  private readonly servers: MCPServerConfig[];
  private readonly clients = new Map<string, Client>();
  private readonly entries: McpToolEntry[] = [];

  constructor(servers: MCPServerConfig[]) {
    this.servers = servers;
  }

  /** Connect every declared server and enumerate its tools. Per-server failures are isolated. */
  async init(): Promise<void> {
    for (const server of this.servers) {
      try {
        const client = new Client({ name: "penguin-harness", version: "0.2.1" });
        await client.connect(buildTransport(server.name, server.config));
        this.clients.set(server.name, client);
        const { tools } = await client.listTools();
        for (const tool of tools) {
          const namespaced = `${MCP_NAME_PREFIX}${server.name}__${tool.name}`;
          const definition: ToolDefinitionConfig = {
            name: namespaced,
            description: tool.description ?? `MCP tool ${tool.name} from ${server.name}`,
            // MCP inputSchema IS JSON Schema; ToolDefinitionConfig.parameters is an open Record,
            // so it drops straight in with no conversion layer.
            parameters: tool.inputSchema as Record<string, unknown>,
            permission: "rw",
          };
          this.entries.push({
            serverName: server.name,
            originalName: tool.name,
            client,
            definition,
          });
        }
      } catch (err) {
        process.stderr.write(
          `[penguin] MCP server "${server.name}" failed to connect: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
    }
  }

  /** Tool definitions (namespaced) for Environment.listTools(). */
  listToolDefinitions(): ToolDefinition[] {
    return this.entries.map((e) => ({
      name: e.definition.name,
      description: e.definition.description,
      ...(e.definition.parameters !== undefined ? { parameters: e.definition.parameters } : {}),
    }));
  }

  /** Wrap a namespaced MCP tool as a BuiltinTool delegating to the connected client. */
  toBuiltinTool(def: ToolDefinitionConfig): BuiltinTool {
    const entry = this.entries.find((e) => e.definition.name === def.name);
    if (!entry) throw new Error(`MCP tool not found: ${def.name}`);
    return {
      name: def.name,
      definition: def,
      execute: (args, ctx) => this.execute(entry, args, ctx),
    };
  }

  private async *execute(
    entry: McpToolEntry,
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): AsyncGenerator<OmniMessage, ToolResult | void> {
    try {
      // Forward the caller's abort signal into the MCP call so user-interrupt / timeout
      // cancels an in-flight request to the server (not just the surrounding stream).
      const options: { signal?: AbortSignal } = {};
      if (ctx.signal) options.signal = ctx.signal;
      const result = await entry.client.callTool(
        {
          name: entry.originalName,
          arguments: args,
        },
        undefined,
        options,
      );
      const images: string[] = [];
      let text = "";
      const blocks = (result.content ?? []) as Array<{
        type: string;
        text?: string;
        data?: string;
        mimeType?: string;
      }>;
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          text += block.text;
          yield partialToolCallOutput({
            eventType: "delta",
            output: block.text,
            toolCallId: ctx.toolCallId,
          });
        } else if (block.type === "image" && block.data) {
          const mime = block.mimeType ?? "image/png";
          images.push(`data:${mime};base64,${block.data}`);
        }
      }
      if (result.isError) {
        return { stopReason: "failed", note: text ? undefined : "[MCP tool returned error]" };
      }
      return images.length > 0 ? { images } : undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield partialToolCallOutput({
        eventType: "delta",
        output: `[MCP tool error] ${message}`,
        toolCallId: ctx.toolCallId,
      });
      return { stopReason: "failed" };
    }
  }

  /** Close all connected clients. Idempotent. */
  dispose(): void {
    for (const client of this.clients.values()) {
      client.close().catch(() => {});
    }
    this.clients.clear();
    this.entries.length = 0;
  }
}
