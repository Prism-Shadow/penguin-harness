/**
 * The real Web App in a frame: one `app.html` document per frame — its own root for the theme
 * attributes, its own storage, its own router — opened on a surface's route with the page's
 * preferences in the URL (src/app/frame.ts). Laid out at the app's window width and scaled to
 * the column (chrome/fit.tsx), or at phone width, unscaled, in a phone-shaped frame on the
 * chrome's inset.
 *
 * A change of theme, mode, size or fonts changes the frame's URL, and the frame reloads with
 * the new preferences — the URL is the state, as everywhere in the gallery. The frame reports
 * the fonts it is actually set in, for the readout in the top bar's popover and, when the page
 * asks, its own font line.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import { useEffect, useRef, useState } from "react";
import { APP_FRAME, appFrameSrc, PHONE_FRAME } from "../app/frame";
import type { FontReadout } from "../app/fonts";
import type { Surface } from "../app/surfaces";
import { BASE } from "../lib/location";
import { useGallery } from "../state";
import { Fit } from "./fit";
import { readFrameFonts, reportFrameFonts } from "./font-readout";

/** The frame's URL for a surface under the page's preferences, in one theme. */
export function useFrameSrc(surface: Surface, theme: ThemeId): string {
  const { state } = useGallery();
  return appFrameSrc(
    BASE,
    {
      theme,
      mode: state.mode,
      accent: state.accent,
      size: state.size,
      latin: state.latin,
      cjk: state.cjk,
      lang: state.lang,
    },
    {
      route: surface.route,
      ...(surface.signedOut ? { signedOut: true } : {}),
      ...(surface.open ? { open: surface.open } : {}),
    },
  );
}

export function AppFrame({
  surface,
  onFonts,
  reloadKey = 0,
}: {
  surface: Surface;
  /** Also hand the readout to the page, for its own font line. */
  onFonts?: (readout: FontReadout | null) => void;
  /** A new value reloads the frame (the Reload control). */
  reloadKey?: number;
}) {
  const { S, state } = useGallery();
  const src = useFrameSrc(surface, state.theme);
  const phone = state.view === "phone";
  const size = phone ? PHONE_FRAME : APP_FRAME;
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src, reloadKey]);

  useEffect(() => {
    if (!loaded || !frame.current) return;
    let live = true;
    void readFrameFonts(frame.current).then((readout) => {
      if (!live) return;
      reportFrameFonts(readout);
      onFonts?.(readout);
    });
    return () => {
      live = false;
    };
  }, [loaded, src, onFonts]);

  // Leaving the page takes the frame's report with it; the popover falls back to the page's own root.
  useEffect(() => () => reportFrameFonts(null), []);

  const iframe = (
    <iframe
      key={`${src}#${reloadKey}`}
      ref={frame}
      className="g-app-frame"
      title={S.frame.frameOf(S.rail.themeNames[state.theme])}
      src={src}
      width={size.width}
      height={size.height}
      loading="eager"
      onLoad={() => setLoaded(true)}
    />
  );
  return (
    <div className="g-app" data-phone={phone || undefined} data-loaded={loaded || undefined}>
      {phone ? iframe : <Fit natural={size.width}>{iframe}</Fit>}
    </div>
  );
}
