/**
 * MCP connect row: between mcp_connect_begin and mcp_connect_end the first run is
 * connecting the configured MCP Servers — without this row the pre-first-request wait
 * reads as a silent hang. One StepBanner across all states (same shell as the
 * reasoning-&-tools group header): connecting shows the server list with a live tick;
 * done leads with the discovered-tool count and expands into the tool list; failures put
 * every per-server reason on the SAME line as the wall time (servers that failed are
 * simply absent from the toolset — non-fatal, matching core's warn-and-skip stance).
 */
import { S } from "../../lib/strings";
import type { McpConnectItem } from "../../lib/omni/stream-model";
import { StepBanner } from "./step-banner";

export function McpConnectBanner({ item }: { item: McpConnectItem }) {
  if (item.running) {
    return (
      <StepBanner
        state="running"
        title={S.chat.mcpConnectTitle}
        detail={S.chat.mcpServerList(item.servers)}
        {...(item.beginTsMs !== undefined ? { liveSinceMs: item.beginTsMs } : {})}
      />
    );
  }
  const failed = item.aborted || (item.failed?.length ?? 0) > 0;
  const detail = item.aborted
    ? S.chat.mcpConnectAborted
    : S.chat.mcpConnectResult(item.toolCount ?? 0, item.failedDetails ?? []);
  const tools = item.tools ?? [];
  return (
    <StepBanner
      state={failed ? "failed" : "done"}
      title={S.chat.mcpConnectTitle}
      detail={detail}
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
    >
      {tools.length > 0 ? (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800/60">
          {tools.map((tool) => (
            <li key={tool.name} className="flex items-baseline gap-2 px-3 py-1.5">
              <code className="shrink-0 font-mono text-xs text-gray-700 dark:text-gray-300">
                {tool.name}
              </code>
              {tool.description !== undefined && (
                <span
                  title={tool.description}
                  className="min-w-0 truncate text-xs text-gray-400 dark:text-gray-500"
                >
                  {tool.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : undefined}
    </StepBanner>
  );
}
