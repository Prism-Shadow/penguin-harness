/**
 * Assignability over data definitions — the `{ data }` half of a signature.
 *
 * A definition is an arktype DEFINITION: a string expression (`"string"`, `"'a'|'b'"`,
 * `"number[]"`), an object (`{ a: "string", "b?": "number", "[string]": "unknown" }`) or
 * a tuple expression (`[def, "[]"]`, `[def, "|", def]`, `[def, "&", def]`, or a plain
 * tuple of definitions). The generator emits exactly these forms.
 *
 * Why not arktype's own `extends`: it is intersection identity (`A & B ≡ A`), which
 * rejects `{ a: string }` ⊆ `{ a: string; meta?: X }` — but that is the assignability
 * every TS caller relies on, and the one Go's rule means. So the structural forms are
 * compared here with TS rules (extra keys allowed, optional keys may be absent, arrays
 * and tuples elementwise, unions member-wise), and only LEAF string expressions —
 * primitives, literals, literal unions — go to arktype.
 */
import { type } from "arktype";
import type { Json } from "./json.js";
import { isJsonObject } from "./json.js";

type Def = Json;

/** Named data definitions a definition may reference as `{ "$ref": "<name>" }`. */
export type TypeTable = Record<string, Json>;

const refOf = (d: Def): string | null =>
  isJsonObject(d) && typeof d.$ref === "string" && Object.keys(d).length === 1 ? d.$ref : null;

const isOp = (d: Def, op: string): d is [Def, string, Def] =>
  Array.isArray(d) && d.length === 3 && d[1] === op;
const isArrayForm = (d: Def): d is [Def, "[]"] =>
  Array.isArray(d) && d.length === 2 && d[1] === "[]";
const isTuple = (d: Def): d is Def[] =>
  Array.isArray(d) && !isArrayForm(d) && !isOp(d, "|") && !isOp(d, "&");

/** Top-level `|` split of a string expression that has no grouping; null when it has. */
function splitUnion(s: string): string[] | null {
  if (/[()[\]{}<>]/.test(s.replace(/'[^']*'/g, ""))) return null;
  const parts = s.split("|").map((p) => p.trim());
  return parts.length > 1 ? parts : null;
}

/** `T[]` on a string expression, when unambiguous. */
function arrayElem(s: string): string | null {
  const m = /^(.*)\[\]$/.exec(s.trim());
  if (m === null) return null;
  const inner = m[1]!;
  return splitUnion(inner) === null ? inner : null;
}

function leafExtends(a: string, b: string): boolean {
  try {
    return type.raw(a).extends(type.raw(b));
  } catch {
    return a === b;
  }
}

/**
 * a ⊆ b. `types` resolves `$ref`s; a pair of references met again while it is being
 * decided is assumed to hold (coinduction — the rule that makes recursive types finite).
 */
export function dataExtends(
  a: Def,
  b: Def,
  types: TypeTable = {},
  seen: Set<string> = new Set(),
): boolean {
  if (typeof b === "string" && b.trim() === "unknown") return true;
  const ra = refOf(a);
  const rb = refOf(b);
  if (ra !== null || rb !== null) {
    if (ra !== null && rb !== null) {
      if (ra === rb) return true;
      const key = `${ra}<:${rb}`;
      if (seen.has(key)) return true;
      seen = new Set(seen).add(key);
    }
    const da = ra === null ? a : types[ra];
    const db = rb === null ? b : types[rb];
    if (da === undefined || db === undefined) return false; // a dangling reference fits nothing
    return dataExtends(da, db, types, seen);
  }
  if (typeof b === "string" && b.trim() === "unknown") return true;
  if (typeof a === "string" && a.trim() === "never") return true;
  // Unions: every member of a must fit b; a fits a union b when it fits any member.
  if (isOp(a, "|")) return dataExtends(a[0], b, types, seen) && dataExtends(a[2], b, types, seen);
  if (typeof a === "string") {
    const members = splitUnion(a);
    if (members !== null && typeof b !== "string")
      return members.every((m) => dataExtends(m, b, types, seen));
  }
  if (isOp(b, "|")) return dataExtends(a, b[0], types, seen) || dataExtends(a, b[2], types, seen);
  if (typeof b === "string" && typeof a !== "string") {
    const members = splitUnion(b);
    if (members !== null) return members.some((m) => dataExtends(a, m, types, seen));
  }
  // Intersections. On the right, both halves must hold. On the left, the halves only
  // mean something together — `{ a } & { b }` is `{ a; b }` — so object members are
  // merged into one shape first; only when a half is not an object does either half
  // alone have to fit.
  if (isOp(b, "&")) return dataExtends(a, b[0], types, seen) && dataExtends(a, b[2], types, seen);
  if (isOp(a, "&")) {
    const merged = mergeIntersection(a, types);
    if (merged !== null) return dataExtends(merged, b, types, seen);
    return dataExtends(a[0], b, types, seen) || dataExtends(a[2], b, types, seen);
  }
  // Arrays, in either spelling.
  const aElem = isArrayForm(a) ? a[0] : typeof a === "string" ? arrayElem(a) : null;
  const bElem = isArrayForm(b) ? b[0] : typeof b === "string" ? arrayElem(b) : null;
  if (aElem !== null && bElem !== null) return dataExtends(aElem, bElem, types, seen);
  if (isTuple(a) && bElem !== null) return a.every((e) => dataExtends(e, bElem, types, seen));
  if (isTuple(a) && isTuple(b))
    return a.length === b.length && a.every((e, i) => dataExtends(e, b[i]!, types, seen));
  // Objects.
  if (isJsonObject(a) && isJsonObject(b)) return objectExtends(a, b, types, seen);
  // Leaves (and anything mixed the forms above did not settle).
  if (typeof a === "string" && typeof b === "string") return leafExtends(a, b);
  return false;
}

function objectExtends(
  a: { [k: string]: Def },
  b: { [k: string]: Def },
  types: TypeTable,
  seen: Set<string>,
): boolean {
  const aIndex = a["[string]"];
  const bIndex = b["[string]"];
  const aKeys = new Map<string, { def: Def; optional: boolean }>();
  for (const [k, def] of Object.entries(a)) {
    if (k === "[string]") continue;
    const optional = k.endsWith("?");
    aKeys.set(optional ? k.slice(0, -1) : k, { def: def!, optional });
  }
  for (const [k, def] of Object.entries(b)) {
    if (k === "[string]") continue;
    const optional = k.endsWith("?");
    const name = optional ? k.slice(0, -1) : k;
    const have = aKeys.get(name);
    if (have === undefined) {
      if (optional) continue;
      // A required key can still be met by a's index signature.
      if (aIndex !== undefined && dataExtends(aIndex, def!, types, seen)) continue;
      return false;
    }
    if (have.optional && !optional) return false;
    if (!dataExtends(have.def, def!, types, seen)) return false;
  }
  if (bIndex !== undefined) {
    for (const [name, have] of aKeys) {
      if (name in b || `${name}?` in b) continue;
      if (!dataExtends(have.def, bIndex, types, seen)) return false;
    }
    if (aIndex !== undefined && !dataExtends(aIndex, bIndex, types, seen)) return false;
  }
  return true;
}

/**
 * `A & B & …` as one object definition, when every member (references followed) is a
 * plain object; null otherwise. A key both sides carry keeps both constraints, as an
 * intersection of its own; a key required by any member is required.
 */
function mergeIntersection(d: Def, types: TypeTable): { [k: string]: Def } | null {
  const members: Array<{ [k: string]: Def }> = [];
  const collect = (x: Def): boolean => {
    if (isOp(x, "&")) return collect(x[0]) && collect(x[2]);
    const ref = refOf(x);
    const resolved = ref === null ? x : types[ref];
    if (resolved === undefined || !isJsonObject(resolved) || refOf(resolved) !== null) return false;
    members.push(resolved);
    return true;
  };
  if (!collect(d)) return null;
  const out: { [k: string]: Def } = {};
  const seenKeys = new Map<string, { def: Def; optional: boolean }>();
  for (const m of members) {
    for (const [k, def] of Object.entries(m)) {
      if (k === "[string]") {
        out["[string]"] = "[string]" in out ? [out["[string]"]!, "&", def!] : def!;
        continue;
      }
      const optional = k.endsWith("?");
      const name = optional ? k.slice(0, -1) : k;
      const have = seenKeys.get(name);
      seenKeys.set(
        name,
        have === undefined
          ? { def: def!, optional }
          : { def: [have.def, "&", def!], optional: have.optional && optional },
      );
    }
  }
  for (const [name, { def, optional }] of seenKeys) out[optional ? `${name}?` : name] = def;
  return out;
}

/** Whether `undefined` fits the definition — an optional parameter's test. */
export function acceptsUndefined(def: Def, types: TypeTable = {}): boolean {
  return dataExtends("undefined", def, types);
}
