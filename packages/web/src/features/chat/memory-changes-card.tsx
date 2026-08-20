/**
 * Memory-change summary card, rendered right below the file-summary card at the end of a
 * root Task (same visual family): one row per memory topic file the Task changed through
 * the structured file tools, derived by the stream model (TaskStatsItem.memoryChanges —
 * see lib/omni/memory-changes.ts for what qualifies and what is filtered).
 *
 * Rows are not clickable — memory lives outside the Workspace, so the Files panel can't
 * preview it; the header instead carries one flat icon button that jumps to the Agent's
 * memory tab (`/agents/<id>?tab=memory`), the existing full view of these files.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import type { MemoryChangeRow } from "../../lib/omni/memory-changes";
import { PathLabel } from "./message-files-card";

const MAX_VISIBLE = 3;

/** Scope marker: icon + tooltip (user vs. workspace memory), no text label in the row. */
function ScopeIcon({ row }: { row: MemoryChangeRow }) {
  const title =
    row.scope === "user" ? S.chat.memoryScopeUser : S.chat.memoryScopeWorkspace(row.scopeKey ?? "");
  return (
    <span title={title} className="shrink-0 text-gray-400">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {row.scope === "user" ? (
          <>
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </>
        ) : (
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        )}
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

/** Change-type marker: write (full-content write, also covers creation) vs. in-place edit. */
function OpIcon({ op }: { op: MemoryChangeRow["op"] }) {
  const title = op === "write" ? S.chat.memoryOpWrite : S.chat.memoryOpEdit;
  return (
    <span title={title} className="shrink-0 text-gray-400">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {op === "write" ? (
          <>
            <path d="M6 3h8l4 4v14H6z" />
            <path d="M12 11v6M9 14h6" />
          </>
        ) : (
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
        )}
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

export function MemoryChangesCard({
  rows,
  onOpenMemory,
}: {
  rows: MemoryChangeRow[];
  /** Jumps to the Agent's memory tab; the header button doesn't render if this isn't wired up. */
  onOpenMemory?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const visible = expanded ? rows : rows.slice(0, MAX_VISIBLE);
  const hidden = rows.length - visible.length;

  return (
    <div className="anim-msg my-3 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {/* Header bar, mirroring the file-summary card: "icon + N memory updates", plus the one
          card-level action — rows have none, so this doesn't duplicate anything. */}
      <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800/60 dark:bg-gray-800/40">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="shrink-0 text-gray-400"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {S.chat.memoryChangesTitle(rows.length)}
        </span>
        {onOpenMemory && (
          <button
            type="button"
            title={S.chat.openAgentMemory}
            onClick={onOpenMemory}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
            <span className="sr-only">{S.chat.openAgentMemory}</span>
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
        {visible.map((row) => (
          <div
            key={`${row.scope} ${row.scopeKey ?? ""} ${row.file}`}
            className="flex w-full items-center gap-2 px-3 py-2"
          >
            <ScopeIcon row={row} />
            <PathLabel path={row.file} />
            <span className="min-w-0 flex-1" />
            <OpIcon op={row.op} />
          </div>
        ))}
        {(hidden > 0 || expanded) && rows.length > MAX_VISIBLE && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800/50"
          >
            {expanded ? S.chat.showLess : S.chat.memoryShowMore(hidden)}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
