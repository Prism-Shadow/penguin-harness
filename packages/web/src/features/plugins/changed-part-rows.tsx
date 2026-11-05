/**
 * The rows of a plugin update's confirmation that say what the reinstall rewrites on one Agent:
 * each Skill, workbench and the hook package with its `installed → library` versions, and each
 * MCP server, which is replaced whole. Shared by the Plugins page's update confirmation
 * (plugin-card.tsx) and the import dialog's install of the porting plugin, so both name the
 * overwrite the same way.
 */
import { S } from "../../lib/strings";
import type { ChangedPart } from "./plugin-status";

export function ChangedPartRows({ parts }: { parts: readonly ChangedPart[] }) {
  return (
    <>
      {parts.map((part) => (
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
    </>
  );
}
