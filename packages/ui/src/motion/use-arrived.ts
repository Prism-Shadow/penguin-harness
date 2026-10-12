/**
 * `useArrived(value)`: whether `value` has changed since the component mounted — the way a
 * component asks for `data-reveal` only on a change the reader watched happen (a run settling,
 * an entry moving to the other area, the list regrouped), never on a page load that mounts
 * hundreds of settled rows. Once it has changed it stays arrived, so a value that goes back to
 * where it started (a grouping switched back) still counts as a change.
 */
import { useState } from "react";

/** Whether `now` is a different value from the one the component mounted with. */
export function arrived<T>(first: T, now: T): boolean {
  return !Object.is(first, now);
}

export function useArrived<T>(value: T): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  const differs = arrived(first, value);
  if (differs && !changed) setChanged(true);
  return changed || differs;
}
