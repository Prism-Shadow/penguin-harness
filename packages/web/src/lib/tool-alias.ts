/**
 * Short display names for the built-in tools, shown on the chat's tool-call card in place
 * of the name the model calls them by, while the Appearance switch is on.
 *
 * Display-only, and that boundary is load-bearing: the tool name keys real behaviour all
 * over the app — which tools carry a `description` argument, which are previewed by a file
 * path, which spawns a subagent, the Agent settings tools table (where the name IS the
 * config key), and the permission rules a user writes. Resolve a name through this helper
 * at the render expression only; an alias must never reach a comparison or a lookup key.
 *
 * Only the built-in tools have an entry. An MCP tool (always `mcp__<server>__<tool>`) and
 * the names only older Traces still carry (`kill_command`, `read_image`, `describe_image`,
 * `kill_subagent`) render exactly as they are, in either switch position.
 */
import { S } from "./strings";

/**
 * How a tool call is named on screen: the short alias when the reader has them on and the
 * tool is one of the built-ins, the tool's own name otherwise.
 */
export function toolDisplayName(name: string, aliased: boolean): string {
  if (!aliased) return name;
  return S.chat.toolAliases[name] ?? name;
}
