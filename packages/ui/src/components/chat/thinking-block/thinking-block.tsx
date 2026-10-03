/**
 * The thinking row: one step inside a work group — status icon, "Thinking", the elapsed time —
 * that expands to the full thinking text. It is the shared disclosure row, so its metrics and
 * colour states are the ones every other disclosure row uses, and it shares the run-state icons
 * (in progress, done, failed) with the tool-call rows. As a step of the agent's work it carries
 * the activity hook. Its text streams through `StreamText`, so it arrives the way a reply does.
 */
import {
  DISCLOSURE_BODY_MD_CLASS,
  DisclosureRow,
  activityState,
} from "../../layout/disclosure-row/disclosure-row";
import { LiveDuration, formatDuration } from "../../feedback/duration-slot/duration-slot";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import type { RunState } from "../../icons/status-icon/status-icon";
import { StreamText } from "../stream-text/stream-text";

export interface ThinkingBlockProps {
  /** Running while the text streams, failed when it stopped short, done otherwise. */
  state: Extract<RunState, "running" | "done" | "failed">;
  /** The status icon's accessible name and tooltip ("Running", "Done", the stop reason). */
  stateLabel?: string;
  /** The row's label ("Thinking"). */
  label: string;
  /** The thinking text, Markdown; it streams while the row runs. */
  text: string;
  /** When the thinking started: the live clock's origin while it runs. */
  startedAtMs?: number;
  /** The settled duration, once finished. */
  durationMs?: number;
  /** Why a failed step stopped, shown in brackets after the duration. */
  stopReason?: string;
}

export function ThinkingBlock({
  state,
  stateLabel,
  label,
  text,
  startedAtMs,
  durationMs,
  stopReason,
}: ThinkingBlockProps) {
  const streaming = state === "running";
  return (
    <DisclosureRow
      sticky
      activity={{ kind: "thinking", state: activityState(state) }}
      icon={<StatusIcon state={state} label={stateLabel} />}
      label={label}
      trailing={
        <>
          <span data-slot="detail" className="shrink-0 font-mono text-xs text-fg-muted">
            {streaming ? (
              <LiveDuration sinceMs={startedAtMs} />
            ) : durationMs !== undefined ? (
              formatDuration(durationMs)
            ) : null}
          </span>
          {state === "failed" && stopReason !== undefined && (
            <span className="font-mono text-xs text-fg-subtle">[{stopReason}]</span>
          )}
        </>
      }
    >
      <StreamText className={DISCLOSURE_BODY_MD_CLASS} text={text} streaming={streaming} />
    </DisclosureRow>
  );
}
