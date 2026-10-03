/**
 * L1 validation of one ```a2ui body: strict JSON, one object, a known `type`, then the catalog's
 * field rules (A2UI_LIMITS). Over a limit, a missing or mistyped field, a broken reference (a
 * duplicate label, two recommended options, options on a text field) is an error: the block
 * would render wrong or not at all, so the model must fix it before sending. Past a `warn` mark
 * or an unknown field is a warning: the block renders, but a reader has more to take in.
 *
 * The one leniency is a trailing comma — the most common LLM JSON slip — accepted with a warning
 * so the renderer shows the block while the checker still teaches strict JSON. Every message
 * ends with what to do, because the checker prints it to the model verbatim.
 */
import {
  A2UI_LIMITS,
  type A2uiCallout,
  type A2uiChoice,
  type A2uiForm,
  type A2uiFormField,
  type A2uiIssue,
  type A2uiOption,
  type A2uiSpec,
  type A2uiStep,
  type A2uiSteps,
} from "./types.js";

export interface A2uiParseResult {
  /** Set only when there is no error-level issue. */
  spec?: A2uiSpec;
  issues: A2uiIssue[];
  /** The `type` the block named, valid or not, so a report can label an invalid block. */
  type?: string;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const join = (path: string, key: string): string => (path === "" ? key : `${path}.${key}`);
const length = (s: string): number => [...s].length;

class Issues {
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

interface StringRule {
  required?: boolean;
  max: number;
  pattern?: RegExp;
  patternHint?: string;
}

function readString(
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

function readBoolean(is: Issues, obj: Obj, key: string, path: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    is.error("wrong_type", `\`${join(path, key)}\` must be true or false.`, join(path, key));
    return undefined;
  }
  return value;
}

function readNumber(is: Issues, obj: Obj, key: string, path: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    is.error("wrong_type", `\`${join(path, key)}\` must be a number.`, join(path, key));
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  values: readonly T[],
): T | undefined {
  const value = obj[key];
  const p = join(path, key);
  if (value === undefined || value === null) {
    is.error("missing_field", `\`${p}\` is required: one of ${values.join(", ")}.`, p);
    return undefined;
  }
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    is.error("invalid_enum", `\`${p}\` must be one of ${values.join(", ")}.`, p);
    return undefined;
  }
  return value as T;
}

interface CountRule {
  min: number;
  max: number;
  warn?: number;
  warnCode?: string;
  what: string;
}

function readArray(
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
      `\`${p}\` has ${value.length} ${rule.what}; more than ${rule.warn} is hard to take in at a glance.`,
      p,
    );
  }
  return value;
}

function unknownFields(is: Issues, obj: Obj, known: readonly string[], path: string, what: string) {
  for (const key of Object.keys(obj)) {
    if (known.includes(key)) continue;
    const p = join(path, key);
    is.warn("unknown_field", `\`${p}\` is not a field of ${what}; it is ignored.`, p);
  }
}

const OPTION_FIELDS = ["label", "value", "description", "recommended"] as const;

function parseOptions(is: Issues, obj: Obj, key: string, path: string): A2uiOption[] | undefined {
  const raw = readArray(is, obj, key, path, {
    ...A2UI_LIMITS.options,
    warnCode: "too_many_options",
    what: "options",
  });
  if (raw === undefined) return undefined;
  const p = join(path, key);
  const options: A2uiOption[] = [];
  const labels = new Map<string, number>();
  let recommended = 0;
  raw.forEach((item, i) => {
    const ip = `${p}[${i}]`;
    if (!isObj(item)) {
      is.error("wrong_type", `\`${ip}\` must be an object with a \`label\`.`, ip);
      return;
    }
    const label = readString(is, item, "label", ip, { required: true, max: A2UI_LIMITS.label });
    const value = readString(is, item, "value", ip, { max: A2UI_LIMITS.value });
    const description = readString(is, item, "description", ip, {
      max: A2UI_LIMITS.description,
    });
    const rec = readBoolean(is, item, "recommended", ip);
    unknownFields(is, item, OPTION_FIELDS, ip, "an option");
    if (rec === true) recommended++;
    if (label === undefined) return;
    if (length(label) > A2UI_LIMITS.labelWarn) {
      is.warn(
        "option_label_long",
        `\`${ip}.label\` is longer than ${A2UI_LIMITS.labelWarn} characters; keep labels short and put the detail in \`description\`.`,
        `${ip}.label`,
      );
    }
    const seen = labels.get(label);
    if (seen !== undefined) {
      is.error(
        "duplicate_label",
        `\`${ip}.label\` repeats option ${seen + 1}'s label "${label}"; labels must be unique.`,
        `${ip}.label`,
      );
    } else {
      labels.set(label, i);
    }
    const option: A2uiOption = { label };
    if (value !== undefined) option.value = value;
    if (description !== undefined) option.description = description;
    if (rec !== undefined) option.recommended = rec;
    options.push(option);
  });
  if (recommended > 1) {
    is.error(
      "multiple_recommended",
      `\`${p}\` marks ${recommended} options as recommended; at most one may be.`,
      p,
    );
  }
  return options;
}

const ID_HINT = "lower-case letters, digits, _ or -, starting with a letter, at most 32";

const CHOICE_FIELDS = ["type", "id", "question", "options", "multiple", "allowOther"] as const;

function parseChoice(is: Issues, obj: Obj): A2uiChoice | undefined {
  const id = readString(is, obj, "id", "", {
    max: 32,
    pattern: A2UI_LIMITS.idPattern,
    patternHint: ID_HINT,
  });
  const question = readString(is, obj, "question", "", {
    required: true,
    max: A2UI_LIMITS.question,
  });
  const options = parseOptions(is, obj, "options", "");
  const multiple = readBoolean(is, obj, "multiple", "");
  const allowOther = readBoolean(is, obj, "allowOther", "");
  unknownFields(is, obj, CHOICE_FIELDS, "", "a choice");
  if (question === undefined || options === undefined) return undefined;
  const spec: A2uiChoice = { type: "choice", question, options };
  if (id !== undefined) spec.id = id;
  if (multiple !== undefined) spec.multiple = multiple;
  if (allowOther !== undefined) spec.allowOther = allowOther;
  return spec;
}

const FIELD_KINDS = ["single", "multiple", "text", "number"] as const;
const FIELD_FIELDS = [
  "id",
  "label",
  "kind",
  "options",
  "placeholder",
  "min",
  "max",
  "step",
  "unit",
  "required",
] as const;
const NUMBER_ONLY = ["min", "max", "step", "unit"] as const;
const FORM_FIELDS = ["type", "id", "title", "fields", "submitLabel"] as const;

function parseFormField(is: Issues, item: unknown, fp: string): A2uiFormField | undefined {
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
  const hasOptions = item.options !== undefined && item.options !== null;
  let options: A2uiOption[] | undefined;
  if (kind === "single" || kind === "multiple") {
    if (!hasOptions) {
      is.error(
        "options_required",
        `\`${fp}.options\` is required for kind "${kind}".`,
        `${fp}.options`,
      );
    } else {
      options = parseOptions(is, item, "options", fp);
    }
  } else if (kind !== undefined && hasOptions) {
    is.error(
      "options_forbidden",
      `\`${fp}.options\` is not allowed for kind "${kind}"; use kind "single" or "multiple" to offer options.`,
      `${fp}.options`,
    );
  }
  const placeholder = readString(is, item, "placeholder", fp, { max: A2UI_LIMITS.placeholder });
  if (placeholder !== undefined && (kind === "single" || kind === "multiple")) {
    is.warn(
      "ignored_field",
      `\`${fp}.placeholder\` has no effect on kind "${kind}"; it is ignored.`,
      `${fp}.placeholder`,
    );
  }
  const min = readNumber(is, item, "min", fp);
  const max = readNumber(is, item, "max", fp);
  const step = readNumber(is, item, "step", fp);
  const unit = readString(is, item, "unit", fp, { max: A2UI_LIMITS.unit });
  if (kind !== undefined && kind !== "number") {
    for (const key of NUMBER_ONLY) {
      if (item[key] !== undefined && item[key] !== null) {
        is.error(
          "number_only",
          `\`${fp}.${key}\` is only valid for kind "number"; remove it or change the kind.`,
          `${fp}.${key}`,
        );
      }
    }
  }
  if (min !== undefined && max !== undefined && min > max) {
    is.error("range_invalid", `\`${fp}\`: min ${min} is greater than max ${max}.`, `${fp}.min`);
  }
  if (step !== undefined && step <= 0) {
    is.error("range_invalid", `\`${fp}.step\` must be greater than 0.`, `${fp}.step`);
  }
  const required = readBoolean(is, item, "required", fp);
  unknownFields(is, item, FIELD_FIELDS, fp, "a form field");
  if (id === undefined || label === undefined || kind === undefined) return undefined;
  const field: A2uiFormField = { id, label, kind };
  if (options !== undefined) field.options = options;
  if (placeholder !== undefined) field.placeholder = placeholder;
  if (min !== undefined) field.min = min;
  if (max !== undefined) field.max = max;
  if (step !== undefined) field.step = step;
  if (unit !== undefined) field.unit = unit;
  if (required !== undefined) field.required = required;
  return field;
}

function parseForm(is: Issues, obj: Obj): A2uiForm | undefined {
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

const STEP_FIELDS = ["text", "warning", "caution", "note", "code", "lang"] as const;
const STEPS_FIELDS = ["type", "title", "steps"] as const;

function parseSteps(is: Issues, obj: Obj): A2uiSteps | undefined {
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.title });
  const raw = readArray(is, obj, "steps", "", {
    ...A2UI_LIMITS.steps,
    warnCode: "steps_too_many",
    what: "steps",
  });
  unknownFields(is, obj, STEPS_FIELDS, "", "a steps block");
  if (raw === undefined) return undefined;
  const steps: A2uiStep[] = [];
  raw.forEach((item, i) => {
    const sp = `steps[${i}]`;
    if (!isObj(item)) {
      is.error("wrong_type", `\`${sp}\` must be an object with a \`text\`.`, sp);
      return;
    }
    const text = readString(is, item, "text", sp, { required: true, max: A2UI_LIMITS.stepText });
    const warning = readString(is, item, "warning", sp, { max: A2UI_LIMITS.stepText });
    const caution = readString(is, item, "caution", sp, { max: A2UI_LIMITS.stepText });
    const note = readString(is, item, "note", sp, { max: A2UI_LIMITS.stepText });
    const code = readString(is, item, "code", sp, { max: A2UI_LIMITS.stepCode });
    const lang = readString(is, item, "lang", sp, { max: A2UI_LIMITS.lang });
    if (lang !== undefined && code === undefined) {
      is.warn("ignored_field", `\`${sp}.lang\` without \`code\` has no effect.`, `${sp}.lang`);
    }
    unknownFields(is, item, STEP_FIELDS, sp, "a step");
    if (text === undefined) return;
    const step: A2uiStep = { text };
    if (warning !== undefined) step.warning = warning;
    if (caution !== undefined) step.caution = caution;
    if (note !== undefined) step.note = note;
    if (code !== undefined) step.code = code;
    if (lang !== undefined) step.lang = lang;
    steps.push(step);
  });
  const spec: A2uiSteps = { type: "steps", steps };
  if (title !== undefined) spec.title = title;
  return spec;
}

const TONES = ["note", "tip", "caution", "warning"] as const;
const CALLOUT_FIELDS = ["type", "tone", "title", "text"] as const;

function parseCallout(is: Issues, obj: Obj): A2uiCallout | undefined {
  const tone = readEnum(is, obj, "tone", "", TONES);
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.title });
  const text = readString(is, obj, "text", "", { required: true, max: A2UI_LIMITS.calloutText });
  unknownFields(is, obj, CALLOUT_FIELDS, "", "a callout");
  if (tone === undefined || text === undefined) return undefined;
  const spec: A2uiCallout = { type: "callout", tone, text };
  if (title !== undefined) spec.title = title;
  return spec;
}

/** Removes commas that sit before a closing bracket, outside strings. Reports whether any did. */
function stripTrailingCommas(text: string): { text: string; changed: boolean } {
  let out = "";
  let inString = false;
  let changed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? "")) j++;
      const next = text[j];
      if (next === "}" || next === "]") {
        changed = true;
        continue;
      }
    }
    out += ch;
  }
  return { text: out, changed };
}

/** The 1-based line of a character offset, when the JSON error names one. */
function errorLine(err: unknown, text: string): number | undefined {
  const message = err instanceof Error ? err.message : String(err);
  const m = /position (\d+)/.exec(message);
  if (!m) return undefined;
  const pos = Math.min(Number(m[1]), text.length);
  return text.slice(0, pos).split("\n").length;
}

/** Parses and validates one ```a2ui body. `spec` is set only when there is no error. */
export function parseA2ui(source: string): A2uiParseResult {
  const is = new Issues();
  const text = source.replace(/\r\n?/g, "\n");
  if (text.trim() === "") {
    is.error("empty_block", "The a2ui fence is empty; it must hold one JSON object.");
    return { issues: is.list };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    const lenient = stripTrailingCommas(text);
    let recovered = false;
    if (lenient.changed) {
      try {
        data = JSON.parse(lenient.text);
        recovered = true;
      } catch {
        // Reported below from the strict parse's error.
      }
    }
    if (!recovered) {
      const detail = err instanceof Error ? err.message : String(err);
      is.error(
        "invalid_json",
        `The block is not valid JSON (${detail}). Write one strict JSON object: double quotes, no comments, no trailing commas.`,
        undefined,
        errorLine(err, text),
      );
      return { issues: is.list };
    }
    is.warn(
      "json_trailing_comma",
      "A trailing comma was tolerated this time; strict JSON has none.",
    );
  }
  if (!isObj(data)) {
    is.error(
      "not_object",
      "The block must be ONE JSON object — not an array, a string, or several objects.",
    );
    return { issues: is.list };
  }
  const type = data.type;
  if (typeof type !== "string") {
    is.error("missing_type", "`type` is required: one of choice, form, steps, callout.", "type");
    return { issues: is.list };
  }
  let spec: A2uiSpec | undefined;
  switch (type) {
    case "choice":
      spec = parseChoice(is, data);
      break;
    case "form":
      spec = parseForm(is, data);
      break;
    case "steps":
      spec = parseSteps(is, data);
      break;
    case "callout":
      spec = parseCallout(is, data);
      break;
    default:
      is.error(
        "unknown_type",
        `Unknown type "${type}"; the catalog has choice, form, steps and callout.`,
        "type",
      );
      return { issues: is.list, type };
  }
  const result: A2uiParseResult = { issues: is.list, type };
  if (spec !== undefined && !is.hasError) result.spec = spec;
  return result;
}
