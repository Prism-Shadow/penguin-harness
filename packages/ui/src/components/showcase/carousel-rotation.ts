/**
 * The selected carousel's turn-taking, as pure decisions (unit tested): which slide leads, and
 * whether the carousel moves on by itself.
 *
 * - The lead rotates by the calendar, not by chance: of the slides allowed to lead, one a day in
 *   order, so every reader sees the same header post on the same day and a reload never changes
 *   it. A list with no lead slides starts at its first.
 * - It moves on by itself only while the reader lets it: more than one slide, the play switch
 *   on, the pointer away, the page in view. Reduced motion starts the switch off.
 */

/** Whole days since the Unix epoch, in UTC: the calendar the lead rotates on. */
export function dayNumber(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/**
 * The index of the slide that leads on `day`: `leads` are the slides allowed to (indexes into
 * the slide list, in turn order), taken one a day. An index outside the list is skipped; with
 * none left, the first slide leads.
 */
export function leadIndex(count: number, leads: readonly number[], day: number): number {
  const valid = leads.filter((i) => Number.isInteger(i) && i >= 0 && i < count);
  if (valid.length === 0) return 0;
  return valid[((day % valid.length) + valid.length) % valid.length]!;
}

/** What stops the carousel from moving on by itself. */
export interface RotationState {
  count: number;
  /** The reader's play switch. */
  playing: boolean;
  /** The pointer is over the carousel. */
  hovered: boolean;
  /** The page is in a background tab. */
  hidden: boolean;
}

/** Whether the carousel advances by itself right now. */
export function rotates({ count, playing, hovered, hidden }: RotationState): boolean {
  return count > 1 && playing && !hovered && !hidden;
}

/** The slide after `index`, wrapping; `step` -1 goes back. */
export function stepIndex(index: number, count: number, step: 1 | -1): number {
  if (count <= 0) return 0;
  return (((index + step) % count) + count) % count;
}
