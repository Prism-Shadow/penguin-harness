/**
 * Server-side error view for the cost center: **a single panel** — a row of small
 * stats up top (total / unexpected / expected / most common error code),
 * with a recent-errors table below (time, source · error code, kind,
 * message). What an error needs to answer is "what exactly went wrong" — a
 * detail table is more direct than a chart here: the count alone in the stats already covers the summary.
 *
 * Color semantics are consistent site-wide: unexpected (500s / runtime
 * exceptions) is a prominent rose; expected (HttpError, business 4xx) recedes into gray.
 * The outer frame is provided by the caller's ChartCard (full width, below the four business charts).
 */
import { useState } from "react";
import type { UsageErrors } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import { Badge } from "../../components/ui/badge";
import { Empty } from "./usage-charts";

/** The two error categories. */
type ErrorKindKey = "unexpected" | "expected";

/** Copy: S is a runtime live binding (switching language remounts the whole tree), so it must be read at render time. */
function kindLabel(key: ErrorKindKey): string {
  return key === "unexpected" ? S.usage.errorsUnexpected : S.usage.errorsExpected;
}

function kindOf(kind: string): ErrorKindKey {
  return kind === "unexpected" ? "unexpected" : "expected";
}

/** A single small stat: name + value, one row side by side (not turned into a chart). */
function Stat({
  label,
  value,
  alert,
  muted,
}: {
  label: string;
  value: string;
  /** Prominent value (unexpected errors): rose. */
  alert?: boolean;
  muted?: boolean;
}) {
  const tone = alert
    ? "text-rose-600 dark:text-rose-400"
    : muted
      ? "text-gray-500 dark:text-gray-400"
      : "text-gray-900 dark:text-gray-100";
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

/** Header cell: left-aligned, recessive gray; stickiness is handled by thead. */
function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`py-1.5 pr-2 font-medium ${className}`}>{children}</th>;
}

/**
 * Error panel: stats + a recent-errors table (the server already takes the top N, newest first).
 * The message column shows **one line per error by default** (kept compact — an error storm can
 * fill the table); clicking a message expands it in place to the full text (wrapping, newlines
 * preserved — the upstream detail after the code, e.g. a provider's 402 body, is what matters),
 * and clicking again collapses it. The full text is also in the hover title. Cells align to the
 * top so an expanded multi-line message keeps the row tidy; the table scrolls past max height.
 */
export function ErrorsPanel({ errors }: { errors: UsageErrors }) {
  const { total, unexpected, topCode, recent } = errors;
  // Message rows expanded to their full text (index into `recent`); one line each by default.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div>
      {/* Stats: a row of small stats (unexpected is prominent, expected recedes) */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
        <Stat label={S.usage.errorsTotal} value={String(total)} />
        <Stat
          label={S.usage.errorsUnexpected}
          value={String(unexpected)}
          alert={unexpected > 0}
          muted={unexpected === 0}
        />
        <Stat label={S.usage.errorsExpected} value={String(total - unexpected)} muted />
        {topCode && (
          <Stat
            label={S.usage.errorsTopCode}
            value={`${topCode.source} · ${topCode.code} ×${topCode.count}`}
          />
        )}
      </div>

      {/* Recent-errors table */}
      {recent.length === 0 ? (
        <Empty text={S.usage.errorsEmpty} />
      ) : (
        <div className="mt-2.5 max-h-72 overflow-y-auto border-t border-gray-200 dark:border-gray-800">
          <table className="w-full table-fixed text-xs">
            <thead className="sticky top-0 bg-white text-left text-gray-400 dark:bg-gray-900 dark:text-gray-500">
              <tr>
                <Th className="w-32">{S.common.time}</Th>
                {/* Wide enough to fully fit the longest error code: a tool
                    failure's code carries the tool name (e.g. environment ·
                    tool_failed:run_command), and truncating it would hide which tool failed. */}
                <Th className="w-72">{S.usage.errorsColCode}</Th>
                <Th className="w-20">{S.usage.errorsColKind}</Th>
                <Th>{S.usage.errorsColMessage}</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => {
                const key = kindOf(e.kind);
                return (
                  <tr
                    key={`${e.ts}-${i}`}
                    className="border-t border-gray-100 dark:border-gray-800/60"
                  >
                    <td className="py-1.5 pr-2 align-top font-mono tabular-nums text-gray-400">
                      {formatDateTime(e.ts)}
                    </td>
                    <td className="py-1.5 pr-2 align-top font-mono text-gray-500 dark:text-gray-400">
                      <span className="block break-words">
                        {e.source} · {e.code}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 align-top">
                      <Badge tone={key === "unexpected" ? "red" : "gray"}>{kindLabel(key)}</Badge>
                    </td>
                    <td className="py-1.5 align-top text-gray-500 dark:text-gray-400">
                      {/* One line by default; click to expand to the full message (wrapping), click again to collapse. */}
                      <button
                        type="button"
                        title={e.message}
                        onClick={() => toggle(i)}
                        className={`block w-full cursor-pointer text-left transition-colors hover:text-gray-700 dark:hover:text-gray-300 ${
                          expanded.has(i) ? "whitespace-pre-wrap break-words" : "truncate"
                        }`}
                      >
                        {e.message}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
