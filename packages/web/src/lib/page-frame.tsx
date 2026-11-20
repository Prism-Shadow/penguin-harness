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
 * of it:
 * - `at` is where the host wants the page: read once, as the document's fragment (`src#<at>`), when
 *   the frame is made, and after that posted to the page whenever it changes to somewhere the page
 *   is not — never by reloading. Null asks nothing of the page.
 * - The page's own moves come back through `onLocation`, and its requests to go elsewhere in the
 *   app through `onNavigate`; messages from any other frame or origin are ignored.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { documentLangFor, useLocale } from "../state/locale";
import { useTheme } from "../state/theme";
import { stampFrameContext } from "./frame-context";
import { frameMessageOf, postLocation } from "./frame-messages";
import {
  forwardFrameKeys,
  PAGE_FRAME_SANDBOX,
  readDocumentTheme,
  themeWorkbenchFrame,
} from "./workbench-theme";

/** The document to load: `src`, with the location to start at as its fragment. */
function withFragment(src: string, at: string | null): string {
  if (at === null || at === "/") return src;
  const hash = src.indexOf("#");
  return `${hash === -1 ? src : src.slice(0, hash)}#${at}`;
}

export interface PageFrameProps {
  src: string;
  title: string;
  /** The current Project, written on the page's root; null when there is none. */
  projectId: string | null;
  /** Where the host wants the page, inside itself; null asks nothing. */
  at?: string | null;
  /** The page moved inside itself, to `at`. */
  onLocation?: (at: string) => void;
  /** The page asks to take the viewer to `to`, a path of this app. */
  onNavigate?: (to: string) => void;
}

export function PageFrame({
  src,
  title,
  projectId,
  at = null,
  onLocation,
  onNavigate,
}: PageFrameProps) {
  const { dark, appliedTheme, accent, textSize, fontLatin, fontCjk } = useTheme();
  const lang = documentLangFor(useLocale().locale);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // The document and its starting location are the frame's for its life: a later `at` is posted
  // to the page, never written into `src`, which would reload it.
  const [start, setStart] = useState(() => ({ src, at }));
  if (start.src !== src) setStart({ src, at });
  /** Where the page is, as far as the host knows: where it started, then what it reported. */
  const known = useRef(start.at ?? "/");

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
  // `known` is left as it is: a page that says where it is from its own script has said so
  // before its load event, and a page that reloads itself says so again.
  const onLoad = useCallback(() => {
    stamp();
    detachKeys.current();
    detachKeys.current = forwardFrameKeys(frameRef.current);
  }, [stamp]);

  const handlers = useRef({ onLocation, onNavigate });
  handlers.current = { onLocation, onNavigate };
  useEffect(() => {
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      const message = frameMessageOf(event, frameRef.current?.contentWindow, origin);
      if (message === null) return;
      if (message.type === "location") {
        known.current = message.at;
        handlers.current.onLocation?.(message.at);
      } else {
        handlers.current.onNavigate?.(message.to);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (at === null || at === known.current) return;
    known.current = at;
    postLocation(frameRef.current?.contentWindow, at, window.location.origin);
  }, [at]);

  return (
    <iframe
      ref={frameRef}
      onLoad={onLoad}
      title={title}
      src={withFragment(start.src, start.at)}
      className="h-full w-full border-0"
      sandbox={PAGE_FRAME_SANDBOX}
    />
  );
}
