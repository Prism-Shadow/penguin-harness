/**
 * One workbench page in an iframe served from the workbench's own `ui/` folder: what an App
 * Center window holds (features/app-center/app-center-window.tsx) and what the full page shows
 * (workbench-app-page.tsx). The frame is the page alone; the window's title bar and the full
 * page's exit carry the actions around it, and the Agent's settings row keeps reload, history and
 * removal.
 *
 * The page is a separate document, so the app's theme, accent, fonts and text size are copied
 * into it (lib/workbench-theme.ts) on load and on every change, and it stays invisible until they
 * are on it: no white flash in a dark app. Its keys reach the app too, so the palette still
 * answers from inside it. A page may ask to fill the app (`parent.postMessage({ type:
 * "penguin:fill-app" }, "*")`, only from this frame): the host that can do that passes
 * `onFillApp`. The iframe keys on the page's `uiRev`, so an Agent editing its pages sees them
 * reload.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  forwardFrameKeys,
  PAGE_FRAME_SANDBOX,
  readDocumentTheme,
  themeWorkbenchFrame,
} from "../../lib/workbench-theme";
import { FILL_APP_MESSAGE, workbenchUiUrl, type WorkbenchTab } from "../../lib/workbench-tabs";
import { useTheme } from "../../state/theme";

/** How long a page that never finishes loading stays hidden before it is shown as it is. */
const FRAME_REVEAL_TIMEOUT_MS = 4000;

export function WorkbenchFrame({
  tab,
  onFillApp,
}: {
  tab: WorkbenchTab;
  /** The page asked to fill the app; absent where it already does (the full page). */
  onFillApp?: () => void;
}) {
  const { dark, appliedTheme, accent, textSize, fontLatin, fontCjk } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  // The app's dark class, theme, accent, fonts and root font size stop at the frame, so they are
  // copied in on load and on every appearance change. Past the commit, because the provider that
  // stamps them on the app's own document is an ancestor and its effect runs after this one's.
  const applyTheme = useCallback(() => {
    themeWorkbenchFrame(frameRef.current, readDocumentTheme(document));
  }, []);
  useEffect(() => {
    const id = requestAnimationFrame(applyTheme);
    return () => cancelAnimationFrame(id);
  }, [applyTheme, dark, appliedTheme, accent, textSize, fontLatin, fontCjk, tab.uiRev]);

  // Until it has loaded and been themed the page paints the browser's white canvas, then its own
  // unstyled markup: it stays invisible over the app's background until the theme is on it, and
  // fades in. The timer is for a page that never fires `load` (a hung subresource): it is shown
  // anyway rather than hidden forever.
  const frameKey = `${tab.tabId}@${tab.uiRev}`;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const detachKeys = useRef<() => void>(() => undefined);
  useEffect(() => () => detachKeys.current(), []);
  const onFrameLoad = useCallback(() => {
    applyTheme();
    // The page's keys reach the app too, so the palette still answers after focus moves into it.
    detachKeys.current();
    detachKeys.current = forwardFrameKeys(frameRef.current);
    setShownKey(frameKey);
  }, [applyTheme, frameKey]);
  useEffect(() => {
    const id = setTimeout(() => setShownKey(frameKey), FRAME_REVEAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [frameKey]);

  useEffect(() => {
    if (onFillApp === undefined) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      if ((e.data as { type?: unknown } | null)?.type === FILL_APP_MESSAGE) onFillApp();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onFillApp]);

  return (
    // No fill of its own: the page sits on the surface its host shows through (the window's
    // canvas, a wallpaper).
    <div className="flex h-full min-h-0 flex-col">
      <iframe
        key={frameKey}
        ref={frameRef}
        onLoad={onFrameLoad}
        title={tab.title}
        src={workbenchUiUrl(tab)}
        className={`min-h-0 flex-1 border-0 transition-opacity duration-150 motion-reduce:transition-none ${
          shownKey === frameKey ? "opacity-100" : "opacity-0"
        }`}
        sandbox={PAGE_FRAME_SANDBOX}
      />
    </div>
  );
}
