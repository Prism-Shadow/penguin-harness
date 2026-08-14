/**
 * Hand-written minimal schema layer (see TODO(schema) in json.ts).
 *
 * The one non-negotiable behavior is strictParse: it is the machine-checkable
 * definition of "data is not discarded". Unknown object keys are reported as
 * `dropped` (data the new schema would silently lose), absent required fields
 * as `missing`, type mismatches as `invalid`. Any non-empty list blocks a
 * silent upgrade and enters the upgrade ladder.
 */
import type { Json, JsonObject } from "./json.js";
import { isJsonObject } from "./json.js";

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

/** Object-field wrapper marking a field as optional (absence is not `missing`). */
export interface OptionalField<C extends Json = Json> {
  optional: true;
  schema: Schema<C>;
}

type Field = Schema<Json> | OptionalField;

const okResult = <C extends Json>(value: C): ParseResult<C> => ({ ok: true, value });

function failResult(partial: Partial<Omit<ParseFail, "ok">>): ParseFail {
  return {
    ok: false,
    dropped: partial.dropped ?? [],
    missing: partial.missing ?? [],
    invalid: partial.invalid ?? [],
  };
}

function isOptional(field: Field): field is OptionalField {
  return "optional" in field && field.optional === true;
}

function primitive<C extends Json>(kind: string, guard: (v: Json) => v is C): Schema<C> {
  return {
    strictParse(doc, path = "$") {
      if (doc === undefined) return failResult({ missing: [path] });
      if (!guard(doc)) return failResult({ invalid: [`${path}: expected ${kind}`] });
      return okResult(doc);
    },
    describe: () => ({ kind }),
  };
}

function mergeFails(fails: ParseFail[]): ParseFail {
  return {
    ok: false,
    dropped: fails.flatMap((f) => f.dropped),
    missing: fails.flatMap((f) => f.missing),
    invalid: fails.flatMap((f) => f.invalid),
  };
}

export const s = {
  string: (): Schema<string> => primitive("string", (v): v is string => typeof v === "string"),
  number: (): Schema<number> => primitive("number", (v): v is number => typeof v === "number"),
  boolean: (): Schema<boolean> => primitive("boolean", (v): v is boolean => typeof v === "boolean"),

  /** Opaque JSON: accepts anything present. Used for state the node treats as a black box. */
  json: (): Schema<Json> => ({
    strictParse: (doc, path = "$") =>
      doc === undefined ? failResult({ missing: [path] }) : okResult(doc),
    describe: () => ({ kind: "json" }),
  }),

  optional: <C extends Json>(schema: Schema<C>): OptionalField<C> => ({ optional: true, schema }),

  array: <C extends Json>(item: Schema<C>): Schema<C[]> => ({
    strictParse(doc, path = "$") {
      if (doc === undefined) return failResult({ missing: [path] });
      if (!Array.isArray(doc)) return failResult({ invalid: [`${path}: expected array`] });
      const fails: ParseFail[] = [];
      const values: C[] = [];
      doc.forEach((entry, i) => {
        const r = item.strictParse(entry, `${path}[${i}]`);
        if (r.ok) values.push(r.value);
        else fails.push(r);
      });
      return fails.length > 0 ? mergeFails(fails) : okResult(values);
    },
    describe: () => ({ kind: "array", item: item.describe() }),
  }),

  /** Arbitrary string keys (static shape, dynamic cardinality): keys are never `dropped`. */
  record: <C extends Json>(value: Schema<C>): Schema<{ [key: string]: C }> => ({
    strictParse(doc, path = "$") {
      if (doc === undefined) return failResult({ missing: [path] });
      if (!isJsonObject(doc)) return failResult({ invalid: [`${path}: expected object`] });
      const fails: ParseFail[] = [];
      const out: { [key: string]: C } = {};
      for (const [key, entry] of Object.entries(doc)) {
        const r = value.strictParse(entry, `${path}.${key}`);
        if (r.ok) out[key] = r.value;
        else fails.push(r);
      }
      return fails.length > 0 ? mergeFails(fails) : okResult(out);
    },
    describe: () => ({ kind: "record", value: value.describe() }),
  }),

  /**
   * Fixed field set. Unknown keys are `dropped` — this is where "data would be
   * silently discarded" becomes machine-checkable.
   *
   * TODO(schema): C is caller-asserted rather than inferred from `fields`;
   * arktype removes this trust boundary.
   */
  object: <C extends JsonObject>(fields: Record<string, Field>): Schema<C> => ({
    strictParse(doc, path = "$") {
      if (doc === undefined) return failResult({ missing: [path] });
      if (!isJsonObject(doc)) return failResult({ invalid: [`${path}: expected object`] });
      const fails: ParseFail[] = [];
      const out: JsonObject = {};
      for (const [name, field] of Object.entries(fields)) {
        const fieldPath = `${path}.${name}`;
        const present = doc[name];
        if (present === undefined) {
          if (!isOptional(field)) fails.push(failResult({ missing: [fieldPath] }));
          continue;
        }
        const schema = isOptional(field) ? field.schema : field;
        const r = schema.strictParse(present, fieldPath);
        if (r.ok) out[name] = r.value;
        else fails.push(r);
      }
      for (const key of Object.keys(doc)) {
        if (!(key in fields)) fails.push(failResult({ dropped: [`${path}.${key}`] }));
      }
      return fails.length > 0 ? mergeFails(fails) : okResult(out as C);
    },
    describe: () => ({
      kind: "object",
      fields: Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [
          name,
          isOptional(field)
            ? { optional: true, schema: field.schema.describe() }
            : field.describe(),
        ]),
      ),
    }),
  }),
};
