/**
 * L1 validation of one ```a2ui body (a2ui/catalog.ts): a valid block of each type round-trips
 * to its spec with no issue; every error code fires on the mistake it names and withholds the
 * spec; the warnings fire past the "warn" marks and still return the spec.
 */
import { describe, expect, it } from "vitest";
import { parseA2ui } from "../src/a2ui/index.js";

const parse = (value: unknown) => parseA2ui(JSON.stringify(value));
const codes = (value: unknown) => parse(value).issues.map((issue) => issue.code);
const errorPaths = (value: unknown) =>
  parse(value)
    .issues.filter((issue) => issue.level === "error")
    .map((issue) => [issue.code, issue.path]);

const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}` }));

const choice = {
  type: "choice",
  question: "Which store?",
  options: [
    { label: "A", recommended: true },
    { label: "B", value: "Use B", description: "The other one." },
  ],
  allowOther: true,
};
const form = {
  type: "form",
  title: "Size",
  fields: [
    {
      id: "n",
      label: "Count",
      kind: "number",
      min: 1,
      max: 5,
      step: 1,
      unit: "GB",
      required: true,
    },
    { id: "k", label: "Kind", kind: "single", options: [{ label: "x" }, { label: "y" }] },
    { id: "t", label: "Notes", kind: "text", placeholder: "Anything else" },
  ],
  submitLabel: "Go",
};
const steps = {
  type: "steps",
  title: "Rotate",
  steps: [
    { text: "Stop the service.", code: "penguin stop", lang: "sh" },
    { warning: "Back up first.", text: "Delete the directory.", note: "Takes a minute." },
  ],
};
const callout = { type: "callout", tone: "tip", title: "Faster", text: "Use the cache." };

describe("parseA2ui: valid blocks", () => {
  it.each([
    ["choice", choice],
    ["form", form],
    ["steps", steps],
    ["callout", callout],
  ])("%s round-trips to its spec with no issue", (_type, input) => {
    const result = parse(input);
    expect(result.issues).toEqual([]);
    expect(result.spec).toEqual(input);
    expect(result.type).toBe(input.type);
  });
});

describe("parseA2ui: L1 errors (no spec)", () => {
  it("rejects what is not one JSON object", () => {
    expect(parseA2ui("").issues.map((i) => i.code)).toEqual(["empty_block"]);
    const invalid = parseA2ui("not json");
    expect(invalid.issues.map((i) => i.code)).toEqual(["invalid_json"]);
    expect(invalid.issues[0]!.message).toContain("strict JSON");
    expect(parseA2ui("[1]").issues.map((i) => i.code)).toEqual(["not_object"]);
    expect(parseA2ui('"x"').issues.map((i) => i.code)).toEqual(["not_object"]);
    expect(parseA2ui('{"a":1} {"b":2}').issues.map((i) => i.code)).toEqual(["invalid_json"]);
  });

  it("needs a known type and names the unknown one", () => {
    expect(codes({ question: "q" })).toEqual(["missing_type"]);
    const unknown = parse({ type: "table" });
    expect(unknown.issues.map((i) => i.code)).toEqual(["unknown_type"]);
    expect(unknown.type).toBe("table");
    expect(unknown.spec).toBeUndefined();
  });

  it("choice: required fields, types, limits, formats and counts", () => {
    expect(errorPaths({ type: "choice", options: options(2) })).toEqual([
      ["missing_field", "question"],
    ]);
    expect(errorPaths({ type: "choice", question: "q", options: "A, B" })).toEqual([
      ["wrong_type", "options"],
    ]);
    expect(errorPaths({ type: "choice", question: "  ", options: options(2) })).toEqual([
      ["empty_string", "question"],
    ]);
    expect(errorPaths({ type: "choice", question: "q".repeat(121), options: options(2) })).toEqual([
      ["too_long", "question"],
    ]);
    expect(
      errorPaths({ type: "choice", id: "Bad-Id", question: "q", options: options(2) }),
    ).toEqual([["invalid_format", "id"]]);
    expect(errorPaths({ type: "choice", question: "q", options: options(1) })).toEqual([
      ["count_out_of_range", "options"],
    ]);
    expect(errorPaths({ type: "choice", question: "q", options: options(8) })).toEqual([
      ["count_out_of_range", "options"],
    ]);
    expect(errorPaths({ type: "choice", question: "q", options: [{ label: "A" }, "B"] })).toEqual([
      ["wrong_type", "options[1]"],
    ]);
  });

  it("choice: reference integrity — unique labels, at most one recommended", () => {
    expect(
      errorPaths({ type: "choice", question: "q", options: [{ label: "A" }, { label: "A" }] }),
    ).toEqual([["duplicate_label", "options[1].label"]]);
    expect(
      errorPaths({
        type: "choice",
        question: "q",
        options: [
          { label: "A", recommended: true },
          { label: "B", recommended: true },
        ],
      }),
    ).toEqual([["multiple_recommended", "options"]]);
  });

  it("form: field rules", () => {
    const withField = (field: Record<string, unknown>) => ({ type: "form", fields: [field] });
    expect(errorPaths(withField({ id: "a", label: "A", kind: "single" }))).toEqual([
      ["options_required", "fields[0].options"],
    ]);
    expect(
      errorPaths(withField({ id: "a", label: "A", kind: "text", options: options(2) })),
    ).toEqual([["options_forbidden", "fields[0].options"]]);
    expect(errorPaths(withField({ id: "a", label: "A", kind: "text", min: 1 }))).toEqual([
      ["number_only", "fields[0].min"],
    ]);
    expect(errorPaths(withField({ id: "a", label: "A", kind: "number", min: 5, max: 1 }))).toEqual([
      ["range_invalid", "fields[0].min"],
    ]);
    expect(errorPaths(withField({ id: "a", label: "A", kind: "number", step: 0 }))).toEqual([
      ["range_invalid", "fields[0].step"],
    ]);
    expect(errorPaths(withField({ id: "a", label: "A", kind: "date" }))).toEqual([
      ["invalid_enum", "fields[0].kind"],
    ]);
    expect(errorPaths(withField({ id: "Field-1", label: "A", kind: "text" }))).toEqual([
      ["invalid_format", "fields[0].id"],
    ]);
    expect(
      errorPaths({
        type: "form",
        fields: [
          { id: "a", label: "A", kind: "text" },
          { id: "a", label: "B", kind: "text" },
        ],
      }),
    ).toEqual([["duplicate_id", "fields[1].id"]]);
    expect(errorPaths({ type: "form", fields: [] })).toEqual([["count_out_of_range", "fields"]]);
  });

  it("steps and callout: required text, enum tone, counts", () => {
    expect(errorPaths({ type: "steps", steps: [{ code: "x" }] })).toEqual([
      ["missing_field", "steps[0].text"],
    ]);
    expect(errorPaths({ type: "steps", steps: [] })).toEqual([["count_out_of_range", "steps"]]);
    expect(errorPaths({ type: "callout", tone: "info", text: "t" })).toEqual([
      ["invalid_enum", "tone"],
    ]);
    expect(errorPaths({ type: "callout", tone: "note" })).toEqual([["missing_field", "text"]]);
    expect(errorPaths({ type: "callout", tone: "note", text: "t".repeat(401) })).toEqual([
      ["too_long", "text"],
    ]);
  });
});

describe("parseA2ui: warnings keep the spec", () => {
  it("tolerates a trailing comma once, with a warning", () => {
    const result = parseA2ui('{"type":"callout","tone":"note","text":"t",}');
    expect(result.issues.map((i) => [i.level, i.code])).toEqual([
      ["warning", "json_trailing_comma"],
    ]);
    expect(result.spec).toEqual({ type: "callout", tone: "note", text: "t" });
  });

  it("ignores unknown fields with a warning and drops them from the spec", () => {
    const result = parse({ ...callout, color: "red" });
    expect(result.issues.map((i) => [i.level, i.code, i.path])).toEqual([
      ["warning", "unknown_field", "color"],
    ]);
    expect(result.spec).toEqual(callout);
  });

  it("warns past the warn marks: options > 5, label > 40, fields > 4, steps > 10", () => {
    expect(codes({ type: "choice", question: "q", options: options(6) })).toEqual([
      "too_many_options",
    ]);
    expect(
      codes({
        type: "choice",
        question: "q",
        options: [{ label: "x".repeat(41) }, { label: "B" }],
      }),
    ).toEqual(["option_label_long"]);
    expect(
      codes({
        type: "form",
        fields: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, label: "F", kind: "text" })),
      }),
    ).toEqual(["form_too_many_fields"]);
    expect(
      codes({ type: "steps", steps: Array.from({ length: 11 }, () => ({ text: "Do it." })) }),
    ).toEqual(["steps_too_many"]);
  });

  it("warns about fields that have no effect: a placeholder on an option field, a lang without code", () => {
    expect(
      codes({
        type: "form",
        fields: [{ id: "k", label: "K", kind: "single", options: options(2), placeholder: "p" }],
      }),
    ).toEqual(["ignored_field"]);
    expect(codes({ type: "steps", steps: [{ text: "Do it.", lang: "sh" }] })).toEqual([
      "ignored_field",
    ]);
  });
});
