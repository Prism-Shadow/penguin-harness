/**
 * The language of the extension's pages and of its listing.
 *
 * - Given a Chinese browser and no choice made, the options page and the popup open in English.
 * - Given the options page, when the user picks 中文, the choice is stored and the page turns
 *   Chinese at once, the outcome of a pairing included; a popup opened afterwards opens in Chinese.
 * - Given the popup open, a pick made in another page reaches it at once, and picking EN in the
 *   popup turns it back.
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

function pick(page: FakePage, language: "en" | "zh"): void {
  const button = page.find("language", "language", language);
  if (button === undefined) throw new Error(`the page shows no ${language} switch`);
  button.click();
}

beforeEach(() => {
  fake = installChrome();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the pages' language", () => {
  it.each([
    ["the options page", "pair"],
    ["the popup", "popup"],
  ] as const)(
    "%s opens in English in a Chinese browser when no language was picked",
    async (_page, name) => {
      const page = await openPage(name, { browserLanguage: "zh-CN" });

      expect(page.lang).toBe("en");
      expect(page.text()).not.toMatch(HAN);
      expect(page.find("language", "language", "en")?.getAttribute("aria-pressed")).toBe("true");
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

    pick(options, "zh");
    await settled();

    expect(fake.local.data.uiLanguage).toBe("zh");
    expect(options.lang).toBe("zh-CN");
    expect(options.byId("intro").textContent).toMatch(HAN);
    expect(options.byId("pair-message").textContent).toMatch(HAN);
    expect(options.find("language", "language", "zh")?.getAttribute("aria-pressed")).toBe("true");

    const popup = await openPage("popup");
    expect(popup.lang).toBe("zh-CN");
    expect(popup.byId("count").textContent).toMatch(HAN);
  });

  it("an open popup follows a pick made in another page, and its own EN turns it back", async () => {
    const popup = await openPage("popup");
    expect(popup.byId("settings").textContent).not.toMatch(HAN);

    // What the options page's switch writes.
    await fake.local.set({ uiLanguage: "zh" });
    await settled();
    expect(popup.lang).toBe("zh-CN");
    expect(popup.byId("settings").textContent).toMatch(HAN);
    expect(popup.byId("count").textContent).toMatch(HAN);

    pick(popup, "en");
    await settled();
    expect(fake.local.data.uiLanguage).toBe("en");
    expect(popup.lang).toBe("en");
    expect(popup.text()).not.toMatch(HAN);
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
