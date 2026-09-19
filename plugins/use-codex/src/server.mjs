#!/usr/bin/env node
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { CodexBridge, TOOLS } from "./bridge.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--project-dir" || !path.isAbsolute(args[1])) {
  process.stderr.write(
    "Usage: penguin-codex-mcp --project-dir <absolute Penguin project data directory>\n",
  );
  process.exit(1);
}
const bridge = new CodexBridge({ projectDir: args[1], cwd: process.cwd() });
const server = new McpServer({ name: "penguin-codex", version: "0.2.13" });
for (const { name, ...definition } of TOOLS)
  server.registerTool(name, definition, async (input, ctx) => {
    const abort = () => void bridge.close();
    ctx.mcpReq.signal.addEventListener("abort", abort, { once: true });
    try {
      if (ctx.mcpReq.signal.aborted) throw new Error("Request cancelled");
      return { content: [{ type: "text", text: JSON.stringify(await bridge.call(name, input)) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error.message }] };
    } finally {
      ctx.mcpReq.signal.removeEventListener("abort", abort);
    }
  });
let stopping;
function stop() {
  return (stopping ??= (async () => {
    await bridge.close();
    await server.close();
    // Allow the adapter's stdin-EOF cleanup and transport kill fallback to run.
  })());
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.stdin.on("end", () => void stop());
process.stdout.on("error", () => void stop());
await server.connect(new StdioServerTransport());
