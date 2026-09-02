/**
 * Veto hooks for closing dock tabs. A panel whose body holds unsaved work (the Files
 * panel's text editor) registers a guard under its tab key; every path that would unmount
 * that body — the tab's own ×, the dock's hide ×, the toolbar's dock toggle — asks the
 * guards first and proceeds only when each one resolves true. A guard typically opens the
 * panel's own confirm dialog and resolves with the user's answer. A tab with no guard
 * closes at once.
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
