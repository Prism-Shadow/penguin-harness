/**
 * The keyboard of a group with one tab stop (a radio group's): which option holds the stop at
 * rest, and where an arrow key, Home or End moves it. Both axes move and the ends wrap, so a row
 * of chips and a column of cards walk alike, and a disabled option is passed over, since it
 * cannot take focus and a stop left on one would leave the group unreachable by Tab.
 */

/**
 * Where an arrow key moves the tab stop of a group of `count` controls, from `current`; null for
 * a key the group leaves alone. Both axes move, and the ends wrap, as in a radio group.
 */
export function rovingTarget(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The keys that walk forward: Home walks on from the first option when the first is disabled. */
const FORWARD = new Set(["ArrowDown", "ArrowRight", "Home"]);

/**
 * Where `key` moves the tab stop from `current` among options of which `enabled` says which can
 * take focus: {@link rovingTarget}'s walk, continued past disabled options in the key's direction
 * (End walks back from the last). Null for a key the group leaves alone, or when no option can
 * take focus.
 */
export function rovingStop(
  current: number,
  key: string,
  enabled: readonly boolean[],
): number | null {
  let next = rovingTarget(current, key, enabled.length);
  if (next === null || !enabled.includes(true)) return null;
  const step = FORWARD.has(key) ? "ArrowRight" : "ArrowLeft";
  while (!enabled[next]) next = rovingTarget(next, step, enabled.length)!;
  return next;
}

/**
 * The option that holds the tab stop at rest: the first of `preferred` (indices, -1 for none)
 * that can take focus, else the first option that can, else the first.
 */
export function restingStop(enabled: readonly boolean[], preferred: readonly number[]): number {
  const wanted = preferred.find((index) => index >= 0 && enabled[index] === true);
  if (wanted !== undefined) return wanted;
  const first = enabled.indexOf(true);
  return first >= 0 ? first : 0;
}
