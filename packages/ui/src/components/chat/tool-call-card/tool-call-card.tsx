/**
 * A tool call in the transcript: one line by default — status icon, the tool's name, a one-line
 * subtitle, the duration (a live clock while it runs) — that expands to the call's full arguments,
 * its output and any images it returned. A call waiting on a person's decision shows its
 * approval block under the row whatever the collapsed state, and a footer (a spawned subagent's
 * row) is always shown below the details.
 *
 * The row names no outcome in words: the status icon, with the caller's state label as its
 * accessible name and tooltip, is the one carrier of how the call ended or was decided, and a
 * waiting call's hourglass is enough because its approval block is on screen. The row's right end
 * holds one thing at a time: a marker saying where the call's work went ("background"), or an
 * action the caller offers on a running call (send it to the background). An action is a text
 * button with no padding of its own, so a row carrying one measures like a row without.
 *
 * Stacked sticky, the second level (the thinking row's): while the expanded output scrolls, the
 * row pins right below the stuck work-group header, on an opaque ground. Collapsing from stuck
 * lands the view back on the row. As a step of the agent's work the row carries the activity
 * hook: the tool's name is its label, the subtitle and the duration its details.
 *
 * Copy is the caller's: the name (an alias, when it resolves one), the subtitle, the state label,
 * the marker, the action, the approval buttons' words and the images' alt text all arrive as
 * props. What the caller decides from the call's own data — the preview, the payload, the
 * duration's segments — does too; this component only lays them out.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { Chevron } from "../../icons/chevron/chevron";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { LiveDuration, formatDuration } from "../../feedback/duration-slot/duration-slot";
import {
  ActivityProgress,
  DISCLOSURE_OUTPUT_PRE_CLASS,
  DISCLOSURE_ROW_CLASS,
  DISCLOSURE_ROW_STICKY_CLASS,
  activityState,
} from "../../layout/disclosure-row/disclosure-row";
import { ZoomableImage } from "../../overlays/lightbox/lightbox";
import { ApprovalBlock } from "../approval-block/approval-block";
import { StreamingCaret } from "../assistant-text/streaming-caret";
import type { ApprovalRequest } from "../approval-block/approval-block";

/**
 * The duration slot: a settled span, or a live clock counting from `sinceMs` on top of an earlier
 * settled segment (`offsetMs`); a live clock with no known start shows an ellipsis.
 */
export type ToolCallDuration =
  { live: false; ms: number } | { live: true; sinceMs?: number; offsetMs?: number };

export interface ToolCallCardProps {
  /** Running (arguments streaming or executing), waiting (on an approval), or settled. */
  state: RunState;
  /** The status icon's accessible name and tooltip: the state, the decision, the stop reason. */
  stateLabel?: string;
  /** The tool's name as shown. */
  name: string;
  /** The tool's own name when `name` is an alias: its tooltip. */
  nameTooltip?: string;
  /** The human-readable line beside the name (the call's description, a file path). */
  subtitle?: string | null;
  duration?: ToolCallDuration;
  /** A word at the row's right end saying where the call's work went. */
  marker?: string;
  /** An action at the row's right end, in the marker's slot. */
  action?: { label: string; hint?: string; onClick: () => void };
  /** The call waits on a decision: the approval block shows under the row. */
  pending?: ApprovalRequest;
  /** The call's arguments as sent, shown in full when expanded. */
  argumentsText?: string;
  /** The call's output so far. */
  output?: string;
  /** The output is still arriving: a caret follows it. */
  outputStreaming?: boolean;
  /** Images the call returned, shown as thumbnails that zoom when pressed. */
  images?: { srcs: readonly string[]; alt: string };
  /** Always shown below the details, whatever the collapsed state (a subagent's row). */
  footer?: ReactNode;
  /** The chevron's name while collapsed; the interface's word for "expand" by default. */
  expandLabel?: string;
  /** The chevron's name while expanded; the interface's word for "collapse" by default. */
  collapseLabel?: string;
}

export function ToolCallCard({
  state,
  stateLabel,
  name,
  nameTooltip,
  subtitle,
  duration,
  marker,
  action,
  pending,
  argumentsText,
  output,
  outputStreaming = false,
  images,
  footer,
  expandLabel,
  collapseLabel,
}: ToolCallCardProps) {
  const strings = useUiStrings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Shared by the row and the chevron beside it: two buttons, one disclosure. Collapsing while
  // the row is stuck lands the view back on the row.
  const toggleOpen = (): void => {
    const willClose = open;
    setOpen((v) => !v);
    if (willClose) {
      requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
    }
  };

  return (
    <div ref={rootRef}>
      <div
        className={`ui-activity ${DISCLOSURE_ROW_STICKY_CLASS} ${DISCLOSURE_ROW_CLASS}`}
        data-kind="tool"
        data-state={activityState(state)}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={toggleOpen}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
        >
          <StatusIcon state={state} label={stateLabel} />
          <span
            data-tooltip={nameTooltip}
            data-tooltip-content="code"
            data-slot="label"
            className="shrink-0 truncate font-mono text-xs font-semibold text-fg"
          >
            {name}
          </span>
          {subtitle && (
            <span data-slot="detail" className="min-w-0 shrink truncate text-xs text-fg-muted">
              {subtitle}
            </span>
          )}
          <span data-slot="detail" className="shrink-0 font-mono text-xs text-fg-muted">
            {duration === undefined ? null : duration.live ? (
              <LiveDuration sinceMs={duration.sinceMs} offsetMs={duration.offsetMs} />
            ) : (
              formatDuration(duration.ms)
            )}
          </span>
          <ActivityProgress running={state === "running"} />
          <span className="min-w-0 flex-1" />
        </button>
        {marker !== undefined && (
          <span className="shrink-0 font-mono text-xs text-fg-subtle">{marker}</span>
        )}
        {action !== undefined && (
          // The row's own type size and no padding, so the row measures the same with it; a
          // sibling of the row button, since a button cannot hold another.
          <Button
            variant="link"
            size="sm"
            title={action.hint}
            onClick={action.onClick}
            className="shrink-0"
          >
            {action.label}
          </Button>
        )}
        {/* Named for what it does, like every chevron toggle: naming it after the tool would give
            the row two buttons under one name. */}
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? (collapseLabel ?? strings.collapse) : (expandLabel ?? strings.expand)}
          onClick={toggleOpen}
          className="flex shrink-0 items-center self-stretch"
        >
          <Chevron open={open} className="text-fg-subtle" />
        </button>
      </div>

      {pending !== undefined && (
        <ApprovalBlock name={name} nameTooltip={nameTooltip} {...pending} />
      )}

      {open && (
        <div className="anim-fade">
          {argumentsText && (
            // Wrapped in full, no height cap and no scrollbar: the arguments are what the call
            // means, and an inner scroll would fight the transcript's own.
            <pre className="whitespace-pre-wrap break-all border-t border-line-muted bg-surface-inset px-3 py-2 text-xs text-fg-muted">
              {argumentsText}
            </pre>
          )}
          {(output || outputStreaming) && (
            <pre className={DISCLOSURE_OUTPUT_PRE_CLASS}>
              {output}
              {outputStreaming && <StreamingCaret />}
            </pre>
          )}
          {images !== undefined && images.srcs.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-line-muted px-3 py-2">
              {images.srcs.map((src, i) => (
                <ZoomableImage
                  key={i}
                  src={src}
                  alt={images.alt}
                  className="max-h-40 max-w-full rounded-md border border-line"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {footer !== undefined && footer !== null && <div className="px-3 py-2">{footer}</div>}
    </div>
  );
}
