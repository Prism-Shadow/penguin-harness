import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("names the app in the first entry, dev suffix included", () => {
    expect(
      trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true, locale: "en" })[0]?.label,
    ).toBe("Open PenguinHarness");
    expect(
      trayMenuTemplate({ appName: "PenguinHarness Dev", closeToTray: true, locale: "en" })[0]
        ?.label,
    ).toBe("Open PenguinHarness Dev");
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

  it("opens a draft for New Session, not the last conversation", () => {
    // `/chat` with no session in the path redirects to the most recent conversation, so the
    // entry has to name the Web App's draft sentinel. This package cannot import it — it does
    // not depend on the Web App — so the literal is checked against the source that owns it.
    const chatPage = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../web/src/features/chat/chat-page.tsx"),
      "utf8",
    );
    const draftId = /export const DRAFT_SESSION_ID = "([^"]+)"/.exec(chatPage)?.[1];
    expect(draftId, "DRAFT_SESSION_ID moved or was renamed in the Web App").toBeDefined();
    expect(TRAY_NAV_PATHS["new-session"]).toBe(`/chat/${draftId}`);
  });
});

describe("resolveTrayLocale", () => {
  it("follows the device the way the Web App follows the browser", () => {
    // Mirrors resolveSystemLocale in packages/web/src/state/locale.tsx: unsupported device languages fall back to English,
    // including when the device language is unavailable.
    for (const tag of ["zh", "zh-CN", "zh-TW", "ZH-Hans"])
      expect(resolveTrayLocale(tag)).toBe("en");
    for (const tag of ["en", "en-GB", "fr", "ja", "", undefined])
      expect(resolveTrayLocale(tag)).toBe("en");
  });
});
