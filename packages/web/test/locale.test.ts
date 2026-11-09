/**
 * locale.tsx unit tests: device language resolution (language follows
 * navigator.language when no stored preference exists; language/theme
 * initialization does not depend on login state and also applies on the
 * login page), and the document language tag the root element carries for
 * the locale on screen (the tag a screen reader announces, and what
 * translation heuristics go by).
 */
import { describe, expect, it } from "vitest";
import { applyDocumentLang, documentLangFor, resolveSystemLocale } from "../src/state/locale";

describe("resolveSystemLocale (navigator.language → UI language)", () => {
  it("zh prefix (any case or region variant) → zh", () => {
    expect(resolveSystemLocale("zh-CN")).toBe("zh");
    expect(resolveSystemLocale("ZH-TW")).toBe("zh");
  });

  it("non-Chinese or unavailable → English fallback", () => {
    expect(resolveSystemLocale("en-US")).toBe("en");
    expect(resolveSystemLocale(undefined)).toBe("en");
  });
});

describe("document lang (the root element's language tag)", () => {
  it("announces the language the dictionaries are written in", () => {
    expect(documentLangFor("zh")).toBe("zh-CN");
    expect(documentLangFor("en")).toBe("en");
  });

  it("system mode resolves first, then takes the same two tags", () => {
    expect(documentLangFor(resolveSystemLocale("zh-TW"))).toBe("zh-CN");
    expect(documentLangFor(resolveSystemLocale("en-US"))).toBe("en");
    expect(documentLangFor(resolveSystemLocale(undefined))).toBe("en");
  });

  it("stamps the tag on the document root, the last write winning", () => {
    const root = fakeRoot();
    applyDocumentLang({ documentElement: root }, "en");
    applyDocumentLang({ documentElement: root }, "zh");
    expect(root.attributes).toEqual([
      ["lang", "en"],
      ["lang", "zh-CN"],
    ]);
  });

  it("a document without a root changes nothing and does not throw", () => {
    expect(() => applyDocumentLang({ documentElement: null }, "en")).not.toThrow();
  });
});

/** Records the attribute writes applyDocumentLang performs on a root. */
function fakeRoot() {
  const attributes: Array<[string, string]> = [];
  return {
    attributes,
    setAttribute: (name: string, value: string) => {
      attributes.push([name, value]);
    },
  };
}
