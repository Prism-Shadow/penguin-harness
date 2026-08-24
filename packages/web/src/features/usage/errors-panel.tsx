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
import { useEffect, useState } from "react";
import type { UsageErrorItem, UsageErrors } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime } from "../../lib/format";
import { Badge } from "../../components/ui/badge";
import { Empty } from "./usage-charts";
import { toneInk } from "../../lib/tone";

/** The two error categories. */
type ErrorKindKey = "unexpected" | "expected";

/** Copy: S is a runtime live binding (switching language remounts the whole tree), so it must be read at render time. */
function kindLabel(key: ErrorKindKey): string {
  return key === "unexpected" ? S.usage.errorsUnexpected : S.usage.errorsExpected;
}

function kindOf(kind: string): ErrorKindKey {
  return kind === "unexpected" ? "unexpected" : "expected";
}

/**
 * Source labels are abbreviated so the bracket stays narrow beside a long code:
 * `[env] tool_failed:exec_command`, `[http] password`. Only `environment` needs shortening
 * -- every other source is already short enough to read at a glance.
 */
const SOURCE_ABBREV: Readonly<Record<string, string>> = { environment: "env" };

/** `[env] tool_failed:read_file` -- the bracketed source followed by the raw error code. */
function sourceCode(source: string, code: string): string {
  return `[${SOURCE_ABBREV[source] ?? source}] ${code}`;
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
    ? toneInk.danger
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

/** Header cell: left-aligned, recessive gray. */
function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`py-1.5 pr-2 font-medium ${className}`}>{children}</th>;
}

/**
 * Error panel: stats + a recent-errors table (the server already takes the top N, newest first).
 * The message column shows **one line per error by default** (kept compact — an error storm can
 * fill the table); clicking a message expands it in place to the full text (wrapping, newlines
 * preserved — the upstream detail after the code, e.g. a provider's 402 body, is what matters),
 * and clicking again collapses it. The full text is also in the hover title. Cells align to the
 * top so an expanded multi-line message keeps the row tidy; height is bounded by the page size
 * alone — the table never scrolls vertically (paging is the way past it). Its four columns need
 * a floor to stay legible, so on a viewport narrower than that floor the table scrolls
 * sideways inside its own box rather than dragging the page along with it.
 */
export function ErrorsPanel({
  errors,
  projectId,
  filters,
}: {
  errors: UsageErrors;
  projectId: string;
  /**
   * The dashboard's own date/agent filter — a page must never widen what the summary counted.
   * Memoize it at the call site: the fetch effect depends on the object's identity.
   */
  filters: { from?: string; to?: string; agentId?: string };
}) {
  const { total, unexpected, topCode, recent } = errors;
  // Page size is read off the first page rather than duplicating the server's ERROR_RECENT_N:
  // whenever a second page exists at all, `recent` is exactly that many rows, so the two cannot
  // drift apart into skipping or repeating rows. (Empty means a single empty page anyway.)
  const pageSize = Math.max(1, recent.length);
  // Paging: page 0 is the `recent` the dashboard response already carried, so it costs no
  // request; later pages are fetched on demand.
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<UsageErrorItem[]>(recent);
  // The row count the pager counts pages against: seeded from the dashboard snapshot, then
  // replaced by each page's own total. The snapshot goes stale (rows evicted by the row cap, an
  // Agent deleted between load and click), and pinning to it computes a page count that can
  // strand the caller on a page the data no longer has.
  const [pagedTotal, setPagedTotal] = useState(total);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A new dashboard response invalidates the offsets being paged through, so paging goes back to
  // page 0 — whose rows the effect below restores from that same response. Today the panel is
  // remounted on every filter change, which resets this anyway; the reset does not rely on that.
  useEffect(() => setPage(0), [recent]);

  // Every value this effect reads is a dep, the page-0 branch's included: one left out would be
  // served from a stale closure, and the repo has no lint rule that would catch it.
  useEffect(() => {
    // Page 0 is restored, never fetched — the dashboard response already carries it. Restoring
    // is the whole point of the early return: leaving `items` untouched would keep the previous
    // page's rows and its error on screen under a "page 1" label, with no way out short of
    // changing a filter.
    if (page === 0) {
      setItems(recent);
      setPagedTotal(total);
      setPageError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    api
      .getUsageErrors(projectId, { offset: page * pageSize, limit: pageSize, ...filters })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setPagedTotal(res.total);
      })
      .catch((e: unknown) => {
        // Keep the rows already on screen rather than blanking the table under an error.
        if (!cancelled) setPageError(apiErrorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, projectId, filters, recent, total]);

  const pageCount = Math.max(1, Math.ceil(pagedTotal / pageSize));
  // Message rows expanded to their full text (index into the current page); one line each by default.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => setExpanded(new Set()), [items]);
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
            value={`${sourceCode(topCode.source, topCode.code)} ×${topCode.count}`}
          />
        )}
      </div>

      {/* Recent-errors table */}
      {items.length === 0 ? (
        <Empty text={S.usage.errorsEmpty} />
      ) : (
        <div className="mt-2.5 overflow-x-auto overflow-y-clip border-t border-gray-200 dark:border-gray-800">
          {/* The three leading columns are fixed-width and the message column takes the rest, so
              the table has a minimum below which `table-fixed` starves the message column down to
              zero width and pushes the other three past the edge. `min-w` states that floor, and
              this box scrolls it sideways when the viewport is narrower — the page itself must
              never scroll sideways (styles.css). `overflow-y-clip` keeps browsers from reserving
              a vertical scrollbar gutter beside the horizontal one. */}
          <table className="w-full min-w-[720px] table-fixed text-xs">
            <thead className="text-left text-gray-400 dark:text-gray-500">
              <tr>
                <Th className="w-32">{S.common.time}</Th>
                {/* Wide enough to fully fit the longest error code: a tool
                    failure's code carries the tool name (e.g. [env]
                    tool_failed:exec_command), and truncating it would hide which tool failed. */}
                <Th className="w-72">{S.usage.errorsColCode}</Th>
                <Th className="w-20">{S.usage.errorsColKind}</Th>
                <Th>{S.usage.errorsColMessage}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((e, i) => {
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
                      <span className="block break-words">{sourceCode(e.source, e.code)}</span>
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

      {/* Pager: once there is more than one page — and unconditionally while paged away from
          the first, so a later page that came back empty or shrank below the page count still
          offers the way back instead of stranding the reader on a bare table. Kept outside the
          scroll box so it stays reachable without scrolling to the bottom of the rows. */}
      {(pageCount > 1 || page > 0) && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-gray-500 dark:text-gray-400">
          {pageError !== null && <span className="mr-auto text-rose-500">{pageError}</span>}
          <span className="tabular-nums">
            {S.usage.errorsPageOf(page + 1, pageCount, pagedTotal)}
          </span>
          <PagerButton
            label={S.usage.errorsNewer}
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          />
          <PagerButton
            label={S.usage.errorsOlder}
            disabled={page + 1 >= pageCount || loading}
            onClick={() => setPage((p) => p + 1)}
          />
        </div>
      )}
    </div>
  );
}

/** Pager step button: same recessive treatment as the rest of the panel's chrome. */
function PagerButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md border border-gray-200 px-2 py-0.5 transition-colors duration-150 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-800 dark:hover:bg-gray-800/60 dark:disabled:hover:bg-transparent"
    >
      {label}
    </button>
  );
}
