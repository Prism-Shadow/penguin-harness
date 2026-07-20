/**
 * Request-validation helper unit tests: positiveIntParam rejects trailing garbage that
 * Number.parseInt would otherwise accept.
 */
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { positiveIntParam } from "../src/http/validate.js";
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
