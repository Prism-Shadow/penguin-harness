/**
 * Perler Studio: the interface language.
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
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../workbenches/perler-studio/ui/assets/js/i18n.js", import.meta.url),
  "utf8",
);

/** Where the page keeps the choice made with the switch. */
const SAVED = "perler.studio.lang";

interface I18n {
  lang(): "zh" | "en";
  setLang(code: string): void;
  onChange(fn: (code: string) => void): void;
  strings: Record<"zh" | "en", Record<string, unknown>>;
}

/** A browser's storage for this page; it outlives the page, as the real one does. */
function browserStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
}

/** Opens the page on a device with the given language: the language script runs afresh. */
function openPage(language: string | undefined, storage = browserStorage()) {
  const documentElement = { lang: "" };
  const sandbox: Record<string, unknown> = {
    navigator: language === undefined ? {} : { language },
    localStorage: storage,
    document: { documentElement },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox);
  const { i18n } = sandbox.PS as { i18n: I18n };
  return { i18n, documentElement, storage };
}

describe("the interface language", () => {
  it("follows the device when nothing is saved: Chinese for zh, English for anything else", () => {
    for (const language of ["zh", "zh-CN", "zh-TW", "zh-Hant-HK"]) {
      const page = openPage(language);
      expect(page.i18n.lang(), language).toBe("zh");
      expect(page.documentElement.lang, language).toBe("zh-CN");
    }
    for (const language of ["en-US", "en", "ja-JP", "fr-FR", "", undefined]) {
      const page = openPage(language);
      expect(page.i18n.lang(), String(language)).toBe("en");
      expect(page.documentElement.lang, String(language)).toBe("en");
    }
  });

  it("opens again in the language picked with the switch, whatever the device says", () => {
    const cases = [
      // first device, the pick, the device the page opens on next
      ["zh-CN", "en", "zh-CN"],
      ["en-US", "zh", "en-US"],
      // picking the language already shown is a choice too: it outlasts a device change
      ["zh-CN", "zh", "en-US"],
    ] as const;
    for (const [device, picked, nextDevice] of cases) {
      const storage = browserStorage();
      const first = openPage(device, storage);
      const heard: string[] = [];
      first.i18n.onChange((code) => heard.push(code));
      first.i18n.setLang(picked);
      expect(heard).toEqual([picked]);
      expect(first.i18n.lang()).toBe(picked);
      expect(first.documentElement.lang).toBe(picked === "zh" ? "zh-CN" : "en");

      const again = openPage(nextDevice, storage);
      expect(again.i18n.lang()).toBe(picked);
      expect(again.documentElement.lang).toBe(picked === "zh" ? "zh-CN" : "en");
    }
  });

  it("lets the device decide when the saved value is not a language the page has", () => {
    for (const saved of ["fr", "EN", "zh-CN", "", "null"]) {
      expect(openPage("zh-CN", browserStorage({ [SAVED]: saved })).i18n.lang(), saved).toBe("zh");
      expect(openPage("en-US", browserStorage({ [SAVED]: saved })).i18n.lang(), saved).toBe("en");
    }
  });

  it("has an English text for every Chinese one", () => {
    const { strings } = openPage("en-US").i18n;
    expect(Object.keys(strings.en).sort()).toEqual(Object.keys(strings.zh).sort());
  });
});
