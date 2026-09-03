/**
 * Interfaces as data, at SIGNATURE level.
 *
 * Go's rule is the whole contract: a value satisfies an interface when every method the
 * interface names exists on it with the same signature. Across a hot-push boundary the
 * two sides are separate compilations, so a signature has to be something that can be
 * serialized and compared — this module is that form, and {@link satisfies} is the
 * comparison. The TS `interface` a module author writes is the source; a build step
 * projects it into this shape (see scripts/gen-ifaces.mjs), so the two cannot drift.
 *
 * Data types are arktype definitions, compared with TS assignability rules (./data.ts);
 * the non-data shapes (functions, promises,
 * streams, live objects satisfying another interface, host objects compared by name)
 * are the six other cases below.
 */
import type { Json } from "./json.js";
import type { TypeTable } from "./data.js";
import { acceptsUndefined, dataExtends } from "./data.js";

/** A type, as data. */
export type TypeExpr =
  /** An arktype DEFINITION (string expression or object form): primitives, literals, unions, arrays, tuples, plain objects. */
  | { data: Json }
  /** A live object satisfying another interface — a key into the {@link IfaceTable}. */
  | { iface: string }
  /** A callback. */
  | { fn: Sig }
  | { promise: TypeExpr }
  /** AsyncIterable<T>; an AsyncGenerator's return value rides in `returns`. */
  | { stream: TypeExpr; returns?: TypeExpr }
  | { void: true }
  /** An array whose element is not data (promises, callbacks, live objects). */
  | { array: TypeExpr }
  /** A plain object shape with at least one non-data member, compared member by member. */
  | { object: Record<string, TypeExpr>; optional?: readonly string[] }
  /** `T | null | undefined` around a non-data T. */
  | { maybe: TypeExpr }
  /** A union with more than one non-data member (a provider, or a promise of one). */
  | { oneOf: readonly TypeExpr[] }
  /**
   * A host object compared by NAME only (AbortSignal, Request…): platform types the
   * generator meets in a .d.ts, or a package's own class written as `Opaque<"Name">`.
   */
  | { opaque: string };

/** A method signature: positional parameters and a return type. */
export interface Sig {
  params: readonly TypeExpr[];
  returns: TypeExpr;
}

/**
 * A contribution slot: the data shape one contribution carries (an arktype expression,
 * `id` excluded — the framework adds it) and, when the slot needs an implementation
 * bound by id, the shape of that implementation.
 */
export interface SlotDecl {
  data: Json;
  code?: TypeExpr;
}

/**
 * One interface. `name` is for messages and lookup; identity is the member set. `fields`
 * are the non-method members (Go has none; TS interfaces do, and a published config
 * object is nothing but fields) — compared by presence and type, never by value.
 */
export interface IfaceDecl {
  name: string;
  methods: Record<string, Sig>;
  fields?: Record<string, TypeExpr>;
  slots: Record<string, SlotDecl>;
}

/**
 * Every interface a bundle knows, keyed `<module>#<Export>`, plus the named data types its
 * signatures reference by `$ref` (keyed the same way). Self-contained: a reference into it
 * never leaves the bundle. A bare interface map is accepted everywhere a table is.
 */
export interface IfaceTable {
  ifaces: Record<string, IfaceDecl>;
  types: TypeTable;
}

/** The table as functions take it: the full form, or just the interface map. */
export type TableLike = IfaceTable | Record<string, IfaceDecl>;

export function tableOf(t: TableLike | undefined): IfaceTable {
  if (t === undefined) return { ifaces: {}, types: {} };
  if ("ifaces" in t && "types" in t && typeof t.ifaces === "object" && !("methods" in t.ifaces)) {
    return t as IfaceTable;
  }
  return { ifaces: t as Record<string, IfaceDecl>, types: {} };
}

export interface Mismatch {
  /** The method or field. */
  method: string;
  kind: "missing" | "signature" | "field";
  why: string;
}

/** offered satisfies required ⇔ every required method exists on offered with an assignable signature. */
export function satisfies(
  offered: IfaceDecl,
  required: IfaceDecl,
  table: TableLike = {},
  seen: Set<string> = new Set(),
): Mismatch[] {
  const out: Mismatch[] = [];
  for (const [method, want] of Object.entries(required.methods)) {
    const have = offered.methods[method];
    if (have === undefined) {
      out.push({ method, kind: "missing", why: `'${offered.name}' has no method '${method}'` });
      continue;
    }
    for (const why of assignable(have, want, table, seen)) {
      out.push({ method, kind: "signature", why });
    }
  }
  for (const [field, want] of Object.entries(required.fields ?? {})) {
    const have = offered.fields?.[field];
    if (have === undefined) {
      if ("maybe" in want) continue; // an optional field the offer does not declare at all
      out.push({
        method: field,
        kind: "missing",
        why: `'${offered.name}' has no field '${field}'`,
      });
      continue;
    }
    if (!extendsExpr(have, want, table, seen)) {
      out.push({
        method: field,
        kind: "field",
        why: `field is ${show(have)}, caller expects ${show(want)}`,
      });
    }
  }
  return out;
}

/**
 * Function subtyping: `have` can stand in for `want` when it takes no more parameters
 * than a caller of `want` passes, each of its parameters accepts what the caller passes
 * (contravariant), and what it returns is what the caller expects (covariant).
 */
export function assignable(
  have: Sig,
  want: Sig,
  table: TableLike = {},
  seen: Set<string> = new Set(),
): string[] {
  const why: string[] = [];
  if (have.params.length > want.params.length) {
    // Extra parameters are fine only when optional — encoded as `T | undefined`.
    for (let i = want.params.length; i < have.params.length; i += 1) {
      const p = have.params[i]!;
      if (!("maybe" in p) && (!("data" in p) || !acceptsUndefined(p.data, tableOf(table).types))) {
        why.push(`takes ${have.params.length} params, caller passes ${want.params.length}`);
        break;
      }
    }
  }
  have.params.forEach((p, i) => {
    const passed = want.params[i];
    if (passed === undefined) return;
    if (!extendsExpr(passed, p, table, seen)) {
      why.push(`param ${i}: caller passes ${show(passed)}, impl wants ${show(p)}`);
    }
  });
  if (!extendsExpr(have.returns, want.returns, table, seen)) {
    why.push(`returns ${show(have.returns)}, caller expects ${show(want.returns)}`);
  }
  return why;
}

/** a ⊆ b over the seven shapes; data goes to arktype, interfaces recurse through the table. */
export function extendsExpr(
  a: TypeExpr,
  b: TypeExpr,
  table: TableLike = {},
  seen: Set<string> = new Set(),
): boolean {
  if ("void" in b) return true;
  if ("data" in a && "data" in b) return dataExtends(a.data, b.data, tableOf(table).types);
  if ("opaque" in a && "opaque" in b) return a.opaque === b.opaque;
  if ("iface" in a && "iface" in b) {
    if (a.iface === b.iface) return true;
    const key = `${a.iface}<:${b.iface}`;
    if (seen.has(key)) return true; // Coinductive: assume the pair while checking it.
    const offered = tableOf(table).ifaces[a.iface];
    const required = tableOf(table).ifaces[b.iface];
    if (offered === undefined || required === undefined) return false;
    seen.add(key);
    return satisfies(offered, required, table, seen).length === 0;
  }
  if ("maybe" in b) return extendsExpr("maybe" in a ? a.maybe : a, b.maybe, table, seen);
  if ("maybe" in a) return false;
  if ("oneOf" in a) return a.oneOf.every((m) => extendsExpr(m, b, table, seen));
  if ("oneOf" in b) return b.oneOf.some((m) => extendsExpr(a, m, table, seen));
  if ("array" in a && "array" in b) return extendsExpr(a.array, b.array, table, seen);
  if ("object" in a && "object" in b) {
    for (const [key, want] of Object.entries(b.object)) {
      const have = a.object[key];
      const optionalInB = b.optional?.includes(key) ?? false;
      if (have === undefined) {
        if (optionalInB) continue;
        return false;
      }
      if ((a.optional?.includes(key) ?? false) && !optionalInB) return false;
      if (!extendsExpr(have, want, table, seen)) return false;
    }
    return true;
  }
  if ("fn" in a && "fn" in b) return assignable(a.fn, b.fn, table, seen).length === 0;
  if ("promise" in a && "promise" in b) return extendsExpr(a.promise, b.promise, table, seen);
  if ("stream" in a && "stream" in b) {
    if (!extendsExpr(a.stream, b.stream, table, seen)) return false;
    if (b.returns === undefined) return true;
    return a.returns !== undefined && extendsExpr(a.returns, b.returns, table, seen);
  }
  return false;
}

/** A short rendering for messages. */
export function show(expr: TypeExpr): string {
  if ("data" in expr) return typeof expr.data === "string" ? expr.data : JSON.stringify(expr.data);
  if ("iface" in expr) return expr.iface;
  if ("opaque" in expr) return `opaque<${expr.opaque}>`;
  if ("void" in expr) return "void";
  if ("promise" in expr) return `Promise<${show(expr.promise)}>`;
  if ("array" in expr) return `${show(expr.array)}[]`;
  if ("object" in expr)
    return `{ ${Object.entries(expr.object)
      .map(([k, v]) => `${k}${expr.optional?.includes(k) ? "?" : ""}: ${show(v)}`)
      .join(", ")} }`;
  if ("maybe" in expr) return `${show(expr.maybe)} | null`;
  if ("oneOf" in expr) return expr.oneOf.map(show).join(" | ");
  if ("stream" in expr) return `AsyncIterable<${show(expr.stream)}>`;
  return `(${expr.fn.params.map(show).join(", ")}) => ${show(expr.fn.returns)}`;
}
