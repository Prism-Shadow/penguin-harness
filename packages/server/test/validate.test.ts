/**
 * Request-validation helper unit tests: positiveIntParam and the two paging helpers reject
 * trailing garbage, optionalDateParam rejects impossible calendar dates (shape-only checks
 * let these through), and optionalNumber enforces the agent runtime-parameter rule
 * (integer, > 0 or exactly -1) used for max_turns and friends. readJson separates the one body
 * failure that is not a shape problem — a body too large to become a string — from the parse
 * error it would otherwise be reported as.
 */
import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import { constants } from "node:buffer";
import {
  optionalDateParam,
  optionalNumber,
  optionalPagingQuery,
  paginationQuery,
  positiveIntParam,
  readJson,
} from "../src/http/validate.js";
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
    for (const bad of ["+1", " 1", "1 ", "1.5", "0x10"]) {
      expect(() => positiveIntParam(ctxWithParam("idx", bad), "idx")).toThrow(HttpError);
    }
  });

  it("rejects zero (must be >= 1)", () => {
    expect(() => positiveIntParam(ctxWithParam("idx", "0"), "idx")).toThrow(HttpError);
  });

  it("rejects overlong indices that would parse to an imprecise float", () => {
    // "99999999999999999999" parses to 1e20 — isSafeInteger rejects it, isInteger would not.
    expect(() => positiveIntParam(ctxWithParam("idx", "9".repeat(20)), "idx")).toThrow(HttpError);
  });

  it("an empty/missing path param is rejected upstream by pathParam (404), not the digits guard", () => {
    expect(() => positiveIntParam(ctxWithParam("idx", ""), "idx")).toThrow(HttpError);
    expect(() => positiveIntParam(ctxWithParam("idx", undefined), "idx")).toThrow(HttpError);
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

describe("optionalNumber with the agent runtime-parameter rule (integer, > 0 or -1)", () => {
  // The exact rule agent-config PUT applies to maxTurns (and the other runtime numbers):
  // -1 is the documented "unlimited" sentinel; every other non-positive value is rejected.
  const rule = { integer: true, positiveOrMinusOne: true } as const;

  it("accepts positive integers and the -1 unlimited sentinel", () => {
    expect(optionalNumber({ maxTurns: 1 }, "maxTurns", rule)).toBe(1);
    expect(optionalNumber({ maxTurns: 100 }, "maxTurns", rule)).toBe(100);
    expect(optionalNumber({ maxTurns: -1 }, "maxTurns", rule)).toBe(-1);
  });

  it("returns undefined when the key is absent (PUT subsets leave it untouched)", () => {
    expect(optionalNumber({}, "maxTurns", rule)).toBeUndefined();
  });

  it("rejects zero and negatives other than -1", () => {
    for (const bad of [0, -2, -100]) {
      expect(() => optionalNumber({ maxTurns: bad }, "maxTurns", rule)).toThrow(HttpError);
    }
  });

  it("rejects non-integers and non-finite or non-number values", () => {
    for (const bad of [1.5, -1.5, Number.NaN, Number.POSITIVE_INFINITY, "100", true, null]) {
      expect(() => optionalNumber({ maxTurns: bad }, "maxTurns", rule)).toThrow(HttpError);
    }
  });
});

/** Minimal Context stub exposing query parameters. */
function ctxWithQuery(query: Record<string, string>): Context {
  return { req: { query: (n: string) => query[n] } } as unknown as Context;
}

describe("paginationQuery", () => {
  it("defaults to offset 0 / limit 200", () => {
    expect(paginationQuery(ctxWithQuery({}))).toEqual({ offset: 0, limit: 200 });
  });

  it("parses plain integers", () => {
    expect(paginationQuery(ctxWithQuery({ offset: "40", limit: "20" }))).toEqual({
      offset: 40,
      limit: 20,
    });
  });

  it("rejects trailing garbage and exponent notation (parseInt would accept both)", () => {
    // "200abc" parsed to 200 and "1e3" to 1, both landing inside the range check.
    for (const bad of ["200abc", "1e3", "0x10", " 20", "20 ", "1.5", "+20", "-1"]) {
      expect(() => paginationQuery(ctxWithQuery({ limit: bad }))).toThrow(HttpError);
      expect(() => paginationQuery(ctxWithQuery({ offset: bad }))).toThrow(HttpError);
    }
  });

  it("enforces the limit range", () => {
    for (const bad of ["0", "1001"]) {
      expect(() => paginationQuery(ctxWithQuery({ limit: bad }))).toThrow(HttpError);
    }
    expect(paginationQuery(ctxWithQuery({ limit: "1000" })).limit).toBe(1000);
  });
});

describe("optionalPagingQuery", () => {
  it("returns null when neither param is present", () => {
    expect(optionalPagingQuery(ctxWithQuery({}))).toBeNull();
  });

  it("requires limit when only offset is given", () => {
    expect(() => optionalPagingQuery(ctxWithQuery({ offset: "10" }))).toThrow(HttpError);
  });

  it("defaults offset to 0 when only limit is given", () => {
    expect(optionalPagingQuery(ctxWithQuery({ limit: "50" }))).toEqual({ offset: 0, limit: 50 });
  });

  it("rejects trailing garbage and exponent notation (parseInt would accept both)", () => {
    for (const bad of ["50abc", "1e3", "0x10", "1.5", "-1"]) {
      expect(() => optionalPagingQuery(ctxWithQuery({ limit: bad }))).toThrow(HttpError);
      expect(() => optionalPagingQuery(ctxWithQuery({ limit: "50", offset: bad }))).toThrow(
        HttpError,
      );
    }
  });
});

describe("readJson", () => {
  /** Context stub whose body read fails the way the caller asked for. */
  const ctxRejecting = (err: unknown): Context =>
    ({ req: { json: () => Promise.reject(err) } }) as unknown as Context;

  it("reports a body too large to decode as 413, not as a syntax error", async () => {
    // Node raises ERR_STRING_TOO_LONG when the body passes MAX_STRING_LENGTH on its way to one
    // string for JSON.parse. Reported as "must be valid JSON" it would send someone hunting a
    // syntax error in a body that has none — nothing capped the request, the platform did.
    const err = Object.assign(
      new Error("Cannot create a string longer than 0x1fffffe8 characters"),
      {
        code: "ERR_STRING_TOO_LONG",
      },
    );
    await expect(readJson(ctxRejecting(err))).rejects.toMatchObject({
      status: 413,
      code: "payload_too_large",
    });
    // The message names the real ceiling rather than a number this codebase chose.
    await readJson(ctxRejecting(err)).catch((e: HttpError) => {
      expect(e.message).toContain(String(Math.floor(constants.MAX_STRING_LENGTH / (1024 * 1024))));
    });
  });

  it("still reports an ordinary parse failure as 400", async () => {
    await expect(readJson(ctxRejecting(new SyntaxError("Unexpected token")))).rejects.toMatchObject(
      {
        status: 400,
        code: "bad_request",
      },
    );
  });

  it("rejects a body that parses to something other than an object", async () => {
    const ctxWith = (value: unknown): Context =>
      ({ req: { json: () => Promise.resolve(value) } }) as unknown as Context;
    for (const value of [null, [1, 2], "text", 7]) {
      await expect(readJson(ctxWith(value))).rejects.toMatchObject({ status: 400 });
    }
  });
});
