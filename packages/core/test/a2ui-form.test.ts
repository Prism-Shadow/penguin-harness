/**
 * A form as the grammar reads it (a2ui/form.ts) and the one rule for whether an answer is
 * acceptable, which the renderer's fill gate, its error line and its drafts all ask.
 *
 * - Given every kind across three forms (past four fields a form warns) — hints, a length
 *   ceiling, a pattern, defaults — each round-trips to its spec with no issue.
 * - Given a field on a kind that does not read it (a range on a text, a length on a number, a
 *   pattern on a textarea), it is `not_for_kind` and the spec is withheld.
 * - Option kinds need options and the others refuse them; a select takes up to 30 options and
 *   warns past 12, a single takes up to 7.
 * - A slider needs both ends; min must be below max and a step above 0 (a number too); a length
 *   ceiling stays within its kind's.
 * - A pattern JavaScript cannot compile is refused.
 * - A default that breaks its own field's rule is `default_invalid` and the spec is withheld.
 * - What a kind ignores warns and is dropped from the spec: a placeholder on a switch, a
 *   description on a select's option.
 * - The form's own rules hold: unique ids, the id format, 1–6 fields with a warning past 4.
 * - fieldProblem refuses what each kind's control could not hold, with the rule in symbols, and
 *   never an answer of the wrong shape (a boolean on a text, a word on a switch).
 * - fieldProblem accepts a valid answer and an optional field left empty; a switch is never empty.
 * - initialAnswer starts a field at its default (a number as digits, several labels in the
 *   options' order), else a slider at its min and a switch off, else empty.
 */
import { describe, expect, it } from "vitest";
import {
  fieldProblem,
  fieldRule,
  initialAnswer,
  parseA2ui,
  type A2uiFormAnswer,
  type A2uiFormField,
} from "../src/a2ui/index.js";

const parse = (value: unknown) => parseA2ui(JSON.stringify(value));
const form = (...fields: Record<string, unknown>[]) => ({ type: "form", fields });
const issuesOf = (...fields: Record<string, unknown>[]) =>
  parse(form(...fields)).issues.map((issue) => [issue.level, issue.code, issue.path]);
const options = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `Option ${i + 1}` }));

/** Every kind, across three forms: past four fields a form warns. */
const typed = {
  type: "form",
  title: "New deployment",
  fields: [
    {
      id: "name",
      label: "Service name",
      kind: "text",
      hint: "lower-case, digits and -",
      pattern: "[a-z][a-z0-9-]*",
      maxLength: 40,
      required: true,
    },
    { id: "notes", label: "Notes", kind: "textarea", placeholder: "Anything else", maxLength: 800 },
    {
      id: "pods",
      label: "Pods",
      kind: "number",
      min: 1,
      max: 10,
      step: 1,
      unit: "pods",
      default: 3,
    },
    { id: "temp", label: "Temperature", kind: "slider", min: 0, max: 1, step: 0.1, default: 0.7 },
  ],
  submitLabel: "Deploy",
};
const picked = {
  type: "form",
  fields: [
    {
      id: "tier",
      label: "Tier",
      kind: "single",
      options: [{ label: "Free" }, { label: "Pro", value: "the Pro tier", recommended: true }],
    },
    {
      id: "regions",
      label: "Regions",
      kind: "multiple",
      options: [{ label: "EU" }, { label: "US" }, { label: "Asia" }],
      default: ["US", "EU"],
    },
    {
      id: "lang",
      label: "Language",
      kind: "select",
      placeholder: "Pick one",
      options: [{ label: "Go" }, { label: "Rust" }, { label: "TypeScript" }],
    },
    { id: "cdn", label: "Enable CDN", kind: "switch", default: true },
  ],
};
const dated = {
  type: "form",
  fields: [
    { id: "day", label: "Start day", kind: "date", default: "2026-10-20" },
    { id: "at", label: "Start time", kind: "time" },
    { id: "run", label: "First run", kind: "datetime", default: "2026-10-20T09:30" },
  ],
};

describe("parseForm: a valid form", () => {
  it.each([
    ["text, textarea, number and slider", typed],
    ["single, multiple, select and switch", picked],
    ["date, time and datetime", dated],
  ])("%s, with hints, a ceiling, a pattern and defaults, round-trip with no issue", (_k, input) => {
    const result = parse(input);
    expect(result.issues).toEqual([]);
    expect(result.spec).toEqual(input);
  });
});

describe("parseForm: errors withhold the spec", () => {
  it.each([
    ["a range on a text", { id: "a", label: "A", kind: "text", min: 1 }, "fields[0].min"],
    ["a unit on a date", { id: "a", label: "A", kind: "date", unit: "d" }, "fields[0].unit"],
    ["a step on a switch", { id: "a", label: "A", kind: "switch", step: 1 }, "fields[0].step"],
    [
      "a length on a number",
      { id: "a", label: "A", kind: "number", maxLength: 3 },
      "fields[0].maxLength",
    ],
    [
      "a pattern on a textarea",
      { id: "a", label: "A", kind: "textarea", pattern: "x" },
      "fields[0].pattern",
    ],
  ])("%s is not_for_kind", (_case, input, path) => {
    const result = parse(form(input));
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["not_for_kind", path],
    ]);
    expect(result.spec).toBeUndefined();
  });

  it("the not_for_kind message names the kinds the field is for", () => {
    const [issue] = parse(
      form({ id: "a", label: "A", kind: "single", options: options(2), max: 3 }),
    ).issues;
    expect(issue?.message).toContain('kind "number" or "slider"');
  });

  it("option kinds need options, the others refuse them; a select takes 30, a single 7", () => {
    expect(issuesOf({ id: "a", label: "A", kind: "select" })).toEqual([
      ["error", "options_required", "fields[0].options"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "switch", options: options(2) })).toEqual([
      ["error", "options_forbidden", "fields[0].options"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "select", options: options(31) })).toEqual([
      ["error", "count_out_of_range", "fields[0].options"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "single", options: options(8) })).toEqual([
      ["error", "count_out_of_range", "fields[0].options"],
    ]);
  });

  it("a slider needs both ends; min below max and a step above 0; a length within the kind's ceiling", () => {
    expect(issuesOf({ id: "a", label: "A", kind: "slider", max: 10 })).toEqual([
      ["error", "missing_field", "fields[0].min"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "slider", min: 5, max: 5 })).toEqual([
      ["error", "range_invalid", "fields[0].min"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "number", min: 5, max: 1 })).toEqual([
      ["error", "range_invalid", "fields[0].min"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "number", step: 0 })).toEqual([
      ["error", "range_invalid", "fields[0].step"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "text", maxLength: 501 })).toEqual([
      ["error", "range_invalid", "fields[0].maxLength"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "textarea", maxLength: 0 })).toEqual([
      ["error", "range_invalid", "fields[0].maxLength"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "textarea", maxLength: 2000 })).toEqual([]);
  });

  it("a pattern JavaScript cannot compile is refused", () => {
    expect(issuesOf({ id: "a", label: "A", kind: "text", pattern: "[a-z" })).toEqual([
      ["error", "invalid_format", "fields[0].pattern"],
    ]);
    // Balanced only once wrapped: still not a pattern of its own.
    expect(issuesOf({ id: "a", label: "A", kind: "text", pattern: "a)(b" })).toEqual([
      ["error", "invalid_format", "fields[0].pattern"],
    ]);
  });

  it.each([
    ["a number out of range", { kind: "number", min: 1, max: 10, default: 11 }],
    ["a number written as text", { kind: "number", default: "3" }],
    ["a slider below its min", { kind: "slider", min: 0, max: 1, default: -0.5 }],
    ["a select default that is no option", { kind: "select", options: options(2), default: "x" }],
    [
      "a multiple default with a stranger",
      { kind: "multiple", options: options(2), default: ["x"] },
    ],
    [
      "a multiple default that repeats",
      {
        kind: "multiple",
        options: options(2),
        default: ["Option 1", "Option 1"],
      },
    ],
    ["a switch default as a word", { kind: "switch", default: "yes" }],
    ["a select default as a number", { kind: "select", options: options(2), default: 1 }],
    [
      "a multiple default as one label",
      { kind: "multiple", options: options(2), default: "Option 1" },
    ],
    ["a date default as a number", { kind: "date", default: 20261020 }],
    ["a date that does not exist", { kind: "date", default: "2026-02-30" }],
    ["a time past the day", { kind: "time", default: "24:00" }],
    ["a datetime with a space", { kind: "datetime", default: "2026-10-20 09:30" }],
    ["a text over its ceiling", { kind: "text", maxLength: 3, default: "four" }],
    ["a text off its pattern", { kind: "text", pattern: "\\d+", default: "abc" }],
    ["an empty text", { kind: "text", default: " " }],
  ])("%s is default_invalid", (_case, rest) => {
    const result = parse(form({ id: "a", label: "A", ...rest }));
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["default_invalid", "fields[0].default"],
    ]);
    expect(result.spec).toBeUndefined();
  });

  it("the form's own rules: unique ids, the id format, at least one field, a known kind", () => {
    expect(
      issuesOf({ id: "a", label: "A", kind: "text" }, { id: "a", label: "B", kind: "text" }),
    ).toEqual([["error", "duplicate_id", "fields[1].id"]]);
    expect(issuesOf({ id: "Field-1", label: "A", kind: "text" })).toEqual([
      ["error", "invalid_format", "fields[0].id"],
    ]);
    expect(issuesOf({ id: "a", label: "A", kind: "color" })).toEqual([
      ["error", "invalid_enum", "fields[0].kind"],
    ]);
    expect(parse(form()).issues.map((issue) => issue.code)).toEqual(["count_out_of_range"]);
    expect(parse({ type: "form", fields: ["Name"] }).issues.map((i) => [i.code, i.path])).toEqual([
      ["wrong_type", "fields[0]"],
    ]);
  });
});

describe("parseForm: warnings keep the spec", () => {
  it("a select of 13 options warns and keeps its spec; more than 4 fields warns", () => {
    const select = parse(form({ id: "a", label: "A", kind: "select", options: options(13) }));
    expect(select.issues.map((issue) => [issue.level, issue.code])).toEqual([
      ["warning", "too_many_options"],
    ]);
    expect(select.spec).toBeDefined();
    const fields = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, label: "F", kind: "text" }));
    expect(parse(form(...fields)).issues.map((issue) => issue.code)).toEqual([
      "form_too_many_fields",
    ]);
  });

  it("a placeholder on a switch and a description on a select's option warn and are dropped", () => {
    const result = parse(
      form(
        { id: "on", label: "On", kind: "switch", placeholder: "p" },
        {
          id: "lang",
          label: "Language",
          kind: "select",
          options: [{ label: "Go", description: "fast to build" }, { label: "Rust" }],
        },
      ),
    );
    expect(result.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["ignored_field", "fields[0].placeholder"],
      ["ignored_field", "fields[1].options[0].description"],
    ]);
    expect(result.spec).toEqual(
      form(
        { id: "on", label: "On", kind: "switch" },
        {
          id: "lang",
          label: "Language",
          kind: "select",
          options: [{ label: "Go" }, { label: "Rust" }],
        },
      ),
    );
  });
});

const field = (rest: Partial<A2uiFormField> & Pick<A2uiFormField, "kind">): A2uiFormField => ({
  id: "f",
  label: "F",
  ...rest,
});

describe("fieldProblem", () => {
  const pick = field({ kind: "single", options: [{ label: "A" }, { label: "B" }] });
  it.each<[string, A2uiFormField, A2uiFormAnswer | undefined, object]>([
    [
      "a required text left blank",
      field({ kind: "text", required: true }),
      "  ",
      { code: "empty" },
    ],
    [
      "a required multiple with nothing",
      field({ ...pick, kind: "multiple", required: true }),
      [],
      {
        code: "empty",
      },
    ],
    [
      "a number that is not one",
      field({ kind: "number", min: 1, max: 10 }),
      "3x",
      {
        code: "not_a_number",
        rule: "1–10",
      },
    ],
    [
      "a number past its max",
      field({ kind: "number", max: 10 }),
      "11",
      {
        code: "out_of_range",
        rule: "≤ 10",
      },
    ],
    [
      "a slider below its min",
      field({ kind: "slider", min: 0, max: 1 }),
      "-1",
      {
        code: "out_of_range",
        rule: "0–1",
      },
    ],
    [
      "a text over its ceiling",
      field({ kind: "text", maxLength: 5 }),
      "too long",
      {
        code: "too_long",
        rule: "≤ 5",
      },
    ],
    [
      "a textarea over the kind's ceiling",
      field({ kind: "textarea" }),
      "x".repeat(2001),
      {
        code: "too_long",
        rule: "≤ 2000",
      },
    ],
    [
      "a text off its pattern",
      field({ kind: "text", pattern: "v\\d+" }),
      "v1.2",
      {
        code: "pattern",
      },
    ],
    [
      "a date that does not exist",
      field({ kind: "date" }),
      "2026-02-30",
      {
        code: "format",
        rule: "YYYY-MM-DD",
      },
    ],
    ["a time past the day", field({ kind: "time" }), "24:00", { code: "format", rule: "HH:mm" }],
    [
      "a datetime without its T",
      field({ kind: "datetime" }),
      "2026-10-20 09:30",
      {
        code: "format",
        rule: "YYYY-MM-DD HH:mm",
      },
    ],
    ["a label the single does not offer", pick, "C", { code: "not_an_option" }],
    ["a list on a single", pick, ["A"], { code: "not_an_option" }],
    ["a boolean on a text", field({ kind: "text" }), true, { code: "format" }],
    ["a boolean on a number", field({ kind: "number" }), true, { code: "not_a_number" }],
    [
      "a list on a date",
      field({ kind: "date" }),
      ["2026-10-20"],
      {
        code: "format",
        rule: "YYYY-MM-DD",
      },
    ],
    ["a word on a switch", field({ kind: "switch" }), "yes", { code: "format" }],
  ])("refuses %s", (_case, f, answer, expected) => {
    expect(fieldProblem(f, answer)).toEqual(expected);
  });

  it.each<[string, A2uiFormField, A2uiFormAnswer | undefined]>([
    ["an optional text left empty", field({ kind: "text" }), ""],
    ["an optional select on its empty row", field({ ...pick, kind: "select" }), ""],
    ["a number in range, spaces around", field({ kind: "number", min: 1, max: 10 }), " 10 "],
    ["a text that matches its pattern whole", field({ kind: "text", pattern: "v\\d+" }), "v12"],
    ["several offered labels", field({ ...pick, kind: "multiple" }), ["B", "A"]],
    ["a datetime as the input writes it", field({ kind: "datetime" }), "2026-10-20T09:30"],
    ["a required switch left off", field({ kind: "switch", required: true }), false],
    ["a required switch with no answer yet", field({ kind: "switch", required: true }), undefined],
  ])("accepts %s", (_case, f, answer) => {
    expect(fieldProblem(f, answer)).toBeNull();
  });

  it("fieldRule says each rule in symbols, and nothing for a plain text field", () => {
    expect(fieldRule(field({ kind: "number", min: 1 }))).toBe("≥ 1");
    expect(fieldRule(field({ kind: "number" }))).toBeUndefined();
    expect(fieldRule(field({ kind: "text" }))).toBeUndefined();
    expect(fieldRule(field({ kind: "textarea", maxLength: 200 }))).toBe("≤ 200");
  });
});

describe("initialAnswer", () => {
  it("starts at the default: a number as digits, several labels in the options' order", () => {
    const fields = [typed, picked, dated].flatMap(
      (input) => (parse(input).spec as { fields: A2uiFormField[] }).fields,
    );
    expect(Object.fromEntries(fields.map((f) => [f.id, initialAnswer(f)]))).toEqual({
      name: undefined,
      notes: undefined,
      pods: "3",
      temp: "0.7",
      tier: undefined,
      regions: ["EU", "US"],
      lang: undefined,
      cdn: true,
      day: "2026-10-20",
      at: undefined,
      run: "2026-10-20T09:30",
    });
  });

  it("without a default, a slider starts at its min and a switch off", () => {
    expect(initialAnswer(field({ kind: "slider", min: 20, max: 80 }))).toBe("20");
    expect(initialAnswer(field({ kind: "switch" }))).toBe(false);
    expect(initialAnswer(field({ kind: "number" }))).toBeUndefined();
  });
});
