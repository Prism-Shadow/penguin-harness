/**
 * The frame's end of a framed page's own location (lib/frame-messages.ts), for every iframe the
 * Web App draws a page in: a contributed page's (lib/page-frame.tsx) and an Agent workbench
 * page's (features/workbenches/workbench-frame.tsx). What the host wants of the page comes from
 * the address of the view that shows it (lib/frame-address.ts).
 *
 * - `at` is where the host wants the page: read once, as the document's fragment (`src#<at>`),
 *   when the frame is given its document, and after that posted to the page whenever it changes
 *   to somewhere the page is not — never by reloading. Null asks nothing of the page.
 * - Where the page is, as far as the host knows, is where it started, then what it last said:
 *   its own moves are never sent back to it.
 * - The page's own moves come back through `onLocation`, and its requests to go elsewhere in the
 *   app through `onNavigate`; messages from any other frame or origin are ignored, so a page that
 *   posts neither message sees nothing change.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { frameMessageOf, postLocation } from "./frame-messages";

export interface FrameLocation {
  /** Where the host wants the page, inside itself; null asks nothing. */
  at?: string | null;
  /** The page moved inside itself, to `at`. */
  onLocation?: (at: string) => void;
  /** The page asks to take the viewer to `to`, a path of this app. */
  onNavigate?: (to: string) => void;
}

/** The document to load: `src`, with the location to start at as its fragment. */
export function withFragment(src: string, at: string | null): string {
  if (at === null || at === "/") return src;
  const hash = src.indexOf("#");
  return `${hash === -1 ? src : src.slice(0, hash)}#${at}`;
}

/**
 * Keeps the page in `frame` and the host in step, and returns the document the frame loads:
 * `src`, starting where the host wants the page. A new `src` is a new document, which starts
 * where the host wants it then.
 */
export function useFrameLocation(
  frame: RefObject<HTMLIFrameElement | null>,
  src: string,
  { at = null, onLocation, onNavigate }: FrameLocation = {},
): string {
  // The document and its starting location are the frame's for its life: a later `at` is posted
  // to the page, never written into `src`, which would reload it.
  const [start, setStart] = useState(() => ({ src, at }));
  /** Where the page is, as far as the host knows: where it started, then what it reported. */
  const known = useRef(start.at ?? "/");
  if (start.src !== src) {
    setStart({ src, at });
    known.current = at ?? "/";
  }

  const handlers = useRef({ onLocation, onNavigate });
  handlers.current = { onLocation, onNavigate };
  // `known` is not reset on load: a page that says where it is from its own script has said so
  // before its load event, and a page that reloads itself says so again.
  useEffect(() => {
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      const message = frameMessageOf(event, frame.current?.contentWindow, origin);
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
  }, [frame]);

  useEffect(() => {
    if (at === null || at === known.current) return;
    known.current = at;
    postLocation(frame.current?.contentWindow, at, window.location.origin);
  }, [frame, at]);

  return withFragment(start.src, start.at);
}
