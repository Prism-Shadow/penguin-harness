/**
 * A dialog's close while its own save is in flight: nothing happens. Esc, the ×, a press on the
 * scrim and Cancel all stay put until the write answers, because a close then would offer to
 * discard edits that the request in flight is about to store — a "discard" the server would
 * contradict a moment later. Idle, it is the dialog's ordinary guarded close.
 *
 * It hands its two values to the shared guard, which keeps every dialog's close declared from
 * `useGuardedClose` (the static guard in test/form-commit-guard.test.ts reads exactly that):
 *
 *     const requestClose = useGuardedClose(...closeUnlessBusy(busy, onClose, form.scope));
 *
 * While busy, the guard is given a scope no form registers under, so it finds nothing to ask
 * about and runs the no-op.
 */

/** The no-op a close runs while a save is in flight. */
const stay = (): void => {};

/** A scope no form registers under. */
const IN_FLIGHT_SCOPE = "dialog-save-in-flight";

export function closeUnlessBusy(
  busy: boolean,
  onClose: () => void,
  scope: string,
): [onClose: () => void, scope: string] {
  return busy ? [stay, IN_FLIGHT_SCOPE] : [onClose, scope];
}
