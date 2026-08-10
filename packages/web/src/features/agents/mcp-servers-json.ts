/**
 * MCP Servers JSON editor helpers — parse/format between the Tools tab's text editor and
 * the `tools.mcpServers` config entries.
 *
 * Only the structural shape is validated here (an array of `{ name, config }` objects):
 * transport fields inside `config` are validated server-side on save (agent-config-service
 * reuses the core resolver), so the editor stays open to future config keys. Error details
 * are concise English fragments; the caller wraps them in a localized message.
 */
import type { MCPServerConfig } from "@prismshadow/penguin-core/interfaces";

export type McpServersParseResult =
  { ok: true; servers: MCPServerConfig[] } | { ok: false; error: string };

/** Renders entries as the editor's initial text (pretty-printed JSON; empty list = "[]"). */
export function formatMcpServersJson(servers: MCPServerConfig[]): string {
  return JSON.stringify(servers, null, 2);
}

/** Parses editor text; whitespace-only text counts as an empty list. */
export function parseMcpServersJson(text: string): McpServersParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, servers: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, error: "the top level must be an array" };
  }
  const servers: MCPServerConfig[] = [];
  for (const [i, item] of parsed.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: `entry ${i + 1} must be an object` };
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry["name"] !== "string" || entry["name"].trim() === "") {
      return { ok: false, error: `entry ${i + 1}: "name" must be a non-empty string` };
    }
    const config = entry["config"];
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      return { ok: false, error: `entry ${i + 1}: "config" must be an object` };
    }
    servers.push(entry as unknown as MCPServerConfig);
  }
  return { ok: true, servers };
}
