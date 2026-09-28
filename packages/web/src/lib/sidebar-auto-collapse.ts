/**
 * An open activity is a workspace: the app sidebar steps back to its rail so the studio
 * has the width. The user's stored preference is never written by this; an expand inside
 * the workspace lasts until they leave it.
 */
const FOCUS = /^\/activities\/(?!media\/?$)[^/]+\/?$/;

export function wantsFocus(pathname: string): boolean {
  return FOCUS.test(pathname);
}

/** `override` is what the user chose inside the workspace this visit, or null. */
export function effectiveCollapsed(
  stored: boolean,
  focus: boolean,
  override: boolean | null,
): boolean {
  if (!focus) return stored;
  return override ?? true;
}
