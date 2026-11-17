/**
 * What a plugin's update rewrites, per Agent, for the update's confirmation: the Agent's name,
 * then each part whose installed copy differs from the library's, `old → new` (a Skill, the hook
 * package, a workbench), and each of the plugin's MCP servers the Agent carries, which the
 * reinstall replaces whole. It is what makes clear exactly what the overwrite touches — the
 * Plugins page lists every Agent it updates, an Agent's own settings list that one Agent.
 *
 * The rule of what differs is plugin-status.ts `changedParts`; this module only draws it.
 */
import type { PluginItem } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { changedParts, type AgentInstalls } from "./plugin-status";

export function PluginUpdateParts({
  plugin,
  agents,
}: {
  plugin: PluginItem;
  /** The Agents the update runs on: a key, the name as the dialog says it, what each has installed. */
  agents: ReadonlyArray<{ key: string; name: string; installs: AgentInstalls | undefined }>;
}) {
  return (
    <ul className="max-h-60 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
      {agents.map((agent) => (
        <li key={agent.key} className="px-3 py-1.5 text-xs">
          <span className="block truncate">{agent.name}</span>
          {changedParts(plugin, agent.installs).map((part) => (
            <span
              key={`${part.kind}:${part.name}`}
              className="mt-0.5 flex items-center justify-between gap-3 text-gray-500 dark:text-gray-400"
            >
              {part.kind === "hooks" ? (
                <span className="min-w-0 truncate">{S.plugins.detailHooks}</span>
              ) : part.kind === "mcp" ? (
                <span className="min-w-0 truncate">
                  <span className="font-mono">{part.name}</span> ({S.plugins.updatePartMcp})
                </span>
              ) : (
                <span className="min-w-0 truncate font-mono">{part.name}</span>
              )}
              {part.kind === "mcp" ? (
                <span className="shrink-0">{S.plugins.updatePartReplaced}</span>
              ) : (
                <span className="shrink-0 font-mono">
                  {part.installed || "?"} → {part.library}
                </span>
              )}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
