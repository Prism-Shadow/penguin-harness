/**
 * The App Center's route. A workbench opened full page from the App Center carries it, with the
 * query of the view it left (`?app=…` for an app's window), as its `returnTo`, and the full
 * page's exit goes back there rather than to Chat.
 */
export const APP_CENTER_PATH = "/apps";

/** Whether a full page's `returnTo` is the App Center: its grid, or one of its windows. */
export function isAppCenterPath(path: unknown): path is string {
  return typeof path === "string" && /^\/apps(?:\?[^#]*)?$/.test(path);
}
