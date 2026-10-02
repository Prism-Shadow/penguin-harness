/**
 * A tool call in the transcript: one line by default — status icon, the tool's name, a one-line
 * subtitle, the duration (a live clock while it runs) — that expands to the call's full arguments,
 * its output and any images it returned. A call waiting on a person's decision shows its
 * approval block under the row whatever the collapsed state, and a footer (a spawned subagent's
 * row) is always shown below the details.
 *
 * The row names no outcome in words: the status icon, with the caller's state label as its
 * accessible name and tooltip, carries how the call ended or was decided (a failure also turns
 * the name to the danger ink), and a waiting call's hourglass is enough because its approval
 * block is on screen. The row's right end holds one thing at a time: a marker saying where the
 * call's work went ("background"), or an action the caller offers on a running call (send it to
 * the background). An action is a text button with no padding of its own, so a row carrying one
 * measures like a row without.
 *
 * The row is the shared `DisclosureRow` in its two-button form (the end parts and an action
 * cannot sit inside the row's button, so the chevron follows them as a button of its own), so a
 * tool call reads, folds and pins exactly like a thinking row: stacked sticky, the second level,
 * pinning right below the stuck group head while the expanded output scrolls, and landing the
 * view back on the row when collapsed from stuck. As a step of the agent's work it carries the
 * activity hook: the tool's name is its label, the subtitle and the duration its details.
 *
 * Copy is the caller's: the name (an alias, when it resolves one), the subtitle, the state label,
 * the marker, the action, the approval buttons' words and the images' alt text all arrive as
 * props. What the caller decides from the call's own data — the preview, the payload, the
 * duration's segments — does too; this component only lays them out.
 */
import type { ReactNode } from "react";
import { Button } from "../../actions/button/button";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { LiveDuration, formatDuration } from "../../feedback/duration-slot/duration-slot";
import {
  DISCLOSURE_OUTPUT_PRE_CLASS,
  DisclosureRow,
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
  const row = (
    <DisclosureRow
      sticky
      activity={{ kind: "tool", state: activityState(state) }}
      // A waiting call is running work, but nothing executes until it is decided.
      inFlight={state === "running"}
      icon={<StatusIcon state={state} label={stateLabel} />}
      // The tool's name is the label slot but not a fixed phrase, so it is set here, in the
      // code face and the body ink (the danger ink once the call failed).
      trailing={
        <>
          <span
            data-tooltip={nameTooltip}
            data-tooltip-content="code"
            data-slot="label"
            className={`shrink-0 truncate font-mono text-xs font-semibold ${
              state === "failed" ? "text-tone-danger-fg" : "text-fg"
            }`}
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
        </>
      }
      end={{
        parts: (
          <>
            {marker !== undefined && (
              <span className="shrink-0 font-mono text-xs text-fg-subtle">{marker}</span>
            )}
            {action !== undefined && (
              // The row's own type size and no padding, so the row measures the same with it.
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
          </>
        ),
        ...(expandLabel !== undefined ? { expandLabel } : {}),
        ...(collapseLabel !== undefined ? { collapseLabel } : {}),
      }}
      under={
        pending !== undefined ? (
          <ApprovalBlock name={name} nameTooltip={nameTooltip} {...pending} />
        ) : undefined
      }
    >
      {/* The parts sit directly in the row's body, each ruled off the one above, so a theme
          that draws no rules finds every one of them where it finds a row body's top rule. */}
      <>
        {argumentsText && (
          // Wrapped in full, no height cap and no scrollbar: the arguments are what the call
          // means, and an inner scroll would fight the transcript's own.
          <pre className="anim-fade whitespace-pre-wrap break-all border-t border-line-muted bg-surface-inset px-3 py-2 text-xs text-fg-muted">
            {argumentsText}
          </pre>
        )}
        {(output || outputStreaming) && (
          <pre className={`anim-fade ${DISCLOSURE_OUTPUT_PRE_CLASS}`}>
            {output}
            {outputStreaming && <StreamingCaret />}
          </pre>
        )}
        {images !== undefined && images.srcs.length > 0 && (
          <div className="anim-fade flex flex-wrap gap-2 border-t border-line-muted px-3 py-2">
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
      </>
    </DisclosureRow>
  );
  if (footer === undefined || footer === null) return row;
  return (
    <div>
      {row}
      <div className="px-3 py-2">{footer}</div>
    </div>
  );
}
