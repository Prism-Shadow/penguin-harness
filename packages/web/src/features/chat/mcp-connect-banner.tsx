/**
 * MCP connect row: between mcp_connect_begin and mcp_connect_end the first run is
 * connecting the configured MCP Servers — without this row the pre-first-request wait
 * reads as a silent hang. One StepBanner across all states (the same shell as the
 * reasoning-&-tools group header, shared with the compaction row): connecting shows the
 * server list with a live tick; once settled the header leads with the discovered-tool
 * count (failed servers are named, but only named — reasons live in the groups).
 * Expanding shows ONE GROUP PER SERVER — status icon, tool count / per-server connect
 * time — and expanding a group shows that server's tool list, or the full failure detail
 * for a server that could not connect (non-fatal either way, matching core's
 * warn-and-skip stance).
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { humanizeDuration } from "../../lib/format";
import { Chevron } from "../../components/ui/chevron";
import { StatusIcon } from "../../components/ui/status-icon";
import type { McpConnectItem, McpServerOutcome, McpToolSummary } from "../../lib/omni/stream-model";
import { StepBanner } from "./step-banner";

/**
 * Owner server of a prefixed tool name (`mcp__<server>__<tool>`), matched against the
 * known server list rather than split on "__": server names may themselves contain
 * underscores, so the longest matching prefix wins.
 */
function serverOf(toolName: string, servers: string[]): string | null {
  let best: string | null = null;
  for (const s of servers) {
    if (toolName.startsWith(`mcp__${s}__`) && (best === null || s.length > best.length)) best = s;
  }
  return best;
}

/** One server's group: a collapsible row; the body is its tool list, or the failure detail. */
function ServerGroup({ outcome, tools }: { outcome: McpServerOutcome; tools: McpToolSummary[] }) {
  const [open, setOpen] = useState(false);
  const failed = outcome.status === "fatal" || (outcome.status as string) === "failed";
  // A failed server expands into its error; a connected one into its tools (when any).
  const expandable = failed ? outcome.error !== undefined : tools.length > 0;
  const meta = failed ? S.chat.mcpServerFailed : S.chat.mcpToolsCount(outcome.tools ?? 0);

  const row = (
    <>
      <StatusIcon state={failed ? "failed" : "done"} size={11} />
      <code className="shrink-0 font-mono text-xs text-gray-700 dark:text-gray-300">
        {outcome.server}
      </code>
      <span className="min-w-0 truncate font-mono text-xs text-gray-400">{meta}</span>
      {outcome.durationMs > 0 && (
        <span className="shrink-0 font-mono text-xs text-gray-400">
          {humanizeDuration(outcome.durationMs)}
        </span>
      )}
      <span className="min-w-0 flex-1" />
      {expandable && <Chevron open={open} size={12} className="text-gray-400" />}
    </>
  );

  if (!expandable) {
    return <div className="flex w-full items-center gap-2 px-3 py-1.5">{row}</div>;
  }
  return (
    <div>
      {/* Stacked sticky, second level (the thinking/tool-row idiom): while this group's
          expanded body scrolls, its row pins right below the banner's own sticky header
          (top-4 = the header's -top-4 plus its height), opaque so scrolling tool rows
          can't bleed through. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="sticky top-4 z-[4] flex w-full items-center gap-2 bg-white px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800"
      >
        {row}
      </button>
      {open &&
        (failed ? (
          <p className="anim-fade px-3 pt-0.5 pb-2 pl-8 font-mono text-xs break-all text-gray-500 dark:text-gray-400">
            {outcome.error}
          </p>
        ) : (
          <ul className="anim-fade pb-1">
            {tools.map((tool) => (
              <li key={tool.name} className="flex items-baseline gap-2 py-1 pr-3 pl-8">
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
        ))}
    </div>
  );
}

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
    : S.chat.mcpConnectResult(item.toolCount ?? 0, item.failed ?? []);
  const results = item.results ?? [];
  const tools = item.tools ?? [];
  const serverNames = results.map((r) => r.server);
  return (
    <StepBanner
      state={failed ? "failed" : "done"}
      title={S.chat.mcpConnectTitle}
      detail={detail}
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
    >
      {results.length > 0
        ? results.map((outcome) => (
            <ServerGroup
              key={outcome.server}
              outcome={outcome}
              tools={tools.filter((t) => serverOf(t.name, serverNames) === outcome.server)}
            />
          ))
        : undefined}
    </StepBanner>
  );
}
