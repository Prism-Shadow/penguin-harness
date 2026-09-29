/**
 * The real Web App in a frame: one `app.html` document per frame — its own root for the theme
 * attributes, its own storage, its own router — opened on a surface's route with the page's
 * preferences in the URL (src/app/frame.ts). Laid out at the app's window width and scaled to
 * the column (chrome/fit.tsx), or at phone width, unscaled; mounted lazily, so a page of
 * compare frames loads them as they come into view.
 *
 * A change of theme, mode, size or fonts changes the frame's URL, and the frame reloads with
 * the new preferences — the URL is the state, as everywhere in the gallery. The first frame on
 * a page reports the fonts it is set in, for the top bar's readout.
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
  theme,
  eager = false,
  reports = false,
  onFonts,
  reloadKey = 0,
}: {
  surface: Surface;
  theme: ThemeId;
  /** Load at once rather than when scrolled near: the home page's frame. */
  eager?: boolean;
  /** Report the fonts this frame is set in to the top bar's readout. */
  reports?: boolean;
  /** Also hand the readout to the page, for its own font line. */
  onFonts?: (readout: FontReadout | null) => void;
  /** A new value reloads the frame (the Reload control). */
  reloadKey?: number;
}) {
  const { S, state } = useGallery();
  const src = useFrameSrc(surface, theme);
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
      if (reports) reportFrameFonts(readout);
      onFonts?.(readout);
    });
    return () => {
      live = false;
    };
  }, [loaded, src, reports, onFonts]);

  useEffect(() => {
    if (!reports) return;
    return () => reportFrameFonts(null);
  }, [reports]);

  const themeName = S.rail.themeNames[theme];
  const iframe = (
    <iframe
      key={`${src}#${reloadKey}`}
      ref={frame}
      className="g-app-frame"
      title={S.frame.frameOf(themeName)}
      src={src}
      width={size.width}
      height={size.height}
      loading={eager ? "eager" : "lazy"}
      onLoad={() => setLoaded(true)}
    />
  );
  return (
    <div className="g-app" data-phone={phone || undefined} data-loaded={loaded || undefined}>
      {phone ? iframe : <Fit natural={size.width}>{iframe}</Fit>}
    </div>
  );
}

/** One frame per theme when comparing, captioned; the active theme's alone otherwise. */
export function ThemeFrames({
  surface,
  themes,
  eager = false,
  reloadKey = 0,
  onFonts,
}: {
  surface: Surface;
  themes: readonly ThemeId[];
  eager?: boolean;
  reloadKey?: number;
  onFonts?: (readout: FontReadout | null) => void;
}) {
  const { S, state } = useGallery();
  return (
    <div
      className="g-framed"
      data-compare={themes.length > 1 || undefined}
      data-phone={state.view === "phone" || undefined}
    >
      {themes.map((theme, index) => (
        <figure key={theme} className="g-framed-item">
          {themes.length > 1 && (
            <figcaption>
              <span className="g-framed-theme">{S.rail.themeNames[theme]}</span>
            </figcaption>
          )}
          <AppFrame
            surface={surface}
            theme={theme}
            eager={eager && index === 0}
            reports={index === 0}
            reloadKey={reloadKey}
            {...(index === 0 && onFonts ? { onFonts } : {})}
          />
        </figure>
      ))}
    </div>
  );
}
