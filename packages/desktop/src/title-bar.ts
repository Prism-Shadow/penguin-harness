/**
 * The main window's title bar: the system's is hidden and the Web App's own top strip takes its
 * place, with the window controls laid over it. Pure — no Electron imports — so it unit-tests
 * under plain vitest.
 *
 * - macOS keeps the traffic lights, inset into the strip (`hiddenInset`).
 * - Windows and Linux keep minimize / maximize / close, which Electron draws over the strip's
 *   right end (`titleBarOverlay`). Their background is transparent, so whatever the page paints
 *   under them shows through — the theme's strip, and the scrim of an open dialog over it; only
 *   the symbols need a colour, chosen against the page's theme colour (overlayColors).
 *
 * On all three, `titleBarOverlay` is also what hands the page the strip's geometry: the Window
 * Controls Overlay API and its `titlebar-area-*` CSS environment variables. The Web App reserves
 * `env(titlebar-area-height)` at its top and makes that band the window's drag region; a plain
 * browser defines no such variable, so the same page reserves nothing there. The height is set
 * here, once, and the page only reads it.
 *
 * A page that lays out no band of its own — a server older than this shell, which attach mode can
 * load, or anything else that is not the Web App — would sit under the controls with nothing to
 * drag the window by. TITLE_BAR_FALLBACK_CSS gives such a page the band; a page that draws its
 * own says so with `data-titlebar-area` on its root element and is left alone.
 */

/** The band's height in CSS pixels, the window controls centred in it. */
export const TITLE_BAR_HEIGHT = 36;

/** The constructor options that replace the system title bar on the main window. */
export interface TitleBarWindowOptions {
  titleBarStyle: "hidden" | "hiddenInset";
  titleBarOverlay: { height: number; color?: string; symbolColor?: string };
}

/** The overlay's colours on Windows and Linux. */
export interface OverlayColors {
  color: string;
  symbolColor: string;
}

/** Fully transparent: the page paints the band behind the buttons. */
const TRANSPARENT = "#00000000";
const SYMBOL_ON_LIGHT = "#1f1f1f";
const SYMBOL_ON_DARK = "#f2f2f2";

export function titleBarWindowOptions(
  platform: NodeJS.Platform,
  systemDark: boolean,
): TitleBarWindowOptions {
  if (platform === "darwin") {
    // The colours are Windows' and Linux's: macOS draws its own traffic lights.
    return { titleBarStyle: "hiddenInset", titleBarOverlay: { height: TITLE_BAR_HEIGHT } };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { height: TITLE_BAR_HEIGHT, ...overlayColors(null, systemDark) },
  };
}

/**
 * The overlay's colours for a page theme colour as Electron reports it (`#rrggbb`, or null when
 * the page declares none): light symbols on a dark page, dark ones on a light page. With no colour
 * to read, the system's light/dark setting decides — the Web App's own default follows it too.
 */
export function overlayColors(themeColor: string | null, systemDark: boolean): OverlayColors {
  const dark = (themeColor === null ? null : isDarkColor(themeColor)) ?? systemDark;
  return { color: TRANSPARENT, symbolColor: dark ? SYMBOL_ON_DARK : SYMBOL_ON_LIGHT };
}

/**
 * Whether a `#rrggbb` colour is dark, by WCAG relative luminance: below 0.179 white contrasts
 * with it more than black does. Null for anything that is not `#rrggbb`.
 */
function isDarkColor(hex: string): boolean | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((part) => {
    const c = parseInt(part!, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.179;
}

/**
 * The band for a page that does not draw one: the body moves down by the band's height, and a
 * transparent strip over it drags the window. Inserted into every document the main window loads;
 * the `:not([data-titlebar-area])` guard keeps it off the Web App, which lays out its own.
 */
export const TITLE_BAR_FALLBACK_CSS = `
:root:not([data-titlebar-area]) body {
  box-sizing: border-box;
  padding-top: env(titlebar-area-height, 0px);
}
:root:not([data-titlebar-area])::before {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: env(titlebar-area-height, 0px);
  z-index: 2147483647;
  -webkit-app-region: drag;
  app-region: drag;
}
`;
