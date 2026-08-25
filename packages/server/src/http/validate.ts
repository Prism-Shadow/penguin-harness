/**
 * Hand-rolled request body validation helpers (fields follow TypeScript types;
 * this adds a runtime safety net).
 *
 * No validation library: each helper checks one basic shape, throwing a 400 HttpError on failure.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { isValidId } from "@prismshadow/penguin-core";
import { HttpError } from "./errors.js";

export function badRequest(message: string): HttpError {
  return new HttpError(400, "bad_request", message);
}

/**
 * Get a path parameter (under sub-route mounting, hono infers string | undefined; the
 * route guarantees presence at runtime — treat a defensive missing value as 404).
 */
export function pathParam(c: Context, name: string): string {
  const v = c.req.param(name);
  if (v === undefined || v === "") {
    throw new HttpError(404, "not_found", "Missing path parameter.");
  }
  return v;
}

/**
 * Get a path parameter and validate the id (alphanumeric, underscore, and hyphen
 * only, to prevent path traversal). Hono decodes URL-encoded `%2F` into a single path
 * parameter; an id containing `/` or `..` passed straight into path construction could
 * escape the resource directory (cross-Project privilege escalation). So validate right
 * after reading the value — any invalid id is rejected with 404 (not leaking resource
 * existence), before any service-layer or path-construction code runs.
 */
export function requireValidId(c: Context, name: string): string {
  const v = pathParam(c, name);
  if (!isValidId(v)) {
    throw new HttpError(404, "not_found", "Resource does not exist or you do not have access.");
  }
  return v;
}

/**
 * Parse a decimal non-negative integer, or null when the text is not exactly one.
 *
 * Digits only: Number.parseInt accepts trailing garbage ("12abc" -> 12, "1e3" -> 1), so a
 * caller that only range-checks the result silently honours a request it never validated.
 * isSafeInteger (not isInteger) additionally rejects overlong runs like
 * "99999999999999999999", which parse to an imprecise float (1e20).
 */
function parseNonNegativeInt(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const v = Number.parseInt(raw, 10);
  return Number.isSafeInteger(v) ? v : null;
}

/** Parse a positive-integer path parameter (e.g. Trace file index). */
export function positiveIntParam(c: Context, name: string): number {
  const v = parseNonNegativeInt(pathParam(c, name));
  if (v === null || v < 1) throw badRequest(`${name} must be a positive integer.`);
  return v;
}

/** Parse an already-defaulted offset query param (>= 0). */
function offsetQuery(raw: string): number {
  const v = parseNonNegativeInt(raw);
  if (v === null) throw badRequest("offset must be a non-negative integer.");
  return v;
}

/** Parse an already-defaulted limit query param (1-1000). */
function limitQuery(raw: string): number {
  const v = parseNonNegativeInt(raw);
  if (v === null || v < 1 || v > 1000) {
    throw badRequest("limit must be an integer between 1 and 1000.");
  }
  return v;
}

/** Parse Trace pagination query params: offset >= 0 (default 0), limit 1-1000 (default 200). */
export function paginationQuery(c: Context): { offset: number; limit: number } {
  return {
    offset: offsetQuery(c.req.query("offset") ?? "0"),
    limit: limitQuery(c.req.query("limit") ?? "200"),
  };
}

/**
 * Parse OPTIONAL list paging query params: both absent = null (caller returns the full
 * list — the pre-paging behavior stays intact for existing callers). When paging, `limit`
 * is required (1-1000) and `offset` optional (>= 0, default 0) — an offset alone would
 * silently return the full list shifted, which no caller ever means.
 */
export function optionalPagingQuery(c: Context): { offset: number; limit: number } | null {
  const rawLimit = c.req.query("limit");
  const rawOffset = c.req.query("offset");
  if (rawLimit === undefined && rawOffset === undefined) return null;
  if (rawLimit === undefined) throw badRequest("offset requires limit.");
  const limit = limitQuery(rawLimit);
  const offset = offsetQuery(rawOffset ?? "0");
  return { offset, limit };
}

/** Read the JSON request body (parse failure / non-object -> 400). */
export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export interface StringRule {
  minLen?: number;
  maxLen?: number;
  pattern?: RegExp;
  /** Display name for the field in error messages (defaults to key). */
  label?: string;
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  rule: StringRule = {},
): string {
  const v = obj[key];
  const label = rule.label ?? key;
  if (typeof v !== "string") throw badRequest(`${label} must be a string.`);
  if (rule.minLen !== undefined && v.length < rule.minLen) {
    throw badRequest(`${label} must be at least ${rule.minLen} characters.`);
  }
  if (rule.maxLen !== undefined && v.length > rule.maxLen) {
    throw badRequest(`${label} must be at most ${rule.maxLen} characters.`);
  }
  if (rule.pattern !== undefined && !rule.pattern.test(v)) {
    throw badRequest(`${label} has an invalid format.`);
  }
  return v;
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
  rule: StringRule = {},
): string | undefined {
  if (obj[key] === undefined) return undefined;
  return requireString(obj, key, rule);
}

/**
 * Optional array-of-strings body field: absent (or null) yields undefined, anything that is not
 * an array of non-empty strings is a 400. The per-item message carries the index, so a caller
 * sending one bad entry in a long list is told which one.
 */
export function optionalStringArray(
  obj: Record<string, unknown>,
  key: string,
  label = key,
): string[] | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw badRequest(`${label} must be an array of strings.`);
  return v.map((item, i) => {
    if (typeof item !== "string" || item.length === 0) {
      throw badRequest(`${label}[${i}] must be a non-empty string.`);
    }
    return item;
  });
}

/**
 * Admits a client-supplied filesystem path for a Project-scoped route and returns its realpath:
 * absolute, existing, and a directory. Shared by every route that takes a path from the client —
 * the `dirs` browser, Skill discovery, and Agent creation's `skillsDirectory` — so the three
 * cannot drift on what a valid path is or on which error code says so. The caller must already
 * have checked Project access.
 */
export async function requireProjectDir(raw: string | undefined): Promise<string> {
  const target = raw?.trim();
  if (!target || !path.isAbsolute(target)) {
    throw new HttpError(400, "dir_not_absolute", "Directory must be an absolute path.");
  }
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch {
    throw new HttpError(
      404,
      "dir_not_found",
      `Directory does not exist or is inaccessible: ${target}.`,
    );
  }
  // stat can still fail if the directory goes away between realpath and here; that is the same
  // "not there" the caller is being told about, not a server fault.
  const isDir = await fs.stat(real).then(
    (s) => s.isDirectory(),
    () => {
      throw new HttpError(
        404,
        "dir_not_found",
        `Directory does not exist or is inaccessible: ${target}.`,
      );
    },
  );
  if (!isDir) throw new HttpError(400, "not_a_dir", "Not a directory.");
  return real;
}

export function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  label = key,
): T {
  const v = obj[key];
  if (typeof v !== "string" || !(values as readonly string[]).includes(v)) {
    throw badRequest(`${label} must be one of ${values.join(" / ")}.`);
  }
  return v as T;
}

export function optionalEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  label = key,
): T | undefined {
  if (obj[key] === undefined) return undefined;
  return requireEnum(obj, key, values, label);
}

export interface NumberRule {
  /** Require positive or -1 (Agent runtime parameter convention: >0 active, -1 disabled). */
  positiveOrMinusOne?: boolean;
  /** Require non-negative. */
  nonNegative?: boolean;
  /** Require integer. */
  integer?: boolean;
  label?: string;
}

export function optionalNumber(
  obj: Record<string, unknown>,
  key: string,
  rule: NumberRule = {},
): number | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  const label = rule.label ?? key;
  if (typeof v !== "number" || !Number.isFinite(v)) throw badRequest(`${label} must be a number.`);
  if (rule.integer && !Number.isInteger(v)) throw badRequest(`${label} must be an integer.`);
  if (rule.positiveOrMinusOne && !(v > 0 || v === -1)) {
    throw badRequest(`${label} must be greater than 0 or equal to -1.`);
  }
  if (rule.nonNegative && v < 0) throw badRequest(`${label} must not be negative.`);
  return v;
}

export function optionalBoolean(
  obj: Record<string, unknown>,
  key: string,
  label = key,
): boolean | undefined {
  const v = obj[key];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw badRequest(`${label} must be a boolean.`);
  return v;
}

/** Validate a yyyy-mm-dd query parameter (defaults to undefined). */
export function optionalDateParam(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  // The shape check alone accepts impossible dates (2026-13-40, 2026-02-30); verify it's a real
  // calendar day by round-tripping through UTC (which never rolls over into an adjacent month).
  if (m) {
    const [, y, mo, d] = m;
    const dt = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isNaN(dt.getTime()) &&
      dt.getUTCFullYear() === Number(y) &&
      dt.getUTCMonth() + 1 === Number(mo) &&
      dt.getUTCDate() === Number(d)
    ) {
      return value;
    }
  }
  throw badRequest(`${label} must be a valid date in YYYY-MM-DD format.`);
}
