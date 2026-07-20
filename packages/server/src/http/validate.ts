/**
 * Hand-rolled request body validation helpers (fields follow TypeScript types;
 * this adds a runtime safety net).
 *
 * No validation library: each helper checks one basic shape, throwing a 400 HttpError on failure.
 */
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

/** Parse a positive-integer path parameter (e.g. Trace file index). */
export function positiveIntParam(c: Context, name: string): number {
  const v = Number.parseInt(pathParam(c, name), 10);
  if (!Number.isInteger(v) || v < 1) throw badRequest(`${name} must be a positive integer.`);
  return v;
}

/** Parse Trace pagination query params: offset >= 0 (default 0), limit 1-1000 (default 200). */
export function paginationQuery(c: Context): { offset: number; limit: number } {
  const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Number.parseInt(c.req.query("limit") ?? "200", 10);
  if (!Number.isInteger(offset) || offset < 0)
    throw badRequest("offset must be a non-negative integer.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw badRequest("limit must be an integer between 1 and 1000.");
  }
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

/** Validate a yyyy-mm-dd query parameter (defaults to undefined). */
export function optionalDateParam(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${label} must be in YYYY-MM-DD format.`);
  }
  return value;
}
