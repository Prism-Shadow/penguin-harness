/**
 * A countdown sentence that holds still while it counts: the caller's sentence for the seconds
 * left, with the seconds in a slot as wide as the wait's widest number — so 10 s ticking down to
 * 9 s moves nothing after them, neither the words that follow nor the presses after the line.
 * The machine's retry row and the conversation's retry line both say their wait through it.
 *
 * The slot is found in the sentence wherever its language puts the seconds (`countdownParts`);
 * a sentence that does not show them is drawn as it is. Ticking every second, the words would be
 * read out every second, so the sentence is not a live region of its own: the line that holds it
 * announces its phase changes, never the seconds.
 */
import { countdownParts } from "./countdown";
import { useWidestDigits } from "./use-countdown";

export interface CountdownTextProps {
  /** The sentence for a number of seconds left. */
  sentence: (seconds: number) => string;
  /** The seconds left now (from `useCountdown`). */
  seconds: number;
  /** Which wait this is (its target time): a new wait reserves its own width. */
  wait: number;
}

export function CountdownText({ sentence, seconds, wait }: CountdownTextProps) {
  const digits = useWidestDigits(wait, seconds);
  const around = countdownParts(sentence);
  return (
    <span aria-live="off" data-retry-countdown="" className="tabular-nums">
      {around === null ? (
        sentence(seconds)
      ) : (
        <>
          {around.before}
          <Seconds value={seconds} digits={digits} />
          {around.after}
        </>
      )}
    </span>
  );
}

/**
 * The seconds in a slot as wide as `digits` zeros: they are drawn invisibly in the same cell (a
 * pseudo-element, so they are not text) and hold the width, and the digits sit at its end.
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
