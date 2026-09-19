import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { libraryPlugin } from "../src/plugins/index.js";
import path from "node:path";

it("ships the Codex bridge with the opt-in skill and discovers tools through the real MCP client", async () => {
  const plugin = libraryPlugin("use-codex")!;
  expect(plugin.preinstall).toBe(false);
  expect(plugin.skills[0]!.files?.["scripts/server.mjs"]).toBeUndefined();
  const client = new Client({ name: "penguin-test", version: "1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve(import.meta.dirname, "../../../plugins/use-codex/src/server.mjs"),
      "--project-dir",
      path.resolve(import.meta.dirname),
    ],
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(8);
    expect(tools.find((t) => t.name === "codex_run")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "codex_poll")?.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({
      name: "codex_run",
      arguments: { sandbox: "danger-full-access" },
    });
    expect(result.isError).toBe(true);
    // Invalid input is rejected before launching Codex or creating a credential directory.
    const missing = await client.callTool({
      name: "codex_poll",
      arguments: { task_id: "unknown" },
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.content)).toContain("Unknown task ID");
  } finally {
    await client.close();
  }
});
