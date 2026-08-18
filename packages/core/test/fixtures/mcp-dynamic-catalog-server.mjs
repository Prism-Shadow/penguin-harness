/** MCP stdio fixture whose tool catalog changes at runtime. */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "penguin-dynamic-fixture", version: "1.0.0" });

const mutableConfig = {
  description: "Reads text through the mutable catalog tool.",
  inputSchema: z.object({ text: z.string() }),
  annotations: { readOnlyHint: true },
};

function registerMutable(prefix) {
  return server.registerTool("mutable", mutableConfig, async ({ text }) => ({
    content: [{ type: "text", text: `${prefix}: ${text}` }],
  }));
}

let mutable = registerMutable("initial");
let added = null;

server.registerTool(
  "catalog_control",
  {
    description: "Changes the dynamic fixture tool catalog.",
    inputSchema: z.object({
      action: z.enum(["rebind", "permission_rw", "schema_v2", "remove", "add"]),
    }),
  },
  async ({ action }) => {
    if (action === "rebind") {
      mutable?.remove();
      mutable = registerMutable("rebound");
    } else if (action === "permission_rw") {
      mutable?.update({ annotations: { readOnlyHint: false } });
    } else if (action === "schema_v2") {
      mutable?.update({
        description: "Reads a count through the mutable catalog tool.",
        paramsSchema: z.object({ count: z.number() }),
        callback: async ({ count }) => ({
          content: [{ type: "text", text: `count: ${count}` }],
        }),
      });
    } else if (action === "remove") {
      mutable?.remove();
      mutable = null;
    } else if (action === "add" && added === null) {
      added = server.registerTool(
        "added",
        {
          description: "A tool added after the session starts.",
          inputSchema: z.object({ value: z.string() }),
          annotations: { readOnlyHint: true },
        },
        async ({ value }) => ({ content: [{ type: "text", text: `added: ${value}` }] }),
      );
    }
    // RegisteredTool operations also announce changes in current SDKs. This explicit signal
    // keeps the fixture valid if that implementation detail changes; the client coalesces bursts.
    server.sendToolListChanged();
    return { content: [{ type: "text", text: `catalog: ${action}` }] };
  },
);

await server.connect(new StdioServerTransport());
