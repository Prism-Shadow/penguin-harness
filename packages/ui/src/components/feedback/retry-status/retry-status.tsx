/**
 * The one retry experience every surface that retries or reconnects shares: where things stand,
 * when the next try comes, when the automatic tries stopped, and the press that tries again.
 *
 * Four phases, each one mark and one sentence:
 *
 * - `trying` — an attempt is running: the spinner, and no button to press (there is nothing to
 *   hurry).
 * - `waiting` — an attempt failed and the next is scheduled: the hourglass in the attention tone,
 *   a countdown to `nextAt` that ticks each second, and the main action ("Retry now").
 * - `gaveUp` — the automatic attempts stopped at their stated limit: the pause mark in the
 *   attention tone, why in muted words, and the main action ("Retry").
 * - `blocked` — retrying cannot help until someone acts (a refused key, a broken config, a
 *   refused password): the cross in the danger tone — only the mark is red — and the fix in muted
 *   words; the caller offers a Retry only where a try is harmless.
 *
 * `RetryActions` is the pair of buttons on their own, for a surface that draws its own line (the
 * chat's reconnect notice): the main action bordered, a quieter second one ghost. A press belongs
 * to one attempt: it disables both buttons — the pressed one spinning while the press's promise
 * is pending — until `attemptKey` changes, which is the caller saying a new attempt began; a
 * promise that rejects releases them, since the request did not go through. So a double click is
 * one attempt, and a new attempt is never left with dead buttons from the last one.
 *
 * Props only: every word is the caller's, and so is what a press does.
 */
import { useState } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { Button } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Spinner } from "../../icons/spinner/spinner";
import { useCountdown } from "./use-countdown";

export type RetryPhase = "trying" | "waiting" | "gaveUp" | "blocked";

export interface RetryAction {
  label: string;
  /**
   * The press. A returned promise keeps the button spinning until it settles; one that rejects
   * releases the press, so a refused request can be tried again.
   */
  onClick: () => unknown;
  /** Something else is in flight on this surface: the button takes no presses. */
  disabled?: boolean;
  /** This action's own request is in flight, as the caller knows it: the button spins. */
  busy?: boolean;
}

export interface RetryActionsProps {
  /** The main action: "Retry now" while waiting, "Retry" after giving up; null for none. */
  retry?: RetryAction | null;
  /** A quieter second action ("Give up"); null for none. */
  secondary?: RetryAction | null;
  /**
   * Changes when a new attempt begins (its ordinal, its scheduled time, the phase): a press holds
   * both buttons until it changes.
   */
  attemptKey: string | number;
  /** The button rung: `xs` in a line of text or a card, `sm` beside a dialog's other controls. */
  size?: "xs" | "sm";
}

type Which = "retry" | "secondary";

/** The press the buttons are holding for: which one, and whether its promise is still pending. */
interface Press {
  which: Which;
  pending: boolean;
  /** Tells this press's settling apart from a later press's. */
  token: number;
}

let pressTokens = 0;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === "function";

export function RetryActions({
  retry = null,
  secondary = null,
  attemptKey,
  size = "xs",
}: RetryActionsProps) {
  const [press, setPress] = useState<Press | null>(null);
  const [seenKey, setSeenKey] = useState(attemptKey);
  // A new attempt began: whatever was pressed belonged to the last one. Adjusted while
  // rendering, so the first paint of the new attempt already has live buttons.
  const current = seenKey === attemptKey ? press : null;
  if (seenKey !== attemptKey) {
    setSeenKey(attemptKey);
    setPress(null);
  }
  if (retry === null && secondary === null) return null;

  const pressOn = (which: Which, action: RetryAction) => {
    if (current !== null) return;
    const token = ++pressTokens;
    const outcome = action.onClick();
    if (!isThenable(outcome)) {
      setPress({ which, pending: false, token });
      return;
    }
    setPress({ which, pending: true, token });
    outcome.then(
      () => setPress((was) => (was?.token === token ? { ...was, pending: false } : was)),
      () => setPress((was) => (was?.token === token ? null : was)),
    );
  };
  const button = (which: Which, action: RetryAction) => (
    <Button
      key={which}
      size={size}
      variant={which === "retry" ? "secondary" : "ghost"}
      data-retry-action={which}
      disabled={action.disabled === true || current !== null}
      loading={action.busy === true || (current?.which === which && current.pending)}
      onClick={() => pressOn(which, action)}
    >
      {action.label}
    </Button>
  );
  return (
    <>
      {retry !== null && button("retry", retry)}
      {secondary !== null && button("secondary", secondary)}
    </>
  );
}

export interface RetryStatusProps extends Omit<RetryActionsProps, "attemptKey" | "size"> {
  phase: RetryPhase;
  /** One sentence for where things stand ("Reconnect 3 of 8 failed"). */
  label: string;
  /** What stands behind it — the last failure, the fix — in muted words; null for nothing. */
  reason?: string | null;
  /** `waiting`: when the next attempt runs, in epoch ms; the line counts down to it. */
  nextAt?: number | null;
  /** `waiting`: the countdown's words for n seconds left; without it no seconds are shown. */
  countdown?: (seconds: number) => string;
  /**
   * `line` (the default) sizes it for a card's narrow column: small type, the buttons wrapping
   * after the sentence. `block` sizes it for a dialog section: the sentence at body size, the
   * reason under it, the buttons under that at the dialog's control rung.
   */
  layout?: "line" | "block";
  className?: string;
}

/** The mark each phase draws: a glyph and the tone its ink takes. The spinner is `trying`'s. */
const MARK: Record<Exclude<RetryPhase, "trying">, { glyph: string; ink: string }> = {
  waiting: { glyph: ICONS.hourglass, ink: "text-tone-attention-fg" },
  gaveUp: { glyph: ICONS.pause, ink: "text-tone-attention-fg" },
  blocked: { glyph: ICONS.xCircle, ink: "text-tone-danger-fg" },
};

function PhaseMark({ phase, label }: { phase: RetryPhase; label: string }) {
  if (phase === "trying") {
    // The sentence beside it names what runs; the spinner adds no second announcement.
    return (
      <span aria-hidden="true" className="inline-flex h-[1lh] shrink-0 items-center">
        <Spinner size="xs" tone="success" label={label} />
      </span>
    );
  }
  const mark = MARK[phase];
  return (
    <span className="inline-flex h-[1lh] shrink-0 items-center">
      <GlyphIcon d={mark.glyph} size={ICON_SIZE.inlineGlyph} className={mark.ink} />
    </span>
  );
}

export function RetryStatus({
  phase,
  label,
  reason = null,
  nextAt = null,
  countdown,
  retry = null,
  secondary = null,
  layout = "line",
  className = "",
}: RetryStatusProps) {
  const seconds = useCountdown(phase === "waiting" ? nextAt : null);
  const counting = seconds !== null && seconds > 0 && countdown !== undefined;
  const block = layout === "block";
  const hasActions = retry !== null || secondary !== null;
  return (
    <div
      role="status"
      data-retry-phase={phase}
      className={`min-w-0 ${block ? "text-sm" : "text-xs"} ${className}`}
    >
      <p className={`flex items-start ${ICON_GAP.row}`}>
        <PhaseMark phase={phase} label={label} />
        <span className="min-w-0">
          <span className="font-medium">{label}</span>
          {counting && (
            // The phase's sentence is what is announced; the seconds change too often to be read.
            // One unit when the line wraps: "39 s" never stands apart from what it counts to.
            <span
              aria-live="off"
              data-retry-countdown=""
              className="whitespace-nowrap text-fg-muted tabular-nums"
            >
              {` · ${countdown(seconds)}`}
            </span>
          )}
        </span>
      </p>
      {reason !== null && (
        <p className={`${block ? "mt-1" : "mt-0.5"} break-words text-fg-muted`}>{reason}</p>
      )}
      {hasActions && (
        <div className={`${block ? "mt-2" : "mt-1.5"} flex flex-wrap items-center gap-2`}>
          <RetryActions
            retry={retry}
            secondary={secondary}
            attemptKey={`${phase}:${nextAt ?? ""}`}
            size={block ? "sm" : "xs"}
          />
        </div>
      )}
    </div>
  );
}
