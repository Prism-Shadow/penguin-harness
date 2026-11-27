/**
 * The frame of a server-contributed page: the iframe a contributed page (web-app/frame-page.tsx),
 * a system app's window and its full page draw the page's document in. It is framed the way a
 * workflow's page is (lib/workbench-theme.ts): the same sandbox, the app's appearance copied in on
 * load and on every change, and its keys forwarded so the app's shortcuts still answer once the
 * reader has clicked into it. Its root also carries the interface language and the current
 * Project (lib/frame-context.ts), kept current. It paints no background of its own, so the
 * theme's surface shows through a page that paints none either.
 *
 * Where the page keeps a location of its own (lib/frame-messages.ts), the frame is the host's end
 * of it (lib/frame-location.ts): `at` is where the host wants the page, `onLocation` hears its own
 * moves and `onNavigate` its requests to go elsewhere in the app.
 */
import { useCallback, useEffect, useRef } from "react";
import { documentLangFor, useLocale } from "../state/locale";
import { useTheme } from "../state/theme";
import { stampFrameContext } from "./frame-context";
import { useFrameLocation, type FrameLocation } from "./frame-location";
import {
  forwardFrameKeys,
  PAGE_FRAME_SANDBOX,
  readDocumentTheme,
  themeWorkbenchFrame,
} from "./workbench-theme";

export interface PageFrameProps extends FrameLocation {
  src: string;
  title: string;
  /** The current Project, written on the page's root; null when there is none. */
  projectId: string | null;
}

export function PageFrame({ src, title, projectId, ...location }: PageFrameProps) {
  const { dark, appliedTheme, accent, textSize, fontLatin, fontCjk } = useTheme();
  const lang = documentLangFor(useLocale().locale);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const loaded = useFrameLocation(frameRef, src, location);

  const context = useRef({ lang, projectId });
  context.current = { lang, projectId };
  const stamp = useCallback(() => {
    themeWorkbenchFrame(frameRef.current, readDocumentTheme(document));
    stampFrameContext(frameRef.current, context.current);
  }, []);
  // Past the commit: the provider that stamps the appearance on the app's document is an
  // ancestor, and its effect runs after this one's.
  useEffect(() => {
    const id = requestAnimationFrame(stamp);
    return () => cancelAnimationFrame(id);
  }, [stamp, dark, appliedTheme, accent, textSize, fontLatin, fontCjk, lang, projectId]);

  const detachKeys = useRef<() => void>(() => undefined);
  useEffect(() => () => detachKeys.current(), []);
  const onLoad = useCallback(() => {
    stamp();
    detachKeys.current();
    detachKeys.current = forwardFrameKeys(frameRef.current);
  }, [stamp]);

  return (
    <iframe
      ref={frameRef}
      onLoad={onLoad}
      title={title}
      src={loaded}
      className="h-full w-full border-0"
      sandbox={PAGE_FRAME_SANDBOX}
    />
  );
}
