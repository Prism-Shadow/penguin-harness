/**
 * Schema: the kernel's validation CONTRACT, implemented over arktype.
 *
 * The contract stays structural (strictParse + describe) so independently
 * built platform bundles can hand-roll a conforming object with zero
 * dependencies; in-repo code defines contexts with arktype and wraps them
 * with schema().
 *
 * strictParse is the machine-checkable definition of "data would be
 * discarded": unknown object keys are reported as `dropped`, absent required
 * fields as `missing`, type mismatches as `invalid`. Any non-empty list
 * blocks a silent upgrade and enters the upgrade ladder.
 */
import { type } from "arktype";
import type { Type } from "arktype";
import type { Json } from "./json.js";

export interface ParseFail {
  ok: false;
  /** Paths present in the document but unknown to the schema (would be discarded). */
  dropped: string[];
  /** Paths the schema requires but the document lacks. */
  missing: string[];
  /** Paths whose value does not match the schema's type. */
  invalid: string[];
}

export type ParseResult<C extends Json = Json> = { ok: true; value: C } | ParseFail;

export interface Schema<C extends Json = Json> {
  strictParse(doc: Json | undefined, path?: string): ParseResult<C>;
  /** Serializable self-description (the snapshot equation's "interface is data"). */
  describe(): Json;
}

// One import site for context definitions: `import { schema, type } from ".../kernel"`.
export { type } from "arktype";

/** Wraps an arktype type as a kernel Schema (undeclared object keys rejected). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function schema<C extends Json>(t: Type<C, any>): Schema<C> {
  // Object types get strict key checking; non-object types (opaque "unknown"
  // state) have no keys to reject.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let strict: Type<C, any> = t;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    strict = (t as any).onUndeclaredKey("reject") as Type<C, any>;
  } catch {
    strict = t;
  }
  return {
    strictParse(doc, path = "$") {
      if (doc === undefined) return { ok: false, dropped: [], missing: [path], invalid: [] };
      const out = strict(doc);
      if (!(out instanceof type.errors)) return { ok: true, value: out as C };
      const fail: ParseFail = { ok: false, dropped: [], missing: [], invalid: [] };
      for (const e of out) {
        const p = e.path.length > 0 ? `${path}.${e.path.join(".")}` : path;
        // arktype error → ladder judgment: a required key absent is `missing`;
        // an undeclared key (onUndeclaredKey("reject") expects it "removed")
        // is `dropped`; everything else is a type mismatch.
        if (e.code === "required") fail.missing.push(p);
        else if (e.expected === "removed") fail.dropped.push(p);
        else fail.invalid.push(`${p}: expected ${e.expected}`);
      }
      return fail;
    },
    describe: () => t.expression,
  };
}
