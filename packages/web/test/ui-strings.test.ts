/**
 * The shared UI package's accessibility fallbacks in the app's words (src/lib/ui-strings.ts): every
 * `UiStrings` key is mapped from both dictionaries, and the language provider hands them over.
 *
 * vitest runs node-only here, and `LocaleProvider` reads localStorage and the browser's language
 * as it mounts, so the mounting is pinned by its source rather than by a render.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_UI_STRINGS } from "@prismshadow/penguin-ui";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { uiStringsFor, uiStringsOf } from "../src/lib/ui-strings";

const KEYS = Object.keys(DEFAULT_UI_STRINGS).sort();

describe("uiStringsFor", () => {
  it("maps every key the package asks for, in both languages", () => {
    for (const locale of ["zh", "en"] as const) {
      const strings = uiStringsFor(locale);
      expect(Object.keys(strings).sort(), locale).toEqual(KEYS);
      for (const [key, value] of Object.entries(strings)) {
        // A formatter (`moreInfoAbout`) is checked by what it says about a subject.
        const text = typeof value === "function" ? value("Vault") : value;
        expect(typeof text === "string" && text.trim() !== "", `${locale}.${key}`).toBe(true);
        if (typeof value === "function") expect(text, `${locale}.${key}`).toContain("Vault");
      }
    }
  });

  it("speaks each dictionary's words", () => {
    expect(uiStringsFor("zh")).toEqual(uiStringsOf(zh));
    expect(uiStringsFor("en")).toEqual(uiStringsOf(en));
    expect(uiStringsFor("zh").close).toBe(zh.common.close);
    expect(uiStringsFor("en").copied).toBe(en.common.copied);
    expect(uiStringsFor("zh").close).not.toBe(uiStringsFor("en").close);
  });

  it("keeps one object per language, so the provider's value does not change between renders", () => {
    expect(uiStringsFor("en")).toBe(uiStringsFor("en"));
  });
});

describe("LocaleProvider", () => {
  it("hands the package the words of the language it resolved", () => {
    const source = readFileSync(new URL("../src/state/locale.tsx", import.meta.url), "utf8");
    expect(source).toContain("<UiStringsProvider strings={uiStringsFor(locale)}>");
  });
});
