/**
 * MCP connect banner: between mcp_connect_begin and mcp_connect_end the first run is
 * connecting the configured MCP Servers — without this line the pre-first-request wait
 * reads as a silent hang. Once done it collapses to a one-line note with the wall time;
 * servers that failed to connect are listed on the same line (their tools are simply
 * absent for the Session — non-fatal, matching core's warn-and-skip stance).
 */
import { S } from "../../lib/strings";
import type { McpConnectItem } from "../../lib/omni/stream-model";

export function McpConnectBanner({ item }: { item: McpConnectItem }) {
  if (item.running) {
    return (
      <div className="anim-msg my-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        {S.chat.mcpConnecting(item.servers)}
      </div>
    );
  }
  return (
    <div className="my-1 space-y-0.5">
      <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
        {item.aborted
          ? S.chat.mcpConnectAborted
          : S.chat.mcpConnectDone(item.durationMs ?? 0, item.failed ?? [])}
      </p>
      {/* Per-server failure details: without these the banner only names the server, and
          the real reason (spawn error, timeout, HTTP status) never reaches the user. */}
      {(item.failedDetails ?? []).map((line) => (
        <p key={line} className="font-mono text-xs break-all text-gray-400 dark:text-gray-500">
          {line}
        </p>
      ))}
    </div>
  );
}
