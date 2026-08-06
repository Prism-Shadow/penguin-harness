/**
 * Real end-to-end check for the MCP adapter: spins up an actual stdio MCP server
 * (test/fixtures/echo-mcp-server.mjs) and drives it through the real penguin-core
 * Environment.create -> listTools -> executeTool pipeline. No mocking.
 *
 * Run with: npx tsx test/mcp-e2e.mts   (from packages/core)
 */
import { Environment } from "../src/environment/environment.js";
import type { MCPServerConfig, ToolDefinitionConfig } from "../src/interfaces.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "fixtures", "echo-mcp-server.mjs");

const mcpServer: MCPServerConfig = {
  name: "echo",
  config: { command: process.execPath, args: [serverPath] },
};

const toolConfig = {
  customTools: [] as ToolDefinitionConfig[],
  mcpServers: [mcpServer],
};

const config = {
  workspaceDir: here,
  toolConfig,
  sessionScratchpadDir: path.join(here, ".mcp-e2e-scratch"),
};

const env = await Environment.create(config);

// 1) listTools should surface the namespaced MCP tool.
const tools = await env.listTools();
const names = tools.map((t) => t.name);
console.log("[e2e] listed tools:", JSON.stringify(names));
if (!names.includes("mcp__echo__echo")) {
  throw new Error(`expected mcp__echo__echo in ${JSON.stringify(names)}`);
}

// 2) executeTool should route to the real MCP server and stream its output.
const request: any = {
  toolCall: {
    timestamp: new Date().toISOString(),
    type: "tool_call",
    payload: {
      tool_call_id: "tc-e2e",
      name: "mcp__echo__echo",
      arguments: JSON.stringify({ text: "hello from penguin" }),
    },
  },
  signal: undefined,
};

let streamed = "";
let stopReason = "";
for await (const msg of env.executeTool(request)) {
  const p = (msg as { payload?: { type?: string; event_type?: string; output?: string; stop_reason?: string } })
    .payload;
  if (p?.type === "partial_tool_call_output" && p.event_type === "delta") {
    streamed += p.output ?? "";
  }
  if (p?.type === "partial_tool_call_output" && p.event_type === "stop") {
    stopReason = p.stop_reason ?? "";
  }
}
console.log("[e2e] streamed output:", JSON.stringify(streamed));
console.log("[e2e] stop_reason:", stopReason);

if (!streamed.includes("echo: hello from penguin")) {
  throw new Error(`MCP tool did not return expected echo; got: ${JSON.stringify(streamed)}`);
}
if (stopReason !== "completed") {
  throw new Error(`expected completed, got ${stopReason}`);
}

env.dispose();
console.log("[e2e] PASS: real MCP server reachable through Environment adapter");
