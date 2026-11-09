/**
 * A page drawn by a server-contributed document: the `iframe` renderer of a page in
 * `WebModule.pages` (web-app/contributions.tsx). The page fills WebApp's content area and is
 * framed the way a workflow's tab is (lib/workbench-theme.ts): same sandbox, the app's
 * appearance copied in on load and on every change, and its keys forwarded so the app's
 * shortcuts still answer once the reader has clicked into it.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  forwardFrameKeys,
  PAGE_FRAME_SANDBOX,
  readDocumentTheme,
  themeWorkbenchFrame,
} from "../lib/workbench-theme";
import { useTheme } from "../state/theme";

export function FramePage({ src, title }: { src: string; title: string }) {
  const { dark, themeId, accent, textSize, fontLatin, fontCjk } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const applyTheme = useCallback(() => {
    themeWorkbenchFrame(frameRef.current, readDocumentTheme(document));
  }, []);
  // Past the commit: the provider that stamps the appearance on the app's document is an
  // ancestor, and its effect runs after this one's.
  useEffect(() => {
    const id = requestAnimationFrame(applyTheme);
    return () => cancelAnimationFrame(id);
  }, [applyTheme, dark, themeId, accent, textSize, fontLatin, fontCjk]);
  const detachKeys = useRef<() => void>(() => undefined);
  useEffect(() => () => detachKeys.current(), []);
  const onLoad = useCallback(() => {
    applyTheme();
    detachKeys.current();
    detachKeys.current = forwardFrameKeys(frameRef.current);
  }, [applyTheme]);
  return (
    <iframe
      ref={frameRef}
      onLoad={onLoad}
      title={title}
      src={src}
      className="h-full w-full border-0 bg-white dark:bg-gray-950"
      sandbox={PAGE_FRAME_SANDBOX}
    />
  );
}
