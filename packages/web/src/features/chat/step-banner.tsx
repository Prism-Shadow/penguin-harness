/**
 * Shared shell for the stream's process banners (MCP connect, compaction): the same card +
 * title-bar anatomy as the "Reasoning & Tools" group header (StatusIcon + short title +
 * mono detail + duration slot), so running / success / failure are all the SAME row with
 * only the icon and detail changing — no more bordered box while running collapsing into a
 * bare text line when done. The detail is a single truncating line (full text on hover);
 * a body (e.g. the discovered-tool list) makes the row expandable, collapsed by default.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { humanizeDuration } from "../../lib/format";
import { Chevron } from "../../components/ui/chevron";
import { StatusIcon } from "../../components/ui/status-icon";
import type { RunState } from "../../components/ui/status-icon";
import { LiveDuration } from "./live-duration";

export function StepBanner({
  state,
  title,
  detail,
  liveSinceMs,
  durationMs,
  children,
}: {
  state: RunState;
  /** Constant short label (the work-group header's title slot). */
  title: string;
  /** One-line status/result text; truncates with the full text as a tooltip. */
  detail?: string;
  /** Tick a live duration from this timestamp while running. */
  liveSinceMs?: number;
  /** Settled wall time once finished. */
  durationMs?: number;
  /** Expandable body; its presence adds the chevron (collapsed by default). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const running = state === "running";
  const expandable = children !== undefined && children !== null;

  const header = (
    <>
      <StatusIcon state={state} size={12} />
      <span
        className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide ${running ? "text-emerald-600 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"}`}
      >
        {title}
      </span>
      {/* The detail takes all free space (truncating as needed), so the duration and the
          chevron sit at the right edge like the work-group header's trailing slots. */}
      {detail !== undefined ? (
        <span
          title={detail}
          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-gray-400"
        >
          {detail}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {running
        ? liveSinceMs !== undefined && (
            <span className="shrink-0 font-mono text-xs text-gray-400">
              <LiveDuration sinceMs={liveSinceMs} />
            </span>
          )
        : durationMs !== undefined &&
          durationMs > 0 && (
            <span className="shrink-0 font-mono text-xs text-gray-400">
              {humanizeDuration(durationMs)}
            </span>
          )}
      {expandable && <Chevron open={open} className="text-gray-400" />}
    </>
  );

  const headerClass =
    "flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left dark:bg-gray-900";

  return (
    <div className="anim-msg my-2 overflow-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`${headerClass} transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`}
        >
          {header}
        </button>
      ) : (
        <div className={headerClass}>{header}</div>
      )}
      {expandable && open && (
        <div className="anim-fade border-t border-gray-200 dark:border-gray-800">{children}</div>
      )}
    </div>
  );
}
