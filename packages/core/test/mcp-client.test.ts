/**
 * Unit test for McpToolAdapter. The real @modelcontextprotocol/sdk Client + StdioClientTransport
 * are mocked so the test exercises OUR wiring (server connection, tool enumeration, namespacing,
 * BuiltinTool delegation, inputSchema passthrough, per-server fault isolation) without spawning
 * a process. The mock transport preserves all options (incl. the serverName we thread through),
 * which is what the mock Client uses to resolve its tool list.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Per-server tool registries the mock Client will return from listTools().
const listToolsByServer = new Map<string, { name: string; description?: string; inputSchema?: unknown }[]>();
const callToolResults = new Map<string, unknown>();
const connectFailures = new Set<string>();

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  // Mock transport: expose every option as an own property (incl. the serverName threaded
  // via buildTransport's `config` field) so the mock Client can recover it.
  StdioClientTransport: class {
    constructor(opts: Record<string, unknown>) {
      Object.assign(this, opts);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: class {
      serverName = "";
      opts: Record<string, unknown>;
      constructor(_opts: unknown) {
        this.opts = {};
      }
      async connect(transport: { config?: { serverName?: string } }) {
        const name = transport?.config?.serverName ?? "";
        this.serverName = name;
        if (connectFailures.has(name)) throw new Error(`connect failed: ${name}`);
      }
      async listTools() {
        return { tools: listToolsByServer.get(this.serverName) ?? [] };
      }
      async callTool(req: { name: string }) {
        return (
          callToolResults.get(req.name) ?? {
            content: [{ type: "text", text: `mock output for ${req.name}` }],
          }
        );
      }
      close() {
        return Promise.resolve();
      }
    },
  };
});

import { McpToolAdapter } from "../src/environment/mcp/client.js";
import type { MCPServerConfig } from "../src/interfaces.js";

function makeServers(): MCPServerConfig[] {
  return [
    {
      name: "fs",
      config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    },
    {
      name: "git",
      config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-git"] },
    },
  ];
}

describe("McpToolAdapter", () => {
  beforeEach(() => {
    callToolResults.clear();
    listToolsByServer.clear();
    connectFailures.clear();
    listToolsByServer.set("fs", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
      { name: "write_file", description: "Write a file", inputSchema: { type: "object" } },
    ]);
    listToolsByServer.set("git", [
      { name: "status", description: "Git status", inputSchema: { type: "object" } },
    ]);
  });

  it("enumerates tools namespaced across servers and passes inputSchema through", async () => {
    const adapter = new McpToolAdapter(makeServers());
    await adapter.init();
    const defs = adapter.listToolDefinitions();
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(["mcp__fs__read_file", "mcp__fs__write_file", "mcp__git__status"]);

    const readFile = defs.find((d) => d.name === "mcp__fs__read_file")!;
    // inputSchema (JSON Schema) must pass straight through into parameters with no conversion.
    expect(readFile.parameters).toEqual({ type: "object", properties: { path: { type: "string" } } });
  });

  it("wraps an MCP tool as a BuiltinTool and delegates execute -> callTool", async () => {
    callToolResults.set("read_file", {
      content: [{ type: "text", text: "file contents here" }],
    });
    const adapter = new McpToolAdapter(makeServers());
    await adapter.init();
    const def = adapter.listToolDefinitions().find((d) => d.name === "mcp__fs__read_file")!;
    const tool = adapter.toBuiltinTool(def);
    expect(tool.name).toBe("mcp__fs__read_file");

    const chunks: string[] = [];
    const gen = tool.execute({ path: "/x" }, { toolCallId: "tc2", signal: undefined, workspaceDir: "/tmp" });
    for await (const m of gen) {
      const p = m as { payload?: { type?: string; event_type?: string; output?: string } };
      if (p.payload?.type === "partial_tool_call_output" && p.payload.event_type === "delta") {
        chunks.push(p.payload.output ?? "");
      }
    }
    expect(chunks.join("")).toBe("file contents here");
  });

  it("isolates a failing server instead of crashing the whole Environment", async () => {
    connectFailures.add("git");
    const adapter = new McpToolAdapter(makeServers());
    await adapter.init(); // should not throw
    const names = adapter.listToolDefinitions().map((d) => d.name).sort();
    expect(names).toEqual(["mcp__fs__read_file", "mcp__fs__write_file"]);
  });
});
