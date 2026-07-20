/**
 * Request-validation helper unit tests: positiveIntParam rejects trailing garbage, and
 * optionalDateParam rejects impossible calendar dates (shape-only checks let these through).
 */
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { optionalDateParam, positiveIntParam } from "../src/http/validate.js";
import { HttpError } from "../src/http/errors.js";

/** Minimal Context stub exposing a single path parameter. */
function ctxWithParam(name: string, value: string | undefined): Context {
  return { req: { param: (n: string) => (n === name ? value : undefined) } } as unknown as Context;
}

describe("positiveIntParam", () => {
  it("parses a plain positive integer", () => {
    expect(positiveIntParam(ctxWithParam("idx", "12"), "idx")).toBe(12);
  });

  it("rejects trailing garbage (parseInt would accept it)", () => {
    expect(() => positiveIntParam(ctxWithParam("idx", "12abc"), "idx")).toThrow(HttpError);
  });

  it("rejects a leading sign, whitespace, and non-digits", () => {
    for (const bad of ["+1", " 1", "1 ", "1.5", "0x10", ""]) {
      expect(() => positiveIntParam(ctxWithParam("idx", bad), "idx")).toThrow(HttpError);
    }
  });

  it("rejects zero (must be >= 1)", () => {
    expect(() => positiveIntParam(ctxWithParam("idx", "0"), "idx")).toThrow(HttpError);
  });
});

describe("optionalDateParam", () => {
  it("returns undefined for missing or empty input", () => {
    expect(optionalDateParam(undefined, "from")).toBeUndefined();
    expect(optionalDateParam("", "from")).toBeUndefined();
  });

  it("accepts a real calendar date", () => {
    expect(optionalDateParam("2026-07-20", "from")).toBe("2026-07-20");
    expect(optionalDateParam("2024-02-29", "from")).toBe("2024-02-29"); // leap day
  });

  it("rejects malformed shapes", () => {
    for (const bad of ["2026/07/20", "20260720", "2026-7-20", "not-a-date"]) {
      expect(() => optionalDateParam(bad, "from")).toThrow(HttpError);
    }
  });

  it("rejects impossible dates that pass the shape check", () => {
    for (const bad of ["2026-13-40", "2026-02-30", "2026-00-10", "2026-01-00", "2025-02-29"]) {
      expect(() => optionalDateParam(bad, "from")).toThrow(HttpError);
    }
  });
});
