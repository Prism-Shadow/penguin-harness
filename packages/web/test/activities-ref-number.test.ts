import { describe, expect, it } from "vitest";
import { checkRefNumber, renumberManifestText } from "../src/features/activities/ref-number";

describe("checkRefNumber", () => {
  it("accepts a free whole number", () => {
    expect(checkRefNumber(" 13 ", 12, [12, 14])).toEqual({ ok: true, refNum: 13 });
    expect(checkRefNumber("0", 12, [12])).toEqual({ ok: true, refNum: 0 });
  });

  it("refuses what is not a whole number of 0 or more", () => {
    for (const text of ["", "-1", "1.5", "abc", "1e3", "99999999999999999999"])
      expect(checkRefNumber(text, 1, [])).toEqual({ ok: false, problem: "invalid" });
  });

  it("refuses the ref's own number and a number another ref uses", () => {
    expect(checkRefNumber("12", 12, [12])).toEqual({ ok: false, problem: "unchanged" });
    expect(checkRefNumber("14", 12, [12, 14])).toEqual({ ok: false, problem: "taken", refNum: 14 });
  });
});

describe("renumberManifestText", () => {
  it("moves unsaved manifest edits to the new number and keeps the rest", () => {
    const text = JSON.stringify({ productCode: "P", refNum: 12, assets: { "en-US": [] } });
    expect(JSON.parse(renumberManifestText(text, 12, 13))).toEqual({
      productCode: "P",
      refNum: 13,
      assets: { "en-US": [] },
    });
  });

  it("leaves text it cannot safely rewrite alone", () => {
    for (const text of ["", "{ broken", "[1]", "null", '{"refNum":7}'])
      expect(renumberManifestText(text, 12, 13)).toBe(text);
  });
});
