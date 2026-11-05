/**
 * The request-validation helpers every route parses its parameters with (http/validate.ts).
 *
 * - A positive-integer path parameter parses a plain positive integer and refuses everything
 *   else, trailing garbage included (parseInt would accept it), and an index past the safe
 *   integers.
 * - An optional date is absent for missing or empty input, accepts a real calendar date (a
 *   leap day included), and refuses a malformed shape or an impossible date the shape check
 *   alone would let through.
 * - A runtime parameter (max_turns and friends) is a positive integer or the -1 "unlimited"
 *   sentinel; an absent key is left untouched; anything else is refused.
 * - Paging defaults to offset 0 / limit 200, parses plain integers, and refuses trailing
 *   garbage, exponents and a limit outside 1..1000.
 * - Optional paging is absent when neither parameter is given, defaults a missing offset, and
 *   refuses an offset without a limit and the same malformed values.
 */
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import {
  optionalDateParam,
  optionalNumber,
  optionalPagingQuery,
  paginationQuery,
  positiveIntParam,
} from "../src/http/validate.js";
import { HttpError } from "../src/http/errors.js";

/** Minimal Context stub exposing a single path parameter. */
function ctxWithParam(name: string, value: string | undefined): Context {
  return { req: { param: (n: string) => (n === name ? value : undefined) } } as unknown as Context;
}

/** Minimal Context stub exposing query parameters. */
function ctxWithQuery(query: Record<string, string>): Context {
  return { req: { query: (n: string) => query[n] } } as unknown as Context;
}

describe("positiveIntParam", () => {
  it("parses a plain positive integer", () => {
    expect(positiveIntParam(ctxWithParam("idx", "12"), "idx")).toBe(12);
  });

  it("refuses anything but a plain positive integer", () => {
    // "12abc" is what parseInt would accept; "9"×20 parses to an imprecise 1e20 that
    // isSafeInteger rejects and isInteger would not; the empty and missing values are the
    // ones pathParam normally stops first.
    for (const bad of ["12abc", "+1", " 1", "1 ", "1.5", "0x10", "0", "9".repeat(20), ""]) {
      expect(() => positiveIntParam(ctxWithParam("idx", bad), "idx"), bad).toThrow(HttpError);
    }
    expect(() => positiveIntParam(ctxWithParam("idx", undefined), "idx")).toThrow(HttpError);
  });
});

describe("optionalDateParam", () => {
  it("is absent for missing or empty input, and accepts a real calendar date", () => {
    expect(optionalDateParam(undefined, "from")).toBeUndefined();
    expect(optionalDateParam("", "from")).toBeUndefined();
    expect(optionalDateParam("2026-07-20", "from")).toBe("2026-07-20");
    expect(optionalDateParam("2024-02-29", "from")).toBe("2024-02-29"); // leap day
  });

  it("refuses a malformed shape, and an impossible date that passes the shape check", () => {
    for (const bad of [
      "2026/07/20",
      "20260720",
      "2026-7-20",
      "not-a-date",
      "2026-13-40",
      "2026-02-30",
      "2026-00-10",
      "2026-01-00",
      "2025-02-29",
    ]) {
      expect(() => optionalDateParam(bad, "from"), bad).toThrow(HttpError);
    }
  });
});

describe("optionalNumber with the agent runtime-parameter rule (integer, > 0 or -1)", () => {
  // The exact rule agent-config PUT applies to maxTurns (and the other runtime numbers):
  // -1 is the documented "unlimited" sentinel; every other non-positive value is rejected.
  const rule = { integer: true, positiveOrMinusOne: true } as const;

  it("accepts positive integers and the -1 sentinel, and leaves an absent key untouched", () => {
    expect(optionalNumber({ maxTurns: 1 }, "maxTurns", rule)).toBe(1);
    expect(optionalNumber({ maxTurns: 100 }, "maxTurns", rule)).toBe(100);
    expect(optionalNumber({ maxTurns: -1 }, "maxTurns", rule)).toBe(-1);
    expect(optionalNumber({}, "maxTurns", rule)).toBeUndefined();
  });

  it("refuses zero, other negatives, fractions and anything that is not a finite number", () => {
    for (const bad of [0, -2, -100, 1.5, -1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", true]) {
      expect(() => optionalNumber({ maxTurns: bad }, "maxTurns", rule), String(bad)).toThrow(
        HttpError,
      );
    }
    expect(() => optionalNumber({ maxTurns: null }, "maxTurns", rule)).toThrow(HttpError);
  });
});

describe("paginationQuery", () => {
  it("defaults to offset 0 / limit 200 and parses plain integers up to 1000", () => {
    expect(paginationQuery(ctxWithQuery({}))).toEqual({ offset: 0, limit: 200 });
    expect(paginationQuery(ctxWithQuery({ offset: "40", limit: "20" }))).toEqual({
      offset: 40,
      limit: 20,
    });
    expect(paginationQuery(ctxWithQuery({ limit: "1000" })).limit).toBe(1000);
  });

  it("refuses trailing garbage, exponents and a limit outside the range", () => {
    // "200abc" parsed to 200 and "1e3" to 1, both landing inside the range check.
    for (const bad of ["200abc", "1e3", "0x10", " 20", "20 ", "1.5", "+20", "-1"]) {
      expect(() => paginationQuery(ctxWithQuery({ limit: bad })), bad).toThrow(HttpError);
      expect(() => paginationQuery(ctxWithQuery({ offset: bad })), bad).toThrow(HttpError);
    }
    for (const bad of ["0", "1001"]) {
      expect(() => paginationQuery(ctxWithQuery({ limit: bad })), bad).toThrow(HttpError);
    }
  });
});

describe("optionalPagingQuery", () => {
  it("is absent without either parameter, and defaults a missing offset", () => {
    expect(optionalPagingQuery(ctxWithQuery({}))).toBeNull();
    expect(optionalPagingQuery(ctxWithQuery({ limit: "50" }))).toEqual({ offset: 0, limit: 50 });
  });

  it("refuses an offset without a limit, and malformed values in either", () => {
    expect(() => optionalPagingQuery(ctxWithQuery({ offset: "10" }))).toThrow(HttpError);
    for (const bad of ["50abc", "1e3", "0x10", "1.5", "-1"]) {
      expect(() => optionalPagingQuery(ctxWithQuery({ limit: bad })), bad).toThrow(HttpError);
      expect(() => optionalPagingQuery(ctxWithQuery({ limit: "50", offset: bad })), bad).toThrow(
        HttpError,
      );
    }
  });
});
