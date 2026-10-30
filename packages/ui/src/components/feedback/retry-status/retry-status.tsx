/**
 * The one retry row every surface that retries shares — a machine being reconnected, a model
 * request being retried: where things stand in one sentence, the explanation behind a circled
 * "?" after it, and the presses on the same line.
 *
 * Six phases, each one mark and one sentence:
 *
 * - `trying` — an attempt is starting or running ("Reconnecting (attempt 4/5)"): the spinner;
 *   the only press is the quieter one, to stop retrying.
 * - `waiting` — the next attempt is scheduled: the hourglass in the attention tone and the
 *   sentence with the seconds in it ("Reconnecting in 23 s (attempt 4/5)"), ticking each second;
 *   once the moment has come, the plain sentence. Both presses: retry now, stop retrying.
 * - `retried` — a retry went out and the row now only records it (a model request's retry,
 *   whose answer streams in below): a turning arrow, receding.
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
 * number, so the sentence does not shift when an attempt settles or as the seconds tick.
 *
 * The last failure, or the fix, either waits behind the "?" (`InfoPopover`, opening on hover,
 * under a short title of its own when the caller gives one, "Last failure", so a failure that
 * holds a colon of its own never reads as two labels in a row), or — `reasonPlacement="inline"`,
 * a conversation's retry — follows the sentence on the row in the muted ink, clamped to two lines
 * with an Expand (`ClampedText`). The presses are text actions (`TextAction`) at the sentence's
 * size, never boxed: on a wide surface the whole row is one line; in a narrow column they wrap
 * under the sentence, together.
 *
 * Two frames. `none` is the row alone, for a card's middle, a dialog's section or a centred
 * notice. `note` is for a row that stands between a conversation's messages: it wears the
 * transcript's one-line note (`TranscriptNote`'s box and head, an activity row of the `event`
 * kind), so each theme draws it the way it draws the transcript's other notes — Primer a grey
 * strip at its content's width, Frost a line of words, Console a transcript line — with the
 * sentence as the note's label. The phase's mark stays in every theme there: it is the row's one
 * carrier of colour, so it sits outside the activity hook's mark slot, which a theme may hide. And
 * the row does not answer a hover as a note that is a button does (the themes skip
 * `[data-retry-phase]`): its presses are the only things to press.
 *
 * A press belongs to one attempt (`RetryActions`): it disables both — the pressed one spinning
 * while the press's promise is pending — until `attemptKey` changes, which is the caller saying
 * a new attempt began; a promise that rejects releases them, since the request did not go
 * through. So a double click is one attempt, and a new attempt is never left with dead presses
 * from the last one.
 *
 * Props only: every word is the caller's, and so is what a press does.
 */
import { useState } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { TextAction } from "../../actions/text-action/text-action";
import { TranscriptNoteFrame } from "../../chat/transcript-note/transcript-note";
import { ClampedText } from "../../content/clamped-text/clamped-text";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Spinner } from "../../icons/spinner/spinner";
import { InfoPopover } from "../../overlays/info-popover/info-popover";
import { countdownParts } from "./countdown";
import { useCountdown, useWidestDigits } from "./use-countdown";

export type RetryPhase = "trying" | "waiting" | "retried" | "gaveUp" | "cancelled" | "blocked";

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
  /** The type rung: `xs` in a card's line or a transcript, `sm` at a dialog's body size. */
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
  /** The explanation of where things stand — the last failure, the fix; null for none. */
  reason?: string | null;
  /** What the explanation is, as the "?" panel's first line ("Last failure"); null for none. */
  reasonTitle?: string | null;
  /**
   * Where the explanation sits. `popover`: behind the "?" after the sentence, under its title.
   * `inline`: on the row itself, after the sentence in the muted ink, clamped to two lines with an
   * Expand when it runs longer (a conversation's retry, where the provider's words are read
   * without a hover); the caller then passes it as one text and no title.
   */
  reasonPlacement?: "popover" | "inline";
  /**
   * `none`: the row alone (a card, a dialog, a centred notice). `note`: the transcript's one-line
   * note, for a row between a conversation's messages; it takes the note's rung, whatever `size`.
   *
   * In a note the sentence is the note's label, and a theme may recase a label (Console sets it
   * in capitals: "RETRYING IN 39 S"). So the sentence there must be a fixed phrase with numbers at
   * most — never a name, a path or a provider's words, which belong in the reason.
   */
  frame?: RetryFrame;
  /** The root is the row itself, so `justify-center` centres it under a centred headline. */
  className?: string;
}

export type RetryFrame = "none" | "note";

/** The phases with an attempt live: the sentence speaks in the body ink, as running work does. */
const LIVE: ReadonlySet<RetryPhase> = new Set<RetryPhase>(["trying", "waiting"]);

/** The mark each phase draws: a glyph and the ink it takes. The spinner is `trying`'s. */
const MARK: Record<Exclude<RetryPhase, "trying">, { glyph: string; ink: string }> = {
  waiting: { glyph: ICONS.hourglass, ink: "text-tone-attention-fg" },
  // A record of what was done, not a state to act on: it recedes.
  retried: { glyph: ICONS.rotateCw, ink: "text-fg-muted" },
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

/**
 * The seconds in the countdown sentence, in a slot as wide as the wait's widest number: that many
 * zeros, drawn invisibly in the same cell (a pseudo-element, so they are not text), hold the
 * width, and the digits sit at its end — so 10 ticking down to 9 moves nothing after them.
 */
function Seconds({ value, digits }: { value: number; digits: number }) {
  return (
    <span
      data-digits={"0".repeat(digits)}
      className="inline-grid justify-items-end before:invisible before:col-start-1 before:row-start-1 before:content-[attr(data-digits)]"
    >
      <span className="col-start-1 row-start-1">{value}</span>
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
  reasonTitle = null,
  reasonPlacement = "popover",
  retry = null,
  secondary = null,
  size = "xs",
  frame = "none",
  className = "",
}: RetryStatusProps) {
  const target = phase === "waiting" ? nextAt : null;
  const seconds = useCountdown(target);
  const counting = seconds !== null && seconds > 0 && countdown !== undefined;
  const digits = useWidestDigits(target, counting ? seconds : null);
  const around = counting ? countdownParts(countdown) : null;
  const sentence = !counting ? (
    label
  ) : around === null ? (
    countdown(seconds)
  ) : (
    <>
      {around.before}
      <Seconds value={seconds} digits={digits} />
      {around.after}
    </>
  );
  const hasActions = retry !== null || secondary !== null;
  const note = frame === "note";
  const live = LIVE.has(phase);
  // In a note the sentence is its label, which a theme sets as it sets the transcript's; the
  // reason is a detail, which no theme recases, since it carries a provider's own words.
  const said = note ? <span data-slot="label">{sentence}</span> : sentence;
  const inline = reason !== null && reasonPlacement === "inline";
  // The sentence and its "?" (or its reason) stay together: the sentence wraps inside its own
  // box, never away from them. While the seconds tick, the sentence changes too often to be read
  // out; the phase's own changes still are.
  const words = (
    <span
      aria-live={counting ? "off" : undefined}
      data-retry-countdown={counting ? "" : undefined}
      className={`flex min-w-0 items-start ${ICON_GAP.row} tabular-nums ${live ? "text-fg" : "text-fg-muted"}${inline ? " flex-wrap" : ""}`}
    >
      {inline ? (
        <ClampedText lines={2}>
          {said}
          <span data-slot="detail" className="text-fg-muted">
            {` · ${reason}`}
          </span>
        </ClampedText>
      ) : (
        said
      )}
      {reason !== null && !inline && (
        <InfoPopover label={label} className="h-[1lh]">
          {reasonTitle !== null && <span className="block font-medium text-fg">{reasonTitle}</span>}
          {reason}
        </InfoPopover>
      )}
    </span>
  );
  // The two keep one line where it has room; a column narrower than both wraps them rather than
  // letting a label overflow it.
  const presses = hasActions && (
    <span className="flex min-w-0 flex-wrap items-start gap-x-3">
      <RetryActions
        retry={retry}
        secondary={secondary}
        attemptKey={`${phase}:${nextAt ?? ""}:${label}`}
      />
    </span>
  );
  // Beside the mark, so presses that wrap line up under the sentence, not under the mark.
  const body = (
    <span className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
      {words}
      {presses}
    </span>
  );
  if (note) {
    // The note's head is an activity row: running while an attempt is live, settled otherwise —
    // never the error state, whose recipe sets the words in the danger ink. The head itself does
    // not wrap: the body does, beside the mark.
    return (
      <TranscriptNoteFrame
        state={live ? "running" : "done"}
        wrap={false}
        className={className}
        attributes={{ role: "status", "data-retry-phase": phase }}
      >
        <PhaseMark phase={phase} label={label} />
        {body}
      </TranscriptNoteFrame>
    );
  }
  return (
    <div
      role="status"
      data-retry-phase={phase}
      className={`flex min-w-0 items-start ${ICON_GAP.row} ${TEXT[size]} ${className}`}
    >
      <PhaseMark phase={phase} label={label} />
      {body}
    </div>
  );
}
