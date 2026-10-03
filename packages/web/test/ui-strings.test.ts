/**
 * The shared UI package's accessibility fallbacks in the app's words (lib/ui-strings.ts).
 *
 * - Every key the package asks for is mapped in both languages, each with real words (a
 *   formatter naming its subject), a nested group (`a2ui`) key by key.
 * - Each language hands over one stable object, so the provider's value does not change between
 *   renders.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_UI_STRINGS } from "@prismshadow/penguin-ui";
import { uiStringsFor } from "../src/lib/ui-strings";

/** Every leaf of a strings object, a nested group's keys as `group.key`. */
function leaves(strings: object, prefix = ""): [string, unknown][] {
  return Object.entries(strings).flatMap(([key, value]): [string, unknown][] =>
    typeof value === "object" && value !== null
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

const KEYS = leaves(DEFAULT_UI_STRINGS)
  .map(([key]) => key)
  .sort();

describe("uiStringsFor", () => {
  it("maps every key the package asks for, in both languages", () => {
    for (const locale of ["zh", "en"] as const) {
      const entries = leaves(uiStringsFor(locale));
      expect(entries.map(([key]) => key).sort(), locale).toEqual(KEYS);
      for (const [key, value] of entries) {
        // A formatter (`moreInfoAbout`) is checked by what it says about a subject.
        const text = typeof value === "function" ? value("Vault") : value;
        expect(typeof text === "string" && text.trim() !== "", `${locale}.${key}`).toBe(true);
        if (typeof value === "function") expect(text, `${locale}.${key}`).toContain("Vault");
      }
    }
  });

  it("keeps one object per language, so the provider's value does not change between renders", () => {
    expect(uiStringsFor("en")).toBe(uiStringsFor("en"));
  });
});
