/**
 * Whether a press on a link is one the browser takes somewhere else — a new tab or window, a
 * download, the middle button — rather than one the app follows in place. A card whose opener is
 * a real link (a plugin's page in the market) routes a plain press itself and leaves every other
 * press to the browser, as a link does.
 */
export function pressOpensElsewhere(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}
