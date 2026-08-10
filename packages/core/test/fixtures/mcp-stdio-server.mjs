/**
 * Minimal MCP server over stdio, spawned as a child process by the MCP integration tests.
 * Tools cover the result shapes the bridge must map: text, tool-level error (isError),
 * image content, slow execution (timeout/abort tests), env/cwd probing (vault + workspace
 * defaults) and long output (truncation tests).
 */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "penguin-test-fixture", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Echoes back the input text.",
    inputSchema: z.object({ text: z.string() }),
    annotations: { readOnlyHint: true },
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);

server.registerTool(
  "fail",
  { description: "Always reports a tool-level error.", inputSchema: z.object({}) },
  async () => ({ content: [{ type: "text", text: "boom" }], isError: true }),
);

server.registerTool(
  "pic",
  { description: "Returns a 1x1 PNG plus a caption.", inputSchema: z.object({}) },
  async () => ({
    content: [
      { type: "text", text: "a tiny image" },
      {
        type: "image",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        mimeType: "image/png",
      },
    ],
  }),
);

server.registerTool(
  "slow",
  { description: "Waits the requested milliseconds.", inputSchema: z.object({ ms: z.number() }) },
  async ({ ms }) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { content: [{ type: "text", text: "done" }] };
  },
);

server.registerTool(
  "probe",
  { description: "Reports FIXTURE_SECRET and the process cwd.", inputSchema: z.object({}) },
  async () => ({
    content: [{ type: "text", text: `${process.env.FIXTURE_SECRET ?? ""}|${process.cwd()}` }],
  }),
);

server.registerTool(
  "spam",
  { description: "Returns 500 characters.", inputSchema: z.object({}) },
  async () => ({ content: [{ type: "text", text: "x".repeat(500) }] }),
);

await server.connect(new StdioServerTransport());
