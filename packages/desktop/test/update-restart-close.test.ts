/**
 * The main window's close while the app is leaving for an update (src/util.ts: onLeaving feeds
 * the `quitting` flag that hidesOnClose reads; main.ts wires it to Electron's `app` and
 * `autoUpdater`). Electron's own emitters are the edge here, so plain EventEmitters stand in.
 *
 * - Given the window hides into the tray on close, when an update's restart begins — the
 *   updater announces it, and on macOS no `before-quit` comes until every window is gone —
 *   then the window's close goes through, so the restart can happen.
 * - Given the same window, when the app quits the ordinary way, then the close goes through.
 * - Given nothing announced a departure, closing the window still only hides it.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { hidesOnClose, onLeaving } from "../src/util.js";

function shell() {
  const app = new EventEmitter();
  const updater = new EventEmitter();
  let quitting = false;
  onLeaving(app, updater, () => {
    quitting = true;
  });
  const closeHides = () => hidesOnClose({ quitting, trayShown: true, closeToTray: true });
  return { app, updater, closeHides };
}

describe("closing the window while the app leaves", () => {
  it("an update's restart closes the window instead of hiding it into the tray", () => {
    const { updater, closeHides } = shell();
    updater.emit("before-quit-for-update");
    expect(closeHides()).toBe(false);
  });

  it("an ordinary quit closes the window too", () => {
    const { app, closeHides } = shell();
    app.emit("before-quit");
    expect(closeHides()).toBe(false);
  });

  it("with no departure announced, the close still only hides the window", () => {
    const { closeHides } = shell();
    expect(closeHides()).toBe(true);
  });
});
