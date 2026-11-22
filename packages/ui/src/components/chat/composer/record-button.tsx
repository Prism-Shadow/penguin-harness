/**
 * The composer's dictation button: one square in the toolbar's right group, directly before the
 * action button, that keeps its place for a whole dictation.
 *
 * - `idle` is the quiet microphone, the toolbar triggers' look;
 * - `recording` is the filled success square with a check: pressing it again finishes;
 * - `waiting` holds a spinner while the microphone opens or the recording is transcribed, and
 *   takes no press — cancelling is the caller's own control (and Esc).
 *
 * It is the same 32px square as `SendButton` in every state, so the right group keeps its width
 * from the first press to the inserted text and nothing beside it moves. The label is the
 * accessible name and the tooltip, and says what a press does now ("Dictate", "Finish
 * recording"); while waiting, it names what is running.
 */
import type { Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { CheckIcon } from "../../icons/marks/marks";
import { Spinner } from "../../icons/spinner/spinner";

export type RecordButtonState = "idle" | "recording" | "waiting";

const SQUARE =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150";

const LOOK: Record<RecordButtonState, string> = {
  idle: "text-fg-muted hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
  recording:
    "bg-tone-success-emphasis text-tone-success-emphasis-fg hover:bg-tone-success-emphasis/85",
  waiting: "cursor-wait text-fg-muted",
};

export function RecordButton({
  state,
  label,
  disabled = false,
  onClick,
  ref,
}: {
  state: RecordButtonState;
  /** What a press does now, or (waiting) what is running: the accessible name and the tooltip. */
  label: string;
  /** Only the idle microphone can be disabled; a running dictation always finishes or waits. */
  disabled?: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const waiting = state === "waiting";
  return (
    <button
      ref={ref}
      type="button"
      data-state={state}
      aria-label={label}
      data-tooltip={label}
      aria-busy={waiting || undefined}
      // A waiting square keeps focus (it is where the finished text hands focus back from), so it
      // is inert by its handler rather than `disabled`, which would drop focus to the page.
      aria-disabled={waiting || undefined}
      disabled={state === "idle" && disabled}
      onClick={waiting ? undefined : onClick}
      className={`${SQUARE} ${LOOK[state]}`}
    >
      {state === "recording" ? (
        <CheckIcon size={ICON_SIZE.iconButton} />
      ) : waiting ? (
        <span aria-hidden>
          <Spinner size="sm" label={label} />
        </span>
      ) : (
        <GlyphIcon d={ICONS.microphone} size={ICON_SIZE.iconButton} />
      )}
    </button>
  );
}
