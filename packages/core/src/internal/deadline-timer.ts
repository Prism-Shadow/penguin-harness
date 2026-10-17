/**
 * Largest delay `setTimeout` can represent (~24.8 days). A larger value overflows to
 * ~1 ms in Node, so a wait past this cap has to be re-armed until the deadline.
 */
export const MAX_SET_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Calls `onFire` once `ms` have elapsed, even when `ms` is past the `setTimeout` cap.
 * Returns a cancel function. Pass `{ unref: true }` when the timer must not keep the
 * process alive.
 */
export function armDeadline(
  ms: number,
  onFire: () => void,
  opts: { unref?: boolean } = {},
): () => void {
  const deadline = Date.now() + Math.max(0, ms);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cleared = false;
  const arm = (): void => {
    if (cleared) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      onFire();
      return;
    }
    timer = setTimeout(
      () => {
        if (cleared) return;
        if (Date.now() >= deadline) onFire();
        else arm();
      },
      Math.min(remaining, MAX_SET_TIMEOUT_MS),
    );
    if (opts.unref) timer.unref?.();
  };
  arm();
  return () => {
    cleared = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
