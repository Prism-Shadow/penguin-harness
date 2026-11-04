/**
 * Veto hooks for closing dock tabs. A panel whose body holds unsaved work (the Files
 * panel's text editor) registers a guard under its tab key; the tab's own × asks the
 * guards first and removes it only when each one resolves true. A guard typically opens
 * the panel's own confirm dialog and resolves with the user's answer. A tab with no guard
 * closes at once.
 *
 * That × is the only path here, because it is the only one that unmounts a body: hiding a
 * dock (its × or the toolbar's toggle) leaves every body mounted at zero size, so it takes
 * nothing away and asks nothing.
 */
export type CloseGuard = () => Promise<boolean>;

const guards = new Map<string, CloseGuard>();

/** Registers (or, with null, withdraws) the guard for one tab key. */
export function setCloseGuard(tabKey: string, guard: CloseGuard | null): void {
  if (guard === null) guards.delete(tabKey);
  else guards.set(tabKey, guard);
}

/**
 * Whether the tabs may close: asks each guarded tab in order and stops at the first veto,
 * so a user who keeps one panel open is not then asked about the next.
 */
export async function confirmClose(tabKeys: readonly string[]): Promise<boolean> {
  for (const key of tabKeys) {
    const guard = guards.get(key);
    if (guard !== undefined && !(await guard())) return false;
  }
  return true;
}
