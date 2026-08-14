/** MCP stdio fixture whose tool catalog changes at runtime. */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { writeFileSync } from "node:fs";
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
let stormTimer = null;
let failListsUntil = 0;
const statsFile = process.env.PENGUIN_DYNAMIC_CATALOG_STATS_FILE;
const listRequestStartedAt = [];

function recordListRequest() {
  if (!statsFile) return;
  listRequestStartedAt.push(Date.now());
  writeFileSync(statsFile, JSON.stringify({ listRequestStartedAt }), "utf8");
}

server.registerTool(
  "catalog_control",
  {
    description: "Changes the dynamic fixture tool catalog.",
    inputSchema: z.object({
      action: z.enum([
        "rebind",
        "permission_rw",
        "schema_v2",
        "remove",
        "add",
        "storm",
        "fail_refresh",
      ]),
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
    } else if (action === "storm") {
      if (stormTimer !== null) clearInterval(stormTimer);
      const deadline = Date.now() + 10_000;
      stormTimer = setInterval(() => {
        if (Date.now() >= deadline) {
          clearInterval(stormTimer);
          stormTimer = null;
          return;
        }
        server.sendToolListChanged();
      }, 5);
      stormTimer.unref();
    } else if (action === "fail_refresh") {
      failListsUntil = Date.now() + 10_000;
    }
    // RegisteredTool operations also announce changes in current SDKs. This explicit signal
    // keeps the fixture valid if that implementation detail changes; the client coalesces bursts.
    server.sendToolListChanged();
    return { content: [{ type: "text", text: `catalog: ${action}` }] };
  },
);

// Keep list responses in flight during the synthetic storm so at least one notification lands
// inside every refresh. Without the delay, the stdio round trip can finish between timer ticks and
// accidentally create a momentary quiet window, which does not exercise refresh starvation.
const listToolsHandler = server.server._getRequestHandler("tools/list");
if (listToolsHandler === undefined) throw new Error("tools/list handler was not registered");
server.server.setRequestHandler("tools/list", async (request, ctx) => {
  recordListRequest();
  if (stormTimer !== null) await new Promise((resolve) => setTimeout(resolve, 25));
  if (Date.now() < failListsUntil) throw new Error("synthetic catalog refresh failure");
  return listToolsHandler(request, ctx);
});

await server.connect(new StdioServerTransport());
