/**
 * Kaoyan Flashcards: the interface language.
 *
 * - Given a device set to Chinese (zh, zh-CN, zh-TW, zh-Hant-HK), when the page opens with no
 *   choice saved, it is in Chinese; given any other device language (en-US, en, ja-JP, fr-FR,
 *   or none), it is in English.
 * - Given a person who picked a language with the switch, when the page opens again, it opens
 *   in that language whatever the device says, and the page's lang attribute follows.
 * - Given a saved value that is not a language the page has, the device language decides.
 * - The English interface has an English text for every text the Chinese one has.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.join(import.meta.dirname, "../workbenches/kaoyan-flashcards/ui/i18n.js"),
  "utf8",
);

/** Where the page keeps the choice; saves already written under it are read back. */
const SAVED = "kmc:lang";

interface I18n {
  lang(): string;
  setLang(code: string): void;
  t(key: string, ...args: unknown[]): string;
  onChange(fn: (code: string) => void): void;
  strings: { zh: Record<string, unknown>; en: Record<string, unknown> };
}

/** A browser's localStorage: it outlives a page, so a second openPage sees the first's writes. */
function browserStorage(saved: Record<string, string> = {}) {
  const items = new Map(Object.entries(saved));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, String(value));
    },
  };
}

/** Loads the page's language script fresh, as opening the page does, on a device language. */
function openPage(deviceLanguage: string | undefined, storage = browserStorage()) {
  const document = { documentElement: { lang: "" } };
  const sandbox: Record<string, unknown> = {
    navigator: deviceLanguage === undefined ? {} : { language: deviceLanguage },
    localStorage: storage,
    document,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  return { i18n: sandbox.KaoyanI18n as I18n, html: document.documentElement };
}

describe("the interface language", () => {
  it("opens in Chinese on a Chinese device and in English on any other", () => {
    for (const device of ["zh", "zh-CN", "zh-TW", "zh-Hant-HK"]) {
      const page = openPage(device);
      expect(page.i18n.lang(), device).toBe("zh");
      expect(page.html.lang, device).toBe("zh-CN");
    }
    for (const device of ["en-US", "en", "ja-JP", "fr-FR", undefined]) {
      const page = openPage(device);
      expect(page.i18n.lang(), String(device)).toBe("en");
      expect(page.html.lang, String(device)).toBe("en");
    }
  });

  it("opens again in the language picked with the switch, whatever the device says", () => {
    const chineseDevice = browserStorage();
    const first = openPage("zh-CN", chineseDevice);
    const redrawn: string[] = [];
    first.i18n.onChange((code) => redrawn.push(code));
    first.i18n.setLang("en");
    expect(redrawn).toEqual(["en"]);
    expect(first.html.lang).toBe("en");

    const again = openPage("zh-CN", chineseDevice);
    expect(again.i18n.lang()).toBe("en");
    expect(again.html.lang).toBe("en");

    const englishDevice = browserStorage();
    openPage("en-US", englishDevice).i18n.setLang("zh");
    const reopened = openPage("en-US", englishDevice);
    expect(reopened.i18n.lang()).toBe("zh");
    expect(reopened.html.lang).toBe("zh-CN");
  });

  it("lets the device decide when the saved value is not a language it has", () => {
    for (const saved of ["fr", "", "ZH", "zh-CN", "english"]) {
      expect(openPage("zh-CN", browserStorage({ [SAVED]: saved })).i18n.lang(), saved).toBe("zh");
      expect(openPage("en-US", browserStorage({ [SAVED]: saved })).i18n.lang(), saved).toBe("en");
    }
  });

  it("has an English text for every text the Chinese interface has", () => {
    const { zh, en } = openPage("en").i18n.strings;
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh)) {
      // A text built from numbers (a function) in one language is built from them in the other.
      expect(typeof en[key], key).toBe(typeof zh[key]);
      if (typeof en[key] === "string") expect(en[key], key).not.toBe("");
    }
  });
});
