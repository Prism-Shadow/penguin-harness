/**
 * Shared shell for the stream's process banners (MCP connect, compaction): strictly the
 * "Reasoning & Tools" group-header anatomy (work-group.tsx) — same card, same sticky
 * title bar (StatusIcon + short title + mono detail + duration slot + chevron at the far
 * right), so running / success / failure are all the SAME row with only the icon and the
 * one-line detail changing. Duration sits right after the detail like the group header's
 * count+duration slots (LiveDuration ticking while running, the settled span with
 * decimals once finished); the flexible spacer keeps the chevron pinned at the right
 * edge. A body (e.g. the discovered-tool groups) makes the row expandable, collapsed by
 * default; collapsing while the sticky header is stuck scrolls the row back into view —
 * the exact behavior of the work-group header.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { humanizeDuration } from "../../lib/format";
import { Chevron } from "../../components/ui/chevron";
import { StatusIcon } from "../../components/ui/status-icon";
import type { RunState } from "../../components/ui/status-icon";
import { LiveDuration } from "./live-duration";
import { toneInk } from "../../lib/tone";

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
  /** Expandable body; its presence adds the chevron (collapsed by default, streaming included). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const running = state === "running";
  const expandable = children !== undefined && children !== null;

  const header = (
    <>
      <StatusIcon state={state} />
      <span
        className={`shrink-0 text-[11px] font-semibold tracking-wide uppercase ${running ? toneInk.busy : "text-gray-500 dark:text-gray-400"}`}
      >
        {title}
      </span>
      {/* Detail then duration, left-aligned after the title — the same slot order as the
          group header's step count + duration; the trailing spacer pins the chevron to the
          right edge. min-w-0 (not flex-1) lets a long detail truncate while a short one
          keeps the duration snug against it. */}
      {detail !== undefined && (
        <span title={detail} className="min-w-0 truncate font-mono text-xs text-gray-400">
          {detail}
        </span>
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
      <span className="min-w-0 flex-1" />
      {expandable && <Chevron open={open} className="text-gray-400" />}
    </>
  );

  return (
    // overflow-clip, not overflow-hidden: the sticky header below must stick to the message
    // list's scrollport, and an overflow-hidden ancestor would become its scroll container
    // (see work-group.tsx for the full reasoning).
    <div
      ref={rootRef}
      className="anim-msg my-2 overflow-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
    >
      {expandable ? (
        // Sticky offsets follow the work-group header exactly: -top-4 cancels the message
        // list's py-4 so the bar pins at the visible top; z-[5] above the row level, below
        // the stream's overlays; fully opaque background so scrolling rows can't bleed through.
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            // Collapsing while the header is stuck: bring the (now header-only) card back
            // into view once React commits — `nearest` makes every other case a no-op.
            const willClose = open;
            setOpen((v) => !v);
            if (willClose) {
              requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
            }
          }}
          className="sticky -top-4 z-[5] flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800"
        >
          {header}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left dark:bg-gray-900">
          {header}
        </div>
      )}
      {expandable && open && (
        <div className="anim-fade divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
          {children}
        </div>
      )}
    </div>
  );
}
