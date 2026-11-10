/**
 * The main window's title bar: the system's is hidden on every platform, and the page draws a
 * band across the window's top in its place. Pure — no Electron imports — so it unit-tests under
 * plain vitest, and the preload (preload.ts) bundles it.
 *
 * - macOS keeps the traffic lights, inset into the band (`hiddenInset`). `titleBarOverlay` turns
 *   on the Window Controls Overlay there, whose `titlebar-area-*` CSS environment variables tell
 *   the page how tall the band is and how much of it the lights take.
 * - Windows and Linux keep no system control at all (`hidden`, with no overlay): the page draws
 *   minimize, maximize and close itself and drives them through the window-controls bridge
 *   (preload.ts), which also tells it the band's height. Windows 11's snap layouts, which open from
 *   the system's own maximize button, go with that button; Win+Z still opens them.
 *
 * The Web App reads the band's height from one CSS variable and says that it lays the band out
 * itself with `data-window-controls` on its root element. A page that does not — an older
 * server's Web App, which attach mode can load, or any page that is not the Web App — gets the
 * fallback band below, so the window can always be dragged, minimized and closed.
 */

/** The band's height in CSS pixels. */
export const TITLE_BAR_HEIGHT = 36;

/** The constructor options that replace the system title bar on the main window. */
export type TitleBarWindowOptions =
  | { titleBarStyle: "hiddenInset"; titleBarOverlay: { height: number } }
  | { titleBarStyle: "hidden" };

export function titleBarWindowOptions(platform: NodeJS.Platform): TitleBarWindowOptions {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", titleBarOverlay: { height: TITLE_BAR_HEIGHT } };
  }
  return { titleBarStyle: "hidden" };
}

/** What a window control does, as the bridge and the fallback band's buttons name it. */
export type WindowControlAction = "minimize" | "toggleMaximize" | "close";

/** One of the fallback band's buttons: its action, its accessible name and its 10×10 glyph. */
export interface FallbackBandButton {
  action: WindowControlAction;
  label: string;
  path: string;
}

/** The band the shell gives a page that lays out none of its own. */
export interface FallbackBand {
  /** The stylesheet inserted into every page the main window loads. */
  css: string;
  /** The window buttons at the band's right end, in order; none where the system draws its own. */
  buttons: readonly FallbackBandButton[];
}

/** The attribute on the fallback band's element, which the preload appends to every page. */
export const FALLBACK_BAND_ATTRIBUTE = "data-penguin-window-band";

/**
 * The fallback band for a platform. Its element is in every page, hidden; the stylesheet shows it,
 * and moves the body down by the band's height, only while the root element lacks
 * `data-window-controls` — so it gives way the moment the Web App draws its own band.
 *
 * On macOS a page that declares `data-titlebar-area` is left alone as well: that is how a Web App
 * older than this shell says it reserves the Window Controls Overlay's band, and the overlay is
 * still there on macOS. Windows and Linux no longer have one, so the same page needs the fallback.
 */
export function fallbackBand(platform: NodeJS.Platform): FallbackBand {
  const root =
    platform === "darwin"
      ? ":root:not([data-window-controls]):not([data-titlebar-area])"
      : ":root:not([data-window-controls])";
  const band = `[${FALLBACK_BAND_ATTRIBUTE}]`;
  const height = `${TITLE_BAR_HEIGHT}px`;
  const css = `
${band} {
  display: none;
}
${root} body {
  box-sizing: border-box;
  padding-top: ${height};
}
${root} > ${band} {
  display: flex;
  justify-content: flex-end;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${height};
  z-index: 2147483647;
  -webkit-app-region: drag;
  app-region: drag;
}
${band} > button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: CanvasText;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
${band} > button:hover {
  background: rgb(128 128 128 / 0.2);
}
${band} > button[data-action="close"]:hover {
  background: #c42b1c;
  color: #fff;
}
${band} > button > svg {
  width: 10px;
  height: 10px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
}
`;
  const buttons: FallbackBandButton[] =
    platform === "darwin"
      ? []
      : [
          { action: "minimize", label: "Minimize", path: "M0 5.5h10" },
          { action: "toggleMaximize", label: "Maximize", path: "M.5.5h9v9h-9z" },
          { action: "close", label: "Close", path: "M0 0l10 10M10 0 0 10" },
        ];
  return { css, buttons };
}
