import { S } from "@prismshadow/penguin-web/internal";
import { humanizeDuration } from "@prismshadow/penguin-web/internal";
import type { McpConnectItem, McpServerOutcome, McpToolSummary } from "@prismshadow/penguin-web/internal";


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

/**
 * One server's row: a disclosure row of the connection event, whose body is its tool list or
 * its failure detail; a server with nothing to show is the same line, held still. The row has
 * no label: its name and its counts are details, set as written in every theme. Stacked
 * sticky, second level (the thinking/tool-row idiom): while its expanded body scrolls, the row
 * pins right below the banner's own sticky header, opaque so scrolling tool rows can't bleed
 * through.
 */
function ServerGroup({ outcome, tools }: { outcome: McpServerOutcome; tools: McpToolSummary[] }) {
  const failed = outcome.status === "fatal" || (outcome.status as string) === "failed";
  // Skipped before any connection: waiting on a vault value or a sign-in, not broken.
  const skipped =
    outcome.errorCode === "mcp_needs_setup" || outcome.errorCode === "mcp_sign_in_required";
  // A failed server expands into its error; a connected one into its tools (when any).
  const expandable = failed ? outcome.error !== undefined : tools.length > 0;
  const meta = !failed
    ? S.chat.mcpToolsCount(outcome.tools ?? 0)
    : outcome.errorCode === "mcp_needs_setup"
      ? S.chat.mcpServerNeedsSetup
      : outcome.errorCode === "mcp_sign_in_required"
        ? S.chat.mcpServerSignIn
        : S.chat.mcpServerFailed;
  const body = !expandable ? undefined : failed ? (
    <p className="anim-fade px-3 pt-0.5 pb-2 pl-8 font-mono text-xs break-all text-fg-muted">
      {outcome.error}
    </p>
  ) : (
    <ul className="anim-fade pb-1">
      {tools.map((tool) => (
        <li key={tool.name} className="flex items-baseline gap-2 py-1 pr-3 pl-8">
          <code className="shrink-0 font-mono text-xs text-fg">{tool.name}</code>
          {tool.description !== undefined && (
            <span
              data-tooltip={tool.description}
              data-tooltip-content="text"
              className="min-w-0 truncate text-xs text-fg-subtle"
            >
              {tool.description}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <DisclosureRow
      sticky
      activity={{ kind: "event", state: failed && !skipped ? "error" : "done" }}
      icon={<StatusIcon state={skipped ? "waiting" : failed ? "failed" : "done"} size="sm" />}
      // No label: the server's name is a detail, so no theme recases it.
      trailing={
        <>
          <code data-slot="detail" className="shrink-0 font-mono text-xs text-fg">
            {outcome.server}
          </code>
          <span data-slot="detail" className="min-w-0 truncate font-mono text-xs text-fg-subtle">
            {meta}
          </span>
          {outcome.durationMs > 0 && (
            <span data-slot="detail" className="shrink-0 font-mono text-xs text-fg-subtle">
              {humanizeDuration(outcome.durationMs)}
            </span>
          )}
        </>
      }
    >
      {body}
    </DisclosureRow>
  );
}

export function McpConnectBanner({ item }: { item: McpConnectItem }) {
  if (item.running) {
    return (
      <ActivityGroup
        kind="event"
        state="running"
        title={S.chat.mcpConnectTitle}
        detail={S.chat.mcpServerList(item.servers)}
        {...(item.beginTsMs !== undefined ? { startMs: item.beginTsMs } : {})}
      />
    );
  }
  // A server waiting on the user is named in the detail, not counted as a failure.
  const failed = item.aborted || (item.failed?.length ?? 0) > 0;
  const detail = item.aborted
    ? S.chat.mcpConnectAborted
    : S.chat.mcpConnectResult(item.toolCount ?? 0, item.failed ?? [], item.waiting ?? []);
  const results = item.results ?? [];
  const tools = item.tools ?? [];
  const serverNames = results.map((r) => r.server);
  return (
    <ActivityGroup
      kind="event"
      state={failed ? "failed" : "done"}
      title={S.chat.mcpConnectTitle}
      detail={detail}
      {...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {})}
      {...(results.length > 0
        ? {
            rows: results.map((outcome) => ({
              key: outcome.server,
              content: (
                <ServerGroup
                  outcome={outcome}
                  tools={tools.filter((t) => serverOf(t.name, serverNames) === outcome.server)}
                />
              ),
            })),
          }
        : {})}
    />
  );
}
