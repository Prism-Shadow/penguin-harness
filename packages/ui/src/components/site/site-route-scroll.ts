/**
 * Scroll on a genuine route change: to the top, or with a hash to its target once it is in the
 * DOM (a TOC entry, a `/#quickstart` link back from another page). The hash is decoded first: an
 * anchor to a CJK heading arrives percent-encoded.
 *
 * The last handled history entry is module state so it survives the locale-keyed remount of the
 * whole tree (`SiteLocaleScope`): switching language remounts the layout, and without this guard
 * the effect would run again — jumping to the hash or the top — and defeat the scope's scroll
 * preservation.
 */
import { useEffect } from "react";
import { hashTargetId } from "./markdown-text";

let handledLocationKey = "";

export function useRouteScroll({
  pathname,
  hash,
  key,
}: {
  pathname: string;
  hash: string;
  /** The router's per-entry key: a new one is a new navigation. */
  key: string;
}): void {
  useEffect(() => {
    if (key === handledLocationKey) return;
    handledLocationKey = key;
    if (hash) {
      const el = document.getElementById(hashTargetId(hash));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash, key]);
}
