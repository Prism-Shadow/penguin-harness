/**
 * An Action's parameters, checked against the schema its contribution declares: each name
 * (`?` suffix: optional) maps to a type in a subset of arktype's string syntax —
 *
 *   string  number  number.integer  boolean  object  unknown  'literal'  T[]  A | B
 *
 * The subset keeps the declarations arktype-compatible while the plugin bundle carries no
 * schema library; a contribution needing more declares `object` or `unknown` and checks the
 * value in its run. Names the schema does not declare are refused.
 */
import { ActionRefusal } from "./action-model.js";

type Check = (value: unknown) => boolean;

const BASE: Record<string, Check> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  "number.integer": (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  unknown: () => true,
};

/** A type expression, compiled; null for one outside the subset. */
export function compileType(expr: string): Check | null {
  const alternatives = splitTop(expr, "|");
  if (alternatives.length > 1) {
    const checks = alternatives.map(compileType);
    if (checks.some((c) => c === null)) return null;
    return (v) => checks.some((c) => c!(v));
  }
  const t = expr.trim();
  if (t.endsWith("[]")) {
    const item = compileType(t.slice(0, -2));
    if (item === null) return null;
    return (v) => Array.isArray(v) && v.every(item);
  }
  if (t.startsWith("(") && t.endsWith(")")) return compileType(t.slice(1, -1));
  const literal = /^'([^']*)'$/.exec(t);
  if (literal !== null) return (v) => v === literal[1];
  return BASE[t] ?? null;
}

/** Splits on `sep` outside parentheses. */
function splitTop(expr: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === sep && depth === 0) {
      out.push(expr.slice(from, i));
      from = i + 1;
    }
  }
  out.push(expr.slice(from));
  return out;
}

/** A compiled parameter schema: the parameters checked, or a 400 refusal saying which is wrong. */
export type ParamSchema = (params: unknown) => Record<string, unknown>;

/** Compiles a declared schema; throws for a declaration outside the subset (a contribution's fault, reported at load). */
export function compileParams(decl: Record<string, string> | undefined): ParamSchema {
  const fields = Object.entries(decl ?? {}).map(([raw, expr]) => {
    const optional = raw.endsWith("?");
    const name = optional ? raw.slice(0, -1) : raw;
    const check = compileType(expr);
    if (check === null) throw new Error(`parameter ${name}: '${expr}' is not a supported type`);
    return { name, optional, expr, check };
  });
  const known = new Set(fields.map((f) => f.name));
  return (params) => {
    const input = params ?? {};
    if (typeof input !== "object" || Array.isArray(input)) {
      throw new ActionRefusal(400, "bad_params", "params must be an object.");
    }
    const record = input as Record<string, unknown>;
    for (const name of Object.keys(record)) {
      if (!known.has(name)) {
        throw new ActionRefusal(400, "bad_params", `Unknown parameter: ${name}.`);
      }
    }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const value = record[f.name];
      if (value === undefined) {
        if (!f.optional) {
          throw new ActionRefusal(400, "bad_params", `Missing parameter: ${f.name} (${f.expr}).`);
        }
        continue;
      }
      if (!f.check(value)) {
        throw new ActionRefusal(400, "bad_params", `Parameter ${f.name} must be ${f.expr}.`);
      }
      out[f.name] = value;
    }
    return out;
  };
}
