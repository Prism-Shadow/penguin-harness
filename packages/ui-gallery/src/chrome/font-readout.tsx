/**
 * The fonts in use, as the top bar and each surface page state them: the Latin, CJK and mono
 * families and the root size, read from a framed app's computed styles — the first frame on the
 * page reports its readout here once it has loaded — or, on a page without a frame, from the
 * page's own root, which carries the same theme attributes and theme sheets.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { formatFontReadout, readFontReadout } from "../app/fonts";
import type { FontReadout } from "../app/fonts";
import { useGallery } from "../state";

let frameReadout: FontReadout | null = null;
const listeners = new Set<() => void>();

/** A framed app reports what it is set in; the top bar follows the latest report. */
export function reportFrameFonts(readout: FontReadout | null): void {
  frameReadout = readout;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads a frame's fonts once it has loaded and its fonts are ready; null when it has no document. */
export function readFrameFonts(frame: HTMLIFrameElement): Promise<FontReadout | null> {
  const doc = frame.contentDocument;
  if (!doc || !doc.defaultView) return Promise.resolve(null);
  return doc.fonts.ready.then(
    () => readFontReadout(doc),
    () => readFontReadout(doc),
  );
}

/** The readout the page shows: the frames' when one has reported, else the page root's. */
export function useFontReadout(): FontReadout | null {
  const { state } = useGallery();
  const reported = useSyncExternalStore(subscribe, () => frameReadout);
  const [own, setOwn] = useState<FontReadout | null>(null);
  // The page root re-applies its attributes in a layout effect on every change of these; this
  // effect runs after that, so it reads what the root now carries.
  useEffect(() => {
    let live = true;
    const read = () => {
      if (live) setOwn(readFontReadout(document));
    };
    read();
    void document.fonts.ready.then(read);
    document.fonts.addEventListener("loadingdone", read);
    return () => {
      live = false;
      document.fonts.removeEventListener("loadingdone", read);
    };
  }, [state.theme, state.mode, state.size, state.latin, state.cjk]);
  return reported ?? own;
}

/** `Latin Mona Sans · CJK MiSans · Mono JetBrains Mono · 16px`, or the pending word. */
export function FontReadoutLine() {
  const { S } = useGallery();
  const readout = useFontReadout();
  return (
    <span className="g-readout" title={S.readout.label}>
      <span className="g-readout-label">{S.readout.label}</span>
      <span className="g-readout-value">
        {readout ? formatFontReadout(readout, S.readout) : S.readout.pending}
      </span>
    </span>
  );
}
