/**
 * An instant control's write — a switch, a standalone select — the way every settings surface
 * does it: the control shows the new value at once, the write carries that one value, and a
 * refused write puts the stored value back and says why in a toast. A silent snap-back would
 * leave the user wondering whether the click registered.
 *
 * `stored` is the caller's: the value the server last confirmed. `write` sends one value and
 * moves `stored` to the server's answer (adopting the response is the caller's business, since
 * the answer usually carries more than this one value). While the write is in flight the control
 * shows the value it was flipped to; once it settles it shows `stored` again — the new value on
 * success, the old one on failure.
 *
 * An instant control is never part of a form's draft and never makes the form dirty: on a page
 * that mixes switches with a typed form, the switch writes its own value alone and the typed
 * draft beside it stays as it was.
 */
import { useState } from "react";
import { toastError } from "@prismshadow/penguin-ui";
import { apiErrorText } from "./api-error";

export interface InstantSetting<T> {
  /** What the control shows: the value being written, else the stored one. */
  value: T;
  /** A write is in flight; a second flip waits for it. */
  busy: boolean;
  /** Writes `next`. Resolves with whether it was stored. Ignored while a write is in flight. */
  set: (next: T) => Promise<boolean>;
}

export function useInstantSetting<T>(
  stored: T,
  write: (next: T) => Promise<unknown>,
): InstantSetting<T> {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const set = async (next: T): Promise<boolean> => {
    if (pending !== null) return false;
    setPending({ value: next });
    try {
      await write(next);
      return true;
    } catch (e) {
      toastError(apiErrorText(e));
      return false;
    } finally {
      setPending(null);
    }
  };
  return { value: pending === null ? stored : pending.value, busy: pending !== null, set };
}
