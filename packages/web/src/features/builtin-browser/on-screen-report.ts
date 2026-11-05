/**
 * The tab this window shows, told to the server: the server leaves that tab at full speed and
 * lets the shell throttle the parked ones while they are out of sight. The layer calls this on
 * every frame it lays out, so the report waits for the choice to settle for a moment, and a tab
 * switch or a panel toggle costs one request. A request that fails is not repeated: the next
 * change says it again, and so does the layer after the server may have forgotten (a resync).
 */
import * as api from "../../api/endpoints";

/** How long the tab on screen has to stay put before the server hears of it. */
export const ON_SCREEN_SETTLE_MS = 250;

/** What this window last told the server; undefined until it has said anything. */
let reported: number | null | undefined;
let settling: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function stop(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

/** The tab on screen now, or null for none (no panel showing, a blank or crashed page, the window hidden). */
export function reportOnScreenTab(tabId: number | null): void {
  if (tabId === reported) {
    stop();
    return;
  }
  if (timer !== null && tabId === settling) return;
  stop();
  settling = tabId;
  timer = setTimeout(() => {
    timer = null;
    reported = tabId;
    void api.setBuiltinBrowserOnScreen(tabId).catch(() => undefined);
  }, ON_SCREEN_SETTLE_MS);
}

/** Forgets what was said, so the next frame says it again (the server restarted, or events were lost). */
export function forgetOnScreenReport(): void {
  stop();
  reported = undefined;
}
