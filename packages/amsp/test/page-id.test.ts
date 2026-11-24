/**
 * Page ids (`page-id.ts`) and the narrowing `normalizeSessionSource` does over them.
 *
 * - A page id is a Session id's shape with `page-` in place of `session-`: same timestamp,
 *   same 8 hex.
 * - `isPageSource` says yes to what core and the server mint and no to anything else — a bare
 *   `page-`, a value with a path separator or a space in it, a longer-than-a-Session-id string.
 * - `normalizeSessionSource` keeps a page id as it is (it is a source), and still reads junk as
 *   a person's conversation and the retired `benchmark` as `cli`.
 */
import { describe, expect, it } from "vitest";
import { normalizeSessionSource } from "../src/records/source.js";
import { isPageSource, PAGE_ID_PREFIX } from "../src/records/page-id.js";

const TODAY = new Date(2026, 10, 23, 9, 5, 7);

/** A page id shaped as core mints one (core's own `formatPageId` has the same shape). */
function pageIdOf(date: Date, hex = "abcdef12"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${PAGE_ID_PREFIX}${day}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${hex}`;
}

describe("isPageSource", () => {
  it("accepts the id the server mints, in the alphabet a Session id already uses", () => {
    expect(isPageSource(pageIdOf(TODAY))).toBe(true);
    expect(isPageSource("page-a")).toBe(true);
    expect(isPageSource("page-with_underscores-1")).toBe(true);
  });

  it("refuses the prefix alone, junk inside it, and anything that is no string", () => {
    expect(isPageSource(PAGE_ID_PREFIX)).toBe(false);
    expect(isPageSource("")).toBe(false);
    expect(isPageSource("page-../whatever")).toBe(false);
    expect(isPageSource("page-a b")).toBe(false);
    expect(isPageSource("page-a\nb")).toBe(false);
    expect(isPageSource(`page-${"a".repeat(200)}`)).toBe(false);
    expect(isPageSource(undefined)).toBe(false);
    expect(isPageSource(7)).toBe(false);
    expect(isPageSource({ source: "page-a" })).toBe(false);
  });
});

describe("normalizeSessionSource", () => {
  it("keeps a page id as written, so a page's Sessions stay that page's", () => {
    const pageId = pageIdOf(TODAY);
    expect(normalizeSessionSource(pageId)).toBe(pageId);
  });

  it("still reads the kinds, a missing source, the retired benchmark and junk as before", () => {
    expect(normalizeSessionSource("workbench")).toBe("workbench");
    expect(normalizeSessionSource(undefined)).toBe("user");
    expect(normalizeSessionSource("benchmark")).toBe("cli");
    expect(normalizeSessionSource("page-../x")).toBe("user");
    expect(normalizeSessionSource("weird-origin")).toBe("user");
  });
});
