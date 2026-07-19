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
    throw new HttpError(404, "not_found", "路径参数缺失。");
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
    throw new HttpError(404, "not_found", "资源不存在或无权访问。");
  }
  return v;
}

/** Parse a positive-integer path parameter (e.g. Trace file index). */
export function positiveIntParam(c: Context, name: string): number {
  const v = Number.parseInt(pathParam(c, name), 10);
  if (!Number.isInteger(v) || v < 1) throw badRequest(`${name} 必须是正整数。`);
  return v;
}

/** Parse Trace pagination query params: offset >= 0 (default 0), limit 1-1000 (default 200). */
export function paginationQuery(c: Context): { offset: number; limit: number } {
  const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
  const limit = Number.parseInt(c.req.query("limit") ?? "200", 10);
  if (!Number.isInteger(offset) || offset < 0) throw badRequest("offset 必须是非负整数。");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw badRequest("limit 必须是 1~1000 的整数。");
  }
  return { offset, limit };
}

/** Read the JSON request body (parse failure / non-object -> 400). */
export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("请求体必须是合法 JSON。");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("请求体必须是 JSON 对象。");
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
  if (typeof v !== "string") throw badRequest(`${label} 必须是字符串。`);
  if (rule.minLen !== undefined && v.length < rule.minLen) {
    throw badRequest(`${label} 长度至少 ${rule.minLen} 个字符。`);
  }
  if (rule.maxLen !== undefined && v.length > rule.maxLen) {
    throw badRequest(`${label} 长度不能超过 ${rule.maxLen} 个字符。`);
  }
  if (rule.pattern !== undefined && !rule.pattern.test(v)) {
    throw badRequest(`${label} 格式不合法。`);
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
    throw badRequest(`${label} 必须是 ${values.join(" / ")} 之一。`);
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
  if (typeof v !== "number" || !Number.isFinite(v)) throw badRequest(`${label} 必须是数字。`);
  if (rule.integer && !Number.isInteger(v)) throw badRequest(`${label} 必须是整数。`);
  if (rule.positiveOrMinusOne && !(v > 0 || v === -1)) {
    throw badRequest(`${label} 必须大于 0 或为 -1。`);
  }
  if (rule.nonNegative && v < 0) throw badRequest(`${label} 不能为负数。`);
  return v;
}

/** Validate a yyyy-mm-dd query parameter (defaults to undefined). */
export function optionalDateParam(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest(`${label} 必须是 YYYY-MM-DD 格式。`);
  }
  return value;
}
