import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { libraryPlugin } from "../src/plugins/index.js";
import path from "node:path";

it("ships the Codex bridge with the opt-in skill and discovers tools through the real MCP client", async () => {
  const plugin = libraryPlugin("use-codex")!;
  expect(plugin.preinstall).toBe(false);
  expect(plugin.skills[0]!.files?.["scripts/server.mjs"]).toContain("tools/list");
  const client = new Client({ name: "penguin-test", version: "1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.resolve(
        import.meta.dirname,
        "../../../plugins/use-codex/skills/codex/scripts/server.mjs",
      ),
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
  } finally {
    await client.close();
  }
});
