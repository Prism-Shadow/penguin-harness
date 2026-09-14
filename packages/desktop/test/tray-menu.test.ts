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
import type { TrayLocale } from "../src/tray-menu.js";

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

  it("draws every entry in the language it is given", () => {
    const zh = trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true, locale: "zh" });
    const en = trayMenuTemplate({ appName: "PenguinHarness", closeToTray: true, locale: "en" });
    // Same entries, same order, different wording: the language must not change the menu.
    expect(zh.map((i) => i.action ?? i.type)).toEqual(en.map((i) => i.action ?? i.type));
    expect(zh.map((i) => i.label)).toEqual([
      "打开 PenguinHarness",
      undefined,
      "新建会话",
      "模型",
      undefined,
      "关闭窗口后继续在托盘中运行",
      undefined,
      "退出",
    ]);
    // The app name is a proper noun and survives translation.
    expect(zh[0]?.label).toContain("PenguinHarness");
  });

  it("carries the same wording keys in both languages", () => {
    // A language missing an entry would draw that one blank rather than fall back, so the
    // shapes have to match. The type says so too; this says so at the value.
    const shape = (locale: TrayLocale) => Object.keys(TRAY_LABELS[locale]).sort();
    expect(shape("zh")).toEqual(shape("en"));
    for (const locale of ["zh", "en"] as const) {
      for (const [key, value] of Object.entries(TRAY_LABELS[locale])) {
        if (typeof value === "string") expect(value, `${locale}.${key}`).not.toBe("");
      }
    }
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
