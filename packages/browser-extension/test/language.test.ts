/**
 * The language of the extension's pages and of its listing.
 *
 * - Given no language picked, the options page and the popup open in Chrome's language: Chinese
 *   for any zh-* locale, English for any other; the switch reads System.
 * - Given the options page in an English Chrome, when the user picks 中文, the choice is stored and
 *   the page turns Chinese at once, the outcome of a pairing included; a popup opened afterwards
 *   opens in Chinese.
 * - Given a Chinese Chrome, when the user picks English, the pages stay English from then on: a
 *   pick wins over Chrome's language.
 * - Given the popup open, a pick made in another page reaches it at once, and picking System in
 *   the popup returns it to Chrome's language.
 * - Given the manifest's localized name and description, every message it names exists in every
 *   locale the package ships, the default one included, within the Chrome Web Store's lengths.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installChrome, type FakeChrome } from "./helpers/chrome.js";
import { openPage, settled, type FakePage } from "./helpers/dom.js";

const HAN = /\p{Script=Han}/u;

let fake: FakeChrome;

/** The user picks a language from the page's switch. */
function pick(page: FakePage, language: "en" | "zh" | "system"): void {
  if (page.find("language", "language", language) === undefined) {
    throw new Error(`the page's switch offers no ${language}`);
  }
  const select = page.byId("language");
  select.value = language;
  select.dispatch("change");
}

beforeEach(() => {
  fake = installChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pages' language", () => {
  it.each([
    ["the options page", "pair", "zh-CN", "zh-CN"],
    ["the popup", "popup", "zh-TW", "zh-CN"],
    ["the options page", "pair", "en-US", "en"],
    ["the popup", "popup", "fr-FR", "en"],
  ] as const)(
    "%s opens in Chrome's language when none was picked (Chrome in %s)",
    async (_page, name, browserLanguage, lang) => {
      const page = await openPage(name, { browserLanguage });

      expect(page.lang).toBe(lang);
      expect(HAN.test(page.text())).toBe(lang === "zh-CN");
      expect(page.byId("language").value).toBe("system");
    },
  );

  it("picking 中文 on the options page turns it Chinese at once and is kept for the next page", async () => {
    const options = await openPage("pair");
    options.byId("server-url").value = "ph.example.com";
    options.byId("code").value = "too-short";
    options.byId("pair-form").dispatch("submit");
    await settled();
    const englishError = options.byId("pair-message").textContent;
    expect(englishError).not.toBe("");
    expect(englishError).not.toMatch(HAN);

    pick(options, "zh");
    await settled();

    expect(fake.local.data.uiLanguage).toBe("zh");
    expect(options.lang).toBe("zh-CN");
    expect(options.byId("intro").textContent).toMatch(HAN);
    expect(options.byId("pair-message").textContent).toMatch(HAN);
    expect(options.byId("language").value).toBe("zh");

    const popup = await openPage("popup");
    expect(popup.lang).toBe("zh-CN");
    expect(popup.byId("count").textContent).toMatch(HAN);
  });

  it("a pick of English in a Chinese Chrome keeps the pages English", async () => {
    const options = await openPage("pair", { browserLanguage: "zh-CN" });
    expect(options.lang).toBe("zh-CN");

    pick(options, "en");
    await settled();
    expect(fake.local.data.uiLanguage).toBe("en");
    expect(options.lang).toBe("en");
    expect(options.text()).not.toMatch(HAN);

    const popup = await openPage("popup", { browserLanguage: "zh-CN" });
    expect(popup.lang).toBe("en");
    expect(popup.text()).not.toMatch(HAN);
  });

  it("an open popup follows a pick made in another page, and its System returns it to Chrome's language", async () => {
    const popup = await openPage("popup", { browserLanguage: "zh-CN" });
    expect(popup.byId("settings").textContent).toMatch(HAN);

    // What the options page's switch writes.
    await fake.local.set({ uiLanguage: "en" });
    await settled();
    expect(popup.lang).toBe("en");
    expect(popup.text()).not.toMatch(HAN);

    pick(popup, "system");
    await settled();
    expect(fake.local.data.uiLanguage).toBe("system");
    expect(popup.lang).toBe("zh-CN");
    expect(popup.byId("settings").textContent).toMatch(HAN);
    expect(popup.byId("count").textContent).toMatch(HAN);
  });
});

describe("the manifest's localized name and description", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const locales = readdirSync(path.join(root, "_locales"));
  const messages = (locale: string) =>
    JSON.parse(
      readFileSync(path.join(root, "_locales", locale, "messages.json"), "utf8"),
    ) as Record<string, { message?: string }>;
  const named = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(([, key]) => key!);

  it("names messages that every shipped locale has, the default locale among them", () => {
    expect(named).toEqual(expect.arrayContaining(["extName", "extDescription"]));
    expect(locales).toEqual(expect.arrayContaining([manifest.default_locale, "zh_CN"]));
    for (const locale of locales) {
      const table = messages(locale);
      for (const key of named) expect(table[key]?.message, `${locale}/${key}`).toBeTruthy();
    }
  });

  it.each(["en", "zh_CN"])(
    "keeps the %s name and description within the Store's limits",
    (locale) => {
      const table = messages(locale);
      expect(table.extName!.message!.length).toBeLessThanOrEqual(75);
      expect(table.extDescription!.message!.length).toBeLessThanOrEqual(132);
    },
  );
});
