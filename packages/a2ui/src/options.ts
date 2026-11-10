/**
 * The options a choice and a form's option fields offer: each has a unique label, an optional
 * `value` that is what a pick fills in, a description, and at most one is marked recommended.
 * Shared by the choice block and the form (form.ts), so a label means the same in both.
 */
import {
  type CountRule,
  type Issues,
  type Obj,
  isObj,
  join,
  length,
  readArray,
  readBoolean,
  readString,
  unknownFields,
} from "./fields.js";
import { A2UI_LIMITS, type A2uiOption } from "./types.js";

const OPTION_FIELDS = ["label", "value", "description", "recommended"] as const;

/** How many options a list may hold; default the choice's 2–7, warning past 5. */
export type OptionCount = Pick<CountRule, "min" | "max" | "warn" | "warnHint">;

/** Reads the option list at `obj[key]`. Undefined when it is missing or not an array. */
export function parseOptions(
  is: Issues,
  obj: Obj,
  key: string,
  path: string,
  count: OptionCount = A2UI_LIMITS.options,
): A2uiOption[] | undefined {
  const raw = readArray(is, obj, key, path, {
    ...count,
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
