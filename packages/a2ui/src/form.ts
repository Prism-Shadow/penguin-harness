/**
 * A form: several questions answered at once, one field per question, each field a kind with its
 * own control and its own answer — text, several lines, a number, a slider, one or several of a
 * few options, one of a long list, on/off, a date, a time, or both. This module is the grammar
 * of a form (parseForm) and the ONE rule for whether an answer is acceptable (fieldProblem): the
 * renderer's fill gate, its error line and its saved drafts ask the same function, and the
 * grammar asks it of a field's `default`, so a form can never start from an answer it would
 * refuse. The rule speaks in symbols ("1–10", "≤ 500", "YYYY-MM-DD"), never in words: the words
 * around it are the renderer's, in the reader's language.
 */
import {
  ID_HINT,
  type Issues,
  type Obj,
  isObj,
  length,
  present,
  readArray,
  readBoolean,
  readEnum,
  readNumber,
  readString,
  unknownFields,
} from "./fields.js";
import { type OptionCount, parseOptions } from "./options.js";
import {
  A2UI_LIMITS,
  type A2uiFieldKind,
  type A2uiForm,
  type A2uiFormAnswer,
  type A2uiFormField,
} from "./types.js";
import { parseA2uiInstant } from "./widgets.js";

const FIELD_KINDS: readonly A2uiFieldKind[] = [
  "text",
  "textarea",
  "number",
  "slider",
  "single",
  "multiple",
  "select",
  "switch",
  "date",
  "time",
  "datetime",
];

/** The answer formats of the date and time kinds: what the native inputs emit. */
export const A2UI_FIELD_FORMATS = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  datetime: /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/,
} as const;

type FormatKind = keyof typeof A2UI_FIELD_FORMATS;

/** The format as a reader sees it: a datetime's `T` reads as a space. */
const FORMAT_RULES: Record<FormatKind, string> = {
  date: "YYYY-MM-DD",
  time: "HH:mm",
  datetime: "YYYY-MM-DD HH:mm",
};

/** The format as the model writes it in a `default`, with an example. */
const FORMAT_SPELLING: Record<FormatKind, string> = {
  date: "YYYY-MM-DD, a day that exists, such as 2026-10-20",
  time: "HH:mm on the 24-hour clock, such as 09:30",
  datetime: "YYYY-MM-DDTHH:mm, a day that exists, such as 2026-10-20T09:30",
};

const OPTION_KINDS: readonly A2uiFieldKind[] = ["single", "multiple", "select"];
const RANGE_KINDS: readonly A2uiFieldKind[] = ["number", "slider"];
const LENGTH_KINDS: readonly A2uiFieldKind[] = ["text", "textarea"];
const PATTERN_KINDS: readonly A2uiFieldKind[] = ["text"];
const PLACEHOLDER_KINDS: readonly A2uiFieldKind[] = ["text", "textarea", "number", "select"];

/** The fields that only some kinds read; elsewhere they are `not_for_kind`. */
const KIND_ONLY: ReadonlyArray<{ keys: readonly string[]; kinds: readonly A2uiFieldKind[] }> = [
  { keys: ["min", "max", "step", "unit"], kinds: RANGE_KINDS },
  { keys: ["maxLength"], kinds: LENGTH_KINDS },
  { keys: ["pattern"], kinds: PATTERN_KINDS },
];

const SELECT_COUNT: OptionCount = {
  ...A2UI_LIMITS.selectOptions,
  warnHint: "Cut the list to the likely ones, or ask with a `text` field.",
};

const FIELD_FIELDS = [
  "id",
  "label",
  "kind",
  "hint",
  "required",
  "options",
  "placeholder",
  "min",
  "max",
  "step",
  "unit",
  "maxLength",
  "pattern",
  "default",
] as const;
const FORM_FIELDS = ["type", "id", "title", "fields", "submitLabel"] as const;

/** `kind "number" or "slider"`, as a message names the kinds a field is for. */
function kindNames(kinds: readonly A2uiFieldKind[]): string {
  const quoted = kinds.map((kind) => `"${kind}"`);
  const last = quoted.pop() ?? "";
  return `kind ${quoted.length > 0 ? `${quoted.join(", ")} or ${last}` : last}`;
}

const lengthCeiling = (kind: A2uiFieldKind): number =>
  kind === "textarea" ? A2UI_LIMITS.textareaMaxLength : A2UI_LIMITS.textMaxLength;

const compiled = new Map<string, RegExp | null>();

/** The field's pattern as a whole-answer test, or null when JavaScript cannot compile it. */
function compilePattern(pattern: string): RegExp | null {
  let re = compiled.get(pattern);
  if (re === undefined) {
    try {
      new RegExp(pattern, "u");
      re = new RegExp(`^(?:${pattern})$`, "u");
    } catch {
      re = null;
    }
    compiled.set(pattern, re);
  }
  return re;
}

function formatHolds(kind: FormatKind, text: string): boolean {
  if (!A2UI_FIELD_FORMATS[kind].test(text)) return false;
  // The regexes bound the hour and the minute; the day must also exist (no 2026-02-30).
  return kind === "time" || parseA2uiInstant(text) !== null;
}

const isFormatKind = (kind: A2uiFieldKind): kind is FormatKind =>
  kind === "date" || kind === "time" || kind === "datetime";

/** "1–10" / "≥ 1" / "≤ 10", or undefined without a bound. */
function rangeText(min: number | undefined, max: number | undefined): string | undefined {
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return undefined;
}

export type A2uiFieldProblemCode =
  "empty" | "not_a_number" | "out_of_range" | "too_long" | "pattern" | "format" | "not_an_option";

export interface A2uiFieldProblem {
  code: A2uiFieldProblemCode;
  /** The rule in symbols: "1–10", "≤ 500", "YYYY-MM-DD". */
  rule?: string;
}

/** The field's rule in symbols every language reads, or undefined (a plain text field). */
export function fieldRule(field: A2uiFormField): string | undefined {
  if (field.kind === "number" || field.kind === "slider") return rangeText(field.min, field.max);
  if (field.kind === "text" || field.kind === "textarea") {
    return field.maxLength !== undefined ? `≤ ${field.maxLength}` : undefined;
  }
  if (isFormatKind(field.kind)) return FORMAT_RULES[field.kind];
  return undefined;
}

const problem = (code: A2uiFieldProblemCode, rule?: string): A2uiFieldProblem =>
  rule !== undefined ? { code, rule } : { code };

const labelsOf = (field: A2uiFormField): string[] =>
  (field.options ?? []).map((option) => option.label);

/**
 * Whether an answer is acceptable for the field: null when it is (or when an optional field has
 * none), else what is wrong. A switch is always answered; any other field is unanswered when the
 * answer is missing, blank or an empty list, which only a required field refuses. An answer of
 * the wrong shape for the kind — a boolean on a text field, a word on a switch — is refused too,
 * so a stale draft cannot bring one back.
 */
export function fieldProblem(
  field: A2uiFormField,
  answer: A2uiFormAnswer | undefined,
): A2uiFieldProblem | null {
  if (field.kind === "switch") {
    return answer === undefined || typeof answer === "boolean" ? null : problem("format");
  }
  const blank =
    answer === undefined ||
    (typeof answer === "string" && answer.trim() === "") ||
    (Array.isArray(answer) && answer.length === 0);
  if (blank) return field.required === true ? problem("empty") : null;
  switch (field.kind) {
    case "single":
    case "select":
      return typeof answer === "string" && labelsOf(field).includes(answer)
        ? null
        : problem("not_an_option");
    case "multiple": {
      const labels = labelsOf(field);
      return Array.isArray(answer) &&
        answer.every((label) => typeof label === "string" && labels.includes(label))
        ? null
        : problem("not_an_option");
    }
    case "number":
    case "slider": {
      const value = typeof answer === "string" ? Number(answer.trim()) : Number.NaN;
      if (!Number.isFinite(value)) return problem("not_a_number", fieldRule(field));
      const below = field.min !== undefined && value < field.min;
      const above = field.max !== undefined && value > field.max;
      return below || above ? problem("out_of_range", fieldRule(field)) : null;
    }
    case "text":
    case "textarea": {
      if (typeof answer !== "string") return problem("format");
      const text = answer.trim();
      const limit = field.maxLength ?? lengthCeiling(field.kind);
      if (length(text) > limit) return problem("too_long", `≤ ${limit}`);
      if (field.kind === "text" && field.pattern !== undefined) {
        const re = compilePattern(field.pattern);
        if (re !== null && !re.test(text)) return problem("pattern");
      }
      return null;
    }
    case "date":
    case "time":
    case "datetime":
      return typeof answer === "string" && formatHolds(field.kind, answer)
        ? null
        : problem("format", FORMAT_RULES[field.kind]);
  }
}

/**
 * The answer a field starts with: its `default` as an answer (a number as its digits, several
 * labels in the options' order), else a slider's `min`, else a switch's false, else nothing.
 */
export function initialAnswer(field: A2uiFormField): A2uiFormAnswer | undefined {
  const value = field.default;
  if (value === undefined) {
    if (field.kind === "slider" && field.min !== undefined) return String(field.min);
    if (field.kind === "switch") return false;
    return undefined;
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return labelsOf(field).filter((label) => value.includes(label));
  return value;
}

/** What a `default` must be for a kind, in the words of the error. */
function expectedDefault(kind: A2uiFieldKind): string {
  switch (kind) {
    case "number":
    case "slider":
      return "a number";
    case "single":
    case "select":
      return "one option label";
    case "multiple":
      return "a list of option labels";
    case "switch":
      return "true or false";
    default:
      return "a string";
  }
}

/** A `default` as the answer it stands for, or undefined when its JSON type is wrong for the kind. */
function defaultAnswer(kind: A2uiFieldKind, raw: unknown): A2uiFormAnswer | undefined {
  switch (kind) {
    case "number":
    case "slider":
      return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined;
    case "multiple":
      return Array.isArray(raw) && raw.every((entry) => typeof entry === "string")
        ? [...(raw as string[])]
        : undefined;
    case "switch":
      return typeof raw === "boolean" ? raw : undefined;
    default:
      return typeof raw === "string" ? raw : undefined;
  }
}

function defaultReason(
  field: A2uiFormField,
  answer: A2uiFormAnswer,
  found: A2uiFieldProblem,
): string {
  switch (found.code) {
    case "empty":
      return "is empty";
    case "not_a_number":
    case "out_of_range":
      return `is ${String(answer)}, outside ${found.rule ?? "the field's range"}`;
    case "too_long":
      return `is ${length(String(answer))} characters; the field takes ${found.rule ?? ""}`;
    case "pattern":
      return "does not match the field's `pattern`";
    case "format":
      return `must be written ${isFormatKind(field.kind) ? FORMAT_SPELLING[field.kind] : expectedDefault(field.kind)}`;
    case "not_an_option":
      return "names a label that is not one of the field's options";
  }
}

/**
 * Checks a field's `default` against the field's own rule and sets it on the field when it holds.
 * Asked as if the field were required, so an empty default (which changes nothing) is refused.
 */
function readDefault(is: Issues, item: Obj, fp: string, field: A2uiFormField): void {
  if (!present(item.default)) return;
  const dp = `${fp}.default`;
  const fix = "; give a starting answer the field accepts, or leave `default` out.";
  const answer = defaultAnswer(field.kind, item.default);
  if (answer === undefined) {
    is.error(
      "default_invalid",
      `\`${dp}\` must be ${expectedDefault(field.kind)} for kind "${field.kind}"${fix}`,
      dp,
    );
    return;
  }
  if (Array.isArray(answer) && new Set(answer).size !== answer.length) {
    is.error("default_invalid", `\`${dp}\` repeats a label${fix}`, dp);
    return;
  }
  const found = fieldProblem({ ...field, required: true }, answer);
  if (found !== null) {
    is.error("default_invalid", `\`${dp}\` ${defaultReason(field, answer, found)}${fix}`, dp);
    return;
  }
  field.default = Array.isArray(answer) ? answer : (item.default as string | number | boolean);
}

/** Options for an option kind (a select's longer list, its one-line rows); none elsewhere. */
function readFieldOptions(
  is: Issues,
  item: Obj,
  fp: string,
  kind: A2uiFieldKind | undefined,
): A2uiFormField["options"] {
  const op = `${fp}.options`;
  if (kind === undefined) return undefined;
  if (!OPTION_KINDS.includes(kind)) {
    if (present(item.options)) {
      is.error(
        "options_forbidden",
        `\`${op}\` is not allowed for kind "${kind}"; use ${kindNames(OPTION_KINDS)} to offer options.`,
        op,
      );
    }
    return undefined;
  }
  if (!present(item.options)) {
    is.error("options_required", `\`${op}\` is required for kind "${kind}".`, op);
    return undefined;
  }
  const options = parseOptions(
    is,
    item,
    "options",
    fp,
    kind === "select" ? SELECT_COUNT : undefined,
  );
  if (kind === "select") {
    options?.forEach((option, i) => {
      if (option.description === undefined) return;
      is.warn(
        "ignored_field",
        `\`${op}[${i}].description\` has no effect on kind "select": its rows are one line; it is ignored.`,
        `${op}[${i}].description`,
      );
      delete option.description;
    });
  }
  return options;
}

/** The checks that depend on the kind: misplaced fields, a slider's range, bounds, the pattern. */
function checkKindRules(
  is: Issues,
  item: Obj,
  fp: string,
  kind: A2uiFieldKind,
  read: { min?: number; max?: number; step?: number; maxLength?: number; pattern?: string },
): void {
  for (const { keys, kinds } of KIND_ONLY) {
    if (kinds.includes(kind)) continue;
    for (const key of keys) {
      if (!present(item[key])) continue;
      is.error(
        "not_for_kind",
        `\`${fp}.${key}\` is only for ${kindNames(kinds)}, not "${kind}"; remove it or change the kind.`,
        `${fp}.${key}`,
      );
    }
  }
  if (present(item.placeholder) && !PLACEHOLDER_KINDS.includes(kind)) {
    is.warn(
      "ignored_field",
      `\`${fp}.placeholder\` has no effect on kind "${kind}"; it is ignored.`,
      `${fp}.placeholder`,
    );
  }
  if (RANGE_KINDS.includes(kind)) {
    if (kind === "slider") {
      for (const key of ["min", "max"] as const) {
        if (present(item[key])) continue;
        is.error(
          "missing_field",
          `\`${fp}.${key}\` is required for kind "slider": a slider moves between a min and a max.`,
          `${fp}.${key}`,
        );
      }
    }
    if (read.min !== undefined && read.max !== undefined && read.min >= read.max) {
      is.error(
        "range_invalid",
        `\`${fp}\`: min ${read.min} must be less than max ${read.max}.`,
        `${fp}.min`,
      );
    }
    if (read.step !== undefined && read.step <= 0) {
      is.error("range_invalid", `\`${fp}.step\` must be greater than 0.`, `${fp}.step`);
    }
  }
  if (LENGTH_KINDS.includes(kind) && read.maxLength !== undefined) {
    const ceiling = lengthCeiling(kind);
    const n = read.maxLength;
    if (!Number.isInteger(n) || n < 1 || n > ceiling) {
      is.error(
        "range_invalid",
        `\`${fp}.maxLength\` is ${n}; for kind "${kind}" it is a whole number from 1 to ${ceiling}.`,
        `${fp}.maxLength`,
      );
    }
  }
  if (PATTERN_KINDS.includes(kind) && read.pattern !== undefined) {
    if (compilePattern(read.pattern) === null) {
      is.error(
        "invalid_format",
        `\`${fp}.pattern\` is not a regular expression JavaScript can compile (u flag, no slashes, no flags); fix it, or drop it and say the format in \`hint\`.`,
        `${fp}.pattern`,
      );
    }
  }
}

/** Reads one form field at `fp` (`fields[2]`). Undefined when its id, label or kind is unusable. */
export function parseFormField(is: Issues, item: unknown, fp: string): A2uiFormField | undefined {
  if (!isObj(item)) {
    is.error("wrong_type", `\`${fp}\` must be an object with \`id\`, \`label\` and \`kind\`.`, fp);
    return undefined;
  }
  const id = readString(is, item, "id", fp, {
    required: true,
    max: 32,
    pattern: A2UI_LIMITS.fieldIdPattern,
    patternHint: "lower-case letters, digits or _, starting with a letter, at most 32",
  });
  const label = readString(is, item, "label", fp, { required: true, max: A2UI_LIMITS.label });
  const kind = readEnum(is, item, "kind", fp, FIELD_KINDS);
  const hint = readString(is, item, "hint", fp, { max: A2UI_LIMITS.fieldHint });
  const required = readBoolean(is, item, "required", fp);
  const options = readFieldOptions(is, item, fp, kind);
  const placeholder = readString(is, item, "placeholder", fp, { max: A2UI_LIMITS.placeholder });
  const min = readNumber(is, item, "min", fp);
  const max = readNumber(is, item, "max", fp);
  const step = readNumber(is, item, "step", fp);
  const unit = readString(is, item, "unit", fp, { max: A2UI_LIMITS.unit });
  const maxLength = readNumber(is, item, "maxLength", fp);
  const pattern = readString(is, item, "pattern", fp, { max: A2UI_LIMITS.pattern });
  unknownFields(is, item, FIELD_FIELDS, fp, "a form field");
  if (kind !== undefined)
    checkKindRules(is, item, fp, kind, { min, max, step, maxLength, pattern });
  if (id === undefined || label === undefined || kind === undefined) return undefined;
  const field: A2uiFormField = { id, label, kind };
  if (hint !== undefined) field.hint = hint;
  if (required !== undefined) field.required = required;
  if (options !== undefined) field.options = options;
  if (placeholder !== undefined && PLACEHOLDER_KINDS.includes(kind))
    field.placeholder = placeholder;
  if (RANGE_KINDS.includes(kind)) {
    if (min !== undefined) field.min = min;
    if (max !== undefined) field.max = max;
    if (step !== undefined) field.step = step;
    if (unit !== undefined) field.unit = unit;
  }
  if (maxLength !== undefined && LENGTH_KINDS.includes(kind)) field.maxLength = maxLength;
  if (pattern !== undefined && PATTERN_KINDS.includes(kind)) field.pattern = pattern;
  readDefault(is, item, fp, field);
  return field;
}

/** Reads a `form` block: 1–6 fields (warn past 4) with unique ids. */
export function parseForm(is: Issues, obj: Obj): A2uiForm | undefined {
  const id = readString(is, obj, "id", "", {
    max: 32,
    pattern: A2UI_LIMITS.idPattern,
    patternHint: ID_HINT,
  });
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.title });
  const raw = readArray(is, obj, "fields", "", {
    ...A2UI_LIMITS.fields,
    warnCode: "form_too_many_fields",
    what: "fields",
  });
  const submitLabel = readString(is, obj, "submitLabel", "", { max: A2UI_LIMITS.submitLabel });
  unknownFields(is, obj, FORM_FIELDS, "", "a form");
  if (raw === undefined) return undefined;
  const fields: A2uiFormField[] = [];
  const ids = new Map<string, number>();
  raw.forEach((item, i) => {
    const field = parseFormField(is, item, `fields[${i}]`);
    if (field === undefined) return;
    const seen = ids.get(field.id);
    if (seen !== undefined) {
      is.error(
        "duplicate_id",
        `\`fields[${i}].id\` repeats field ${seen + 1}'s id "${field.id}"; ids must be unique.`,
        `fields[${i}].id`,
      );
    } else {
      ids.set(field.id, i);
    }
    fields.push(field);
  });
  const spec: A2uiForm = { type: "form", fields };
  if (id !== undefined) spec.id = id;
  if (title !== undefined) spec.title = title;
  if (submitLabel !== undefined) spec.submitLabel = submitLabel;
  return spec;
}
