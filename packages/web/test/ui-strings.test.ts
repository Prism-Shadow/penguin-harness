/**
 * The shared UI package's accessibility fallbacks in the app's words (lib/ui-strings.ts).
 *
 * - Each language hands over one stable object, so the provider's value does not change between
 *   renders, and the two languages hand over different words.
 * - The English chart words count one category in the singular and several in the plural, as a
 *   chart's spoken summary reads them.
 */
import { describe, expect, it } from "vitest";
import { uiStringsFor } from "../src/lib/ui-strings";

describe("uiStringsFor", () => {
  it("keeps one object per language, so the provider's value does not change between renders", () => {
    expect(uiStringsFor("en")).toBe(uiStringsFor("en"));
    expect(uiStringsFor("zh")).toBe(uiStringsFor("zh"));
    expect(uiStringsFor("zh").close).not.toBe(uiStringsFor("en").close);
  });

  it("counts one chart category in the singular and several in the plural, in English", () => {
    const { categories } = uiStringsFor("en").a2ui;
    expect(categories(1)).toMatch(/\b1 category\b/);
    expect(categories(3)).toMatch(/\b3 categories\b/);
  });
});
