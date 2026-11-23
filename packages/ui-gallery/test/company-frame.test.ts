/**
 * The company prototype's frame contract: the URL a page frames it by, and what the document
 * reads back from it.
 *
 * - Given a start, a theme, a mode and a language, the embedded URL names the prototype's document
 *   with all four and `embed=1`, and the document reads the same start and language back.
 * - Given a URL with no start, an unknown start or an unknown language, the document opens the
 *   week in English, and is not a guest unless the URL says so.
 */
import { describe, expect, it } from "vitest";
import { companyFrameSrc, parseCompanyParams } from "../src/company/frame";

describe("the company prototype's frame", () => {
  it("round-trips the start and the language through the embedded URL", () => {
    const src = companyFrameSrc("/gallery", { theme: "modern", mode: "dark", lang: "zh" }, "fresh");
    const [path, query] = src.split("?");
    expect(path).toBe("/gallery/company.html");
    expect(Object.fromEntries(new URLSearchParams(query))).toEqual({
      start: "fresh",
      theme: "modern",
      mode: "dark",
      lang: "zh",
      embed: "1",
    });
    expect(parseCompanyParams(`?${query}`)).toEqual({ start: "fresh", lang: "zh", embedded: true });
  });

  it("opens the week in English, on its own, for anything it does not know", () => {
    const fallback = { start: "week", lang: "en", embedded: false };
    expect(parseCompanyParams("")).toEqual(fallback);
    expect(parseCompanyParams("?start=later&lang=fr&embed=0")).toEqual(fallback);
  });
});
