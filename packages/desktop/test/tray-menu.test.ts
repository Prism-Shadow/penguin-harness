import { describe, expect, it } from "vitest";
import {
  TRAY_LABELS,
  TRAY_NAV_PATHS,
  resolveTrayLocale,
  trayMenuTemplate,
} from "../src/tray-menu.js";

describe("trayMenuTemplate", () => {
  it("lists the actions in order, separated into groups", () => {
    const template = trayMenuTemplate({
      appName: "PenguinHarness",
      closeToTray: true,
      locale: "en",
    });
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

  it("names the app in the first entry, dev suffix included, in either language", () => {
    for (const appName of ["PenguinHarness", "PenguinHarness Dev"]) {
      for (const locale of ["en", "zh"] as const) {
        const first = trayMenuTemplate({ appName, closeToTray: true, locale })[0];
        expect(first?.action).toBe("open");
        expect(first?.label, `${appName} (${locale})`).toContain(appName);
      }
    }
  });

  it("shows the close-to-tray preference as a checkbox", () => {
    for (const closeToTray of [true, false]) {
      const item = trayMenuTemplate({ appName: "PenguinHarness", closeToTray, locale: "en" }).find(
        (entry) => entry.action === "toggle-close-to-tray",
      );
      expect(item).toEqual({
        action: "toggle-close-to-tray",
        label: TRAY_LABELS.en.closeToTray,
        type: "checkbox",
        checked: closeToTray,
      });
    }
  });

  it("navigates inside the window, so every destination is an app-origin path", () => {
    for (const target of Object.values(TRAY_NAV_PATHS)) expect(target.startsWith("/")).toBe(true);
  });

  it("draws every entry in the language it is given", () => {
    const zh = trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true, locale: "zh" });
    const en = trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true, locale: "en" });
    // Same entries, same order, different wording: the language must not change the menu.
    expect(zh.map((i) => i.action ?? i.type)).toEqual(en.map((i) => i.action ?? i.type));
    zh.forEach((item, i) => {
      if (item.action === undefined) return;
      expect(item.label, item.action).toBeTruthy();
      expect(item.label, item.action).not.toBe(en[i]!.label);
    });
  });
});

describe("resolveTrayLocale", () => {
  it("follows the device the way the Web App follows the browser", () => {
    // Mirrors resolveSystemLocale in packages/web/src/state/locale.tsx: any zh tag is zh,
    // everything else — including an unavailable one — is en.
    for (const tag of ["zh", "zh-CN", "zh-TW", "ZH-Hans"])
      expect(resolveTrayLocale(tag)).toBe("zh");
    for (const tag of ["en", "en-GB", "fr", "ja", "", undefined])
      expect(resolveTrayLocale(tag)).toBe("en");
  });
});
