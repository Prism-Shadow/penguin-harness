/**
 * The main window's preload: the window-controls bridge, and nothing else. It runs sandboxed with
 * context isolation, and the page sees only what `contextBridge` hands it as `window.penguinWindow`:
 *
 * - `minimize()`, `toggleMaximize()` and `close()`;
 * - `isMaximized()` and `onMaximizedChange(listener)`, which returns its own unsubscribe;
 * - `platform` and `bandHeight`, the title band's height in CSS pixels.
 *
 * No Node, no file, no network and no server capability crosses: every other thing the page does
 * still goes through the server's HTTP API. The main process accepts these messages only from the
 * main window's own page (window-controls.ts).
 *
 * The preload also adds the fallback band to every page the window loads (title-bar.ts): an
 * element of its own on the root, shown by the stylesheet only while the page has not said it lays
 * the band out itself. Its buttons send the same messages the bridge does.
 *
 * Bundled to CommonJS on its own (tsup.config.ts): a sandboxed preload cannot load ES modules,
 * and it may require nothing but Electron's renderer modules.
 */
import { contextBridge, ipcRenderer, webFrame } from "electron";
import { FALLBACK_BAND_ATTRIBUTE, TITLE_BAR_HEIGHT, fallbackBand } from "./title-bar.js";
import type { WindowControlAction } from "./title-bar.js";
import { WINDOW_CONTROL_CHANNEL } from "./window-controls.js";

let maximized = false;
const listeners = new Set<(maximized: boolean) => void>();

function adoptMaximized(next: boolean): void {
  if (next === maximized) return;
  maximized = next;
  for (const listener of listeners) listener(next);
}

ipcRenderer.on(WINDOW_CONTROL_CHANNEL.maximizedChanged, (_event, value: unknown) =>
  adoptMaximized(value === true),
);
// A reload of a maximized window starts here, so the state is asked for once on every load.
ipcRenderer.invoke(WINDOW_CONTROL_CHANNEL.isMaximized).then(
  (value: unknown) => adoptMaximized(value === true),
  () => undefined,
);

const send = (action: WindowControlAction) => (): void =>
  ipcRenderer.send(WINDOW_CONTROL_CHANNEL[action]);

contextBridge.exposeInMainWorld("penguinWindow", {
  platform: process.platform,
  bandHeight: TITLE_BAR_HEIGHT,
  isMaximized: (): boolean => maximized,
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  minimize: send("minimize"),
  toggleMaximize: send("toggleMaximize"),
  close: send("close"),
});

/**
 * The few DOM members the fallback band touches. The package compiles against Node's types alone,
 * which the main process needs, so these are spelled out here rather than pulling in the DOM's.
 */
interface PageNode {
  setAttribute(name: string, value: string): void;
  append(...nodes: PageNode[]): void;
  addEventListener(type: "click", listener: () => void): void;
}
declare const window: { addEventListener(type: "DOMContentLoaded", listener: () => void): void };
declare const document: {
  createElement(tag: "div" | "button"): PageNode;
  createElementNS(namespace: string, tag: "svg" | "path"): PageNode;
  readonly documentElement: PageNode;
};

const SVG_NS = "http://www.w3.org/2000/svg";

window.addEventListener("DOMContentLoaded", () => {
  const band = fallbackBand(process.platform);
  // Inserted by the frame rather than as a <style> element, so a page's content security policy
  // cannot refuse it.
  webFrame.insertCSS(band.css);
  const element = document.createElement("div");
  element.setAttribute(FALLBACK_BAND_ATTRIBUTE, "");
  for (const { action, label, path } of band.buttons) {
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("data-action", action);
    button.setAttribute("aria-label", label);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 10 10");
    svg.setAttribute("aria-hidden", "true");
    const glyph = document.createElementNS(SVG_NS, "path");
    glyph.setAttribute("d", path);
    svg.append(glyph);
    button.append(svg);
    button.addEventListener("click", send(action));
    element.append(button);
  }
  document.documentElement.append(element);
});
