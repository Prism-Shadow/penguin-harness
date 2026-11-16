/**
 * The retry row a machine shows while the server brings it back — the card's middle, the Machine
 * dialog's Reconnecting section, a conversation on that machine: where things stand in one
 * sentence, the reason after it in sight, and the presses on the same line.
 *
 * Five phases, each one mark and one sentence:
 *
 * - `trying` — an attempt is starting or running ("Reconnecting (attempt 4/5)"): the spinner;
 *   the only press is the quieter one, to stop retrying.
 * - `waiting` — the next attempt is scheduled: the hourglass in the attention tone and the
 *   sentence with the seconds in it ("Reconnecting in 23 s (attempt 4/5)"), ticking each second;
 *   once the moment has come, the plain sentence. Both presses: retry now, stop retrying.
 * - `gaveUp` — the attempts reached their limit and failed: the cross in the danger tone, and
 *   the main press to start again.
 * - `cancelled` — a person stopped retrying: the pause mark in the attention tone (it waits on
 *   them now); the main press to start again.
 * - `blocked` — retrying cannot help until someone acts (a refused key, a broken config, a
 *   refused password): the cross in the danger tone; the caller offers a Retry only where a try
 *   is harmless.
 *
 * Only the mark carries colour. The sentence is set at the body weight: in the body ink while an
 * attempt is live (trying, waiting), receding to the muted ink once the row has settled — the
 * rule every activity row follows — and never in the danger ink, since a failure in red words
 * reads as an alarm; the cross beside it already says it. The mark sits in a box of one width
 * whatever the phase draws, and the countdown's seconds keep the width of the wait's widest
 * number (`CountdownText`), so the sentence does not shift when an attempt settles or as the
 * seconds tick.
 *
 * The reason — the last failure, or the fix — follows the sentence on the row in the muted ink,
 * after a middle dot, clamped to two lines with an Expand when it runs longer (`ClampedText`):
 * in sight, never behind a "?". The presses are text actions (`TextAction`) at the sentence's
 * size, never boxed: on a wide surface the whole row is one line; in a narrow column they wrap
 * under the sentence, together.
 *
 * A press belongs to one attempt (`RetryActions`): it disables both — the pressed one spinning
 * while the press's promise is pending — until `attemptKey` changes, which is the caller saying
 * a new attempt began; a promise that rejects releases them, since the request did not go
 * through. So a double click is one attempt, and a new attempt is never left with dead presses
 * from the last one. A conversation's retry line takes its presses from here too.
 *
 * Props only: every word is the caller's, and so is what a press does.
 */
import { useState } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { TextAction } from "../../actions/text-action/text-action";
import { ClampedText } from "../../content/clamped-text/clamped-text";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Spinner } from "../../icons/spinner/spinner";
import { CountdownText } from "./countdown-text";
import { useCountdown } from "./use-countdown";

export type RetryPhase = "trying" | "waiting" | "gaveUp" | "cancelled" | "blocked";

export interface RetryAction {
  label: string;
  /**
   * The press. A returned promise keeps it spinning until it settles; one that rejects releases
   * the press, so a refused request can be tried again.
   */
  onClick: () => unknown;
  /** Something else is in flight on this surface: the press is not taken. */
  disabled?: boolean;
  /** This action's own request is in flight, as the caller knows it: it spins. */
  busy?: boolean;
}

export interface RetryActionsProps {
  /** The main action: "Retry now" while waiting, "Retry" after a stop; null for none. */
  retry?: RetryAction | null;
  /** The quieter second action ("Stop retrying", "Give up"); null for none. */
  secondary?: RetryAction | null;
  /**
   * Changes when a new attempt begins (its ordinal, its scheduled time, the phase): a press holds
   * both until it changes.
   */
  attemptKey: string | number;
}

type Which = "retry" | "secondary";

/** The press the actions are holding for: which one, and whether its promise is still pending. */
interface Press {
  which: Which;
  pending: boolean;
  /** Tells this press's settling apart from a later press's. */
  token: number;
}

let pressTokens = 0;

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === "function";

export function RetryActions({ retry = null, secondary = null, attemptKey }: RetryActionsProps) {
  const [press, setPress] = useState<Press | null>(null);
  const [seenKey, setSeenKey] = useState(attemptKey);
  // A new attempt began: whatever was pressed belonged to the last one. Adjusted while
  // rendering, so the first paint of the new attempt already has live presses.
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
    <TextAction
      key={which}
      data-retry-action={which}
      disabled={action.disabled === true || current !== null}
      busy={action.busy === true || (current?.which === which && current.pending)}
      onClick={() => pressOn(which, action)}
    >
      {action.label}
    </TextAction>
  );
  return (
    <>
      {retry !== null && button("retry", retry)}
      {secondary !== null && button("secondary", secondary)}
    </>
  );
}

export interface RetryStatusProps extends Omit<RetryActionsProps, "attemptKey"> {
  phase: RetryPhase;
  /** The type rung: `xs` in a card's line, `sm` at a dialog's body size. */
  size?: "xs" | "sm";
  /**
   * Where things stand, in one sentence ("Reconnecting (attempt 4/5)"). While waiting, what the
   * row says once the moment has come and the attempt is due.
   */
  label: string;
  /** `waiting`: the sentence for n seconds left, the seconds in it; without it no seconds show. */
  countdown?: (seconds: number) => string;
  /** `waiting`: when the next attempt runs, in epoch ms; the row counts down to it. */
  nextAt?: number | null;
  /** The explanation of where things stand — the last failure, the fix — after the sentence; null for none. */
  reason?: string | null;
  /** The root is the row itself, so `justify-center` centres it under a centred headline. */
  className?: string;
}

/** The phases with an attempt live: the sentence speaks in the body ink, as running work does. */
const LIVE: ReadonlySet<RetryPhase> = new Set<RetryPhase>(["trying", "waiting"]);

/** The mark each phase draws: a glyph and the ink it takes. The spinner is `trying`'s. */
const MARK: Record<Exclude<RetryPhase, "trying">, { glyph: string; ink: string }> = {
  waiting: { glyph: ICONS.hourglass, ink: "text-tone-attention-fg" },
  gaveUp: { glyph: ICONS.xCircle, ink: "text-tone-danger-fg" },
  // A person's own stop: nothing runs until they retry, which is the attention tone's meaning.
  cancelled: { glyph: ICONS.pause, ink: "text-tone-attention-fg" },
  blocked: { glyph: ICONS.xCircle, ink: "text-tone-danger-fg" },
};

/**
 * The mark's box: one line high, as wide as the glyphs whatever the phase draws in it, its mark
 * centred — so the 12 px spinner and the 13 px glyphs that follow it leave the sentence where it
 * was. On the first line when the sentence wraps.
 */
const MARK_BOX = "inline-flex h-[1lh] shrink-0 items-center justify-center self-start";
const MARK_WIDTH = { width: ICON_SIZE.inlineGlyph } as const;

function PhaseMark({ phase, label }: { phase: RetryPhase; label: string }) {
  if (phase === "trying") {
    // The sentence beside it names what runs; the spinner adds no second announcement.
    return (
      <span aria-hidden="true" className={MARK_BOX} style={MARK_WIDTH}>
        <Spinner size="sm" tone="success" label={label} />
      </span>
    );
  }
  const mark = MARK[phase];
  return (
    <span className={MARK_BOX} style={MARK_WIDTH}>
      <GlyphIcon d={mark.glyph} size={ICON_SIZE.inlineGlyph} className={mark.ink} />
    </span>
  );
}

const TEXT: Record<"xs" | "sm", string> = { xs: "text-xs", sm: "text-sm" };

export function RetryStatus({
  phase,
  label,
  countdown,
  nextAt = null,
  reason = null,
  retry = null,
  secondary = null,
  size = "xs",
  className = "",
}: RetryStatusProps) {
  const target = phase === "waiting" ? nextAt : null;
  const seconds = useCountdown(target);
  const counting = target !== null && seconds !== null && seconds > 0 && countdown !== undefined;
  const sentence = counting ? (
    <CountdownText sentence={countdown} seconds={seconds} wait={target} />
  ) : (
    label
  );
  // The sentence and its reason are one run of text that wraps inside its own box, never away
  // from each other; the reason is a detail, in the muted ink whatever the phase.
  const words = (
    <span
      className={`flex min-w-0 flex-wrap items-start ${ICON_GAP.row} ${LIVE.has(phase) ? "text-fg" : "text-fg-muted"}`}
    >
      {reason === null ? (
        sentence
      ) : (
        <ClampedText lines={2}>
          {sentence}
          <span data-slot="detail" className="text-fg-muted">
            {` · ${reason}`}
          </span>
        </ClampedText>
      )}
    </span>
  );
  const hasActions = retry !== null || secondary !== null;
  return (
    <div
      role="status"
      data-retry-phase={phase}
      className={`flex min-w-0 items-start ${ICON_GAP.row} ${TEXT[size]} ${className}`}
    >
      <PhaseMark phase={phase} label={label} />
      {/* Beside the mark, so presses that wrap line up under the sentence, not under the mark. */}
      <span className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
        {words}
        {hasActions && (
          // The two keep one line where it has room; a column narrower than both wraps them
          // rather than letting a label overflow it.
          <span className="flex min-w-0 flex-wrap items-start gap-x-3">
            <RetryActions
              retry={retry}
              secondary={secondary}
              attemptKey={`${phase}:${nextAt ?? ""}:${label}`}
            />
          </span>
        )}
      </span>
    </div>
  );
}
