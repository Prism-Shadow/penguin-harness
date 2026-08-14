/** Configurable-size stdio MCP fixture used only by the explicit live tool-exposure A/B runner. */
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { curatedTools, syntheticTools } from "../../../../scripts/lib/tool-exposure-fixtures.mjs";

const server = new McpServer({ name: "penguin-tool-exposure-eval", version: "1.0.0" });
const toolCount = Number(process.env.PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT ?? 50);
const schemaNamespace = process.env.PENGUIN_TOOL_EXPOSURE_EVAL_SCHEMA_NAMESPACE?.trim();
if (!Number.isInteger(toolCount) || toolCount < curatedTools.length) {
  throw new Error(
    `PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT must be an integer >= ${curatedTools.length}`,
  );
}
const tools = [...curatedTools, ...syntheticTools(toolCount - curatedTools.length)];

function zodField(schema) {
  let field;
  if (schema.type === "boolean") field = z.boolean();
  else if (schema.type === "integer" || schema.type === "number") field = z.number();
  else field = z.string();
  if (typeof schema.description === "string") field = field.describe(schema.description);
  return field;
}

function resultText(name, args) {
  switch (name) {
    case "github_create_issue":
      return `Created issue "${args.title}" in ${args.repository}.`;
    case "github_search_issues":
      return `Found issue "Broken export" for query: ${args.query}.`;
    case "calendar_free_busy":
      return `Available on ${args.date}: 10:00-11:00 UTC.`;
    case "postgres_describe_table":
      return `Table ${args.table}: id integer, email text, created_at timestamp.`;
    case "slack_post_message":
      return `Posted to ${args.channel}: ${args.text}`;
    default:
      return `[evaluation success: ${name} executed]`;
  }
}

for (const [index, definition] of tools.entries()) {
  const name = definition.name.replace(/^mcp__/, "").replaceAll("__", "_");
  const properties = definition.parameters?.properties ?? {};
  const required = new Set(definition.parameters?.required ?? []);
  const inputShape = Object.fromEntries(
    Object.entries(properties).map(([key, schema]) => {
      const field = zodField(schema);
      return [key, required.has(key) ? field : field.optional()];
    }),
  );
  server.registerTool(
    name,
    {
      description:
        schemaNamespace && index === 0
          ? `[evaluation schema ${schemaNamespace}] ${definition.description}`
          : definition.description,
      inputSchema: z.object(inputShape),
    },
    async (args) => ({ content: [{ type: "text", text: resultText(name, args) }] }),
  );
}

await server.connect(new StdioServerTransport());
