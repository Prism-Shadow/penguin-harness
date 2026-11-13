/**
 * The field readers every block parser shares: each reads one key of a block's JSON object,
 * reports what is wrong with it as an issue whose message ends with what to do, and returns the
 * value only when it has the type the catalog says. A reader never throws and never stops the
 * parse, so one pass reports every mistake in a block at once.
 */
import type { A2uiIssue } from "./types.js";
import { parseA2uiInstant } from "./widgets.js";

export type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
export const length = (s: string): number => [...s].length;
export const present = (value: unknown): boolean => value !== undefined && value !== null;

export class Issues {
  readonly list: A2uiIssue[] = [];

  error(code: string, message: string, path?: string, line?: number): void {
    this.push("error", code, message, path, line);
  }

  warn(code: string, message: string, path?: string): void {
    this.push("warning", code, message, path);
  }

  get hasError(): boolean {
    return this.list.some((issue) => issue.level === "error");
  }

  private push(
    level: A2uiIssue["level"],
    code: string,
    message: string,
    path?: string,
    line?: number,
  ): void {
    const issue: A2uiIssue = { level, code, message };
    if (path !== undefined) issue.path = path;
    if (line !== undefined) issue.line = line;
    this.list.push(issue);
  }
}

export interface StringRule {
  required?: boolean;
  max: number;
  pattern?: RegExp;
  patternHint?: string;
}

export function readString(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: StringRule,
): string | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    if (rule.required) is.error("missing_field", `\`${p}\` is required.`, p);
    return undefined;
  }
  if (typeof value !== "string") {
    is.error("wrong_type", `\`${p}\` must be a string.`, p);
    return undefined;
  }
  if (value.trim() === "") {
    if (rule.required) {
      is.error("empty_string", `\`${p}\` is empty; write the text or drop the block.`, p);
    }
    return undefined;
  }
  const n = length(value);
  if (n > rule.max) {
    is.error(
      "too_long",
      `\`${p}\` is ${n} characters; the limit is ${rule.max}. Shorten it or move the detail into the prose.`,
      p,
    );
  }
  if (rule.pattern && !rule.pattern.test(value)) {
    is.error(
      "invalid_format",
      `\`${p}\` must match ${rule.pattern.source}${rule.patternHint ? ` (${rule.patternHint})` : ""}.`,
      p,
    );
  }
  return value;
}

export function readBoolean(is: Issues, obj: Obj, key: string, path: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    is.error("wrong_type", `\`${join(path, key)}\` must be true or false.`, join(path, key));
    return undefined;
  }
  return value;
}

export function readNumber(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  required = false,
): number | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    if (required) is.error("missing_field", `\`${p}\` is required: a number.`, p);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    is.error("wrong_type", `\`${p}\` must be a number.`, p);
    return undefined;
  }
  return value;
}

export function readEnum<T extends string>(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  values: readonly T[],
  required = true,
): T | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    if (required) {
      is.error("missing_field", `\`${p}\` is required: one of ${values.join(", ")}.`, p);
    }
    return undefined;
  }
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    is.error("invalid_enum", `\`${p}\` must be one of ${values.join(", ")}.`, p);
    return undefined;
  }
  return value as T;
}

export interface CountRule {
  min: number;
  max: number;
  warn?: number;
  warnCode?: string;
  /** Appended to the warning: what to do about it. */
  warnHint?: string;
  what: string;
}

export function readArray(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: CountRule,
): unknown[] | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    is.error("missing_field", `\`${p}\` is required.`, p);
    return undefined;
  }
  if (!Array.isArray(value)) {
    is.error("wrong_type", `\`${p}\` must be an array.`, p);
    return undefined;
  }
  if (value.length < rule.min || value.length > rule.max) {
    is.error(
      "count_out_of_range",
      `\`${p}\` has ${value.length} ${rule.what}; allowed ${rule.min}–${rule.max}. ${value.length < rule.min ? "Add more, or answer in prose." : "Cut to the realistic ones, or split into two turns."}`,
      p,
    );
  } else if (rule.warn !== undefined && rule.warnCode && value.length > rule.warn) {
    is.warn(
      rule.warnCode,
      `\`${p}\` has ${value.length} ${rule.what}; more than ${rule.warn} is hard to take in at a glance.${rule.warnHint ? ` ${rule.warnHint}` : ""}`,
      p,
    );
  }
  return value;
}

export interface NumberListRule extends CountRule {
  /** A null entry is a missing reading (a gap) instead of an error. */
  nulls?: boolean;
  /** Inclusive bounds every entry must lie within; `rangeHint` says them in words. */
  atLeast?: number;
  atMost?: number;
  /** "a percentage is 0–100", "a count is at least 0". */
  rangeHint?: string;
}

/**
 * An array of finite numbers, each inside the rule's bounds; with `nulls`, a null is a gap. A
 * wrong entry is reported and kept as NaN so the list keeps its length for the length checks
 * that follow; the error withholds the spec, so the NaN never reaches a renderer.
 */
export function readNumbers(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: NumberListRule & { nulls: true },
): (number | null)[] | undefined;
export function readNumbers(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: NumberListRule & { nulls?: false },
): number[] | undefined;
export function readNumbers(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  rule: NumberListRule,
): (number | null)[] | undefined {
  const raw = readArray(is, obj, key, path, rule);
  if (raw === undefined) return undefined;
  const p = join(path, key);
  return raw.map((entry, i) => {
    const ep = `${p}[${i}]`;
    if (entry === null && rule.nulls) return null;
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      is.error(
        "wrong_type",
        rule.nulls
          ? `\`${ep}\` must be a number, or null for a missing reading.`
          : `\`${ep}\` must be a number; leave out a reading you do not have.`,
        ep,
      );
      return Number.NaN;
    }
    const below = rule.atLeast !== undefined && entry < rule.atLeast;
    const above = rule.atMost !== undefined && entry > rule.atMost;
    if (below || above) {
      is.error(
        "range_invalid",
        `\`${ep}\` is ${entry}; ${rule.rangeHint ?? "out of range"}. Fix the value.`,
        ep,
      );
    }
    return entry;
  });
}

export function unknownFields(
  is: Issues,
  obj: Obj,
  known: readonly string[],
  path: string,
  what: string,
) {
  for (const key of Object.keys(obj)) {
    if (known.includes(key)) continue;
    const p = join(path, key);
    is.warn("unknown_field", `\`${p}\` is not a field of ${what}; it is ignored.`, p);
  }
}

export const ID_HINT = "lower-case letters, digits, _ or -, starting with a letter, at most 32";

/** A string field holding an instant: ISO 8601, or a date for local midnight. */
export function readInstant(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  required = false,
): string | undefined {
  const value = readString(is, obj, key, path, { required, max: Number.POSITIVE_INFINITY });
  if (value === undefined || parseA2uiInstant(value) !== null) return value;
  const p = join(path, key);
  is.error(
    "invalid_datetime",
    `\`${p}\` is "${value}", not a date-time; write ISO 8601 such as 2026-10-04T14:05+08:00 (Z or an offset; without one it is the viewer's local time), or 2026-10-04 for local midnight.`,
    p,
  );
  return undefined;
}

export function readPercent(is: Issues, obj: Obj, key: string, path: string): number | undefined {
  const value = readNumber(is, obj, key, path);
  if (value === undefined || (value >= 0 && value <= 100)) return value;
  const p = join(path, key);
  is.error("range_invalid", `\`${p}\` is ${value}; a percentage is 0–100. Fix the value.`, p);
  return undefined;
}

/** Reports `high` below `low`; the two are read together on the block and on every day. */
export function checkHighLow(
  is: Issues,
  high: number | undefined,
  low: number | undefined,
  path: string,
): void {
  if (high === undefined || low === undefined || high >= low) return;
  const p = join(path, "high");
  is.error(
    "range_invalid",
    `\`${p}\` ${high} is below \`${join(path, "low")}\` ${low}; swap them or fix the values.`,
    p,
  );
}
