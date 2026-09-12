import { describe, expect, it } from "vitest";
import { CLOSE_TO_TRAY_LABEL, TRAY_NAV_PATHS, trayMenuTemplate } from "../src/tray-menu.js";

describe("trayMenuTemplate", () => {
  it("lists the actions in order, separated into groups", () => {
    const template = trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true });
    expect(template.map((item) => item.action ?? item.type)).toEqual([
      "open",
      "separator",
      "new-session",
      "models",
      "separator",
      "toggle-close-to-tray",
      "separator",
      "quit",
    ]);
  });

  it("names the app in the first entry, dev suffix included", () => {
    expect(trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true })[0]?.label).toBe(
      "Open PenguinHarness",
    );
    expect(trayMenuTemplate({ appName: "PenguinHarness Dev", closeToTray: true })[0]?.label).toBe(
      "Open PenguinHarness Dev",
    );
  });

  it("shows the close-to-tray preference as a checkbox", () => {
    for (const closeToTray of [true, false]) {
      const item = trayMenuTemplate({ appName: "PenguinHarness", closeToTray }).find(
        (entry) => entry.action === "toggle-close-to-tray",
      );
      expect(item).toEqual({
        action: "toggle-close-to-tray",
        label: CLOSE_TO_TRAY_LABEL,
        type: "checkbox",
        checked: closeToTray,
      });
    }
  });

  it("navigates inside the window, so every destination is an app-origin path", () => {
    expect(TRAY_NAV_PATHS).toEqual({ "new-session": "/chat", models: "/models" });
    for (const target of Object.values(TRAY_NAV_PATHS)) expect(target.startsWith("/")).toBe(true);
  });
});
