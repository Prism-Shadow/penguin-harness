/**
 * The inverse of the fill texts (fallback.ts): the answers a choice or a form was filled with,
 * read back out of the message the reader sent. A reply whose question has been answered shows
 * these in its read-only blocks, so a reload brings back what the reader answered rather than
 * the model's defaults; the message itself is the only record, and nothing else is stored.
 *
 * The message is the reader's own: they may have edited the filled text, added lines around it,
 * or switched the interface language since. So the reading is lenient where the fill text is
 * fixed — either language's colon, list separator and Yes / No, lines in any order, lines that
 * name no field ignored — and strict where an answer is: each one recovered is held to its
 * field's rule (`fieldProblem`), and one the field would not accept is dropped, never shown.
 */
import { answerColon, listSeparator, switchAnswer } from "./fallback.js";
import { splitLines } from "./fences.js";
import { fieldProblem } from "./form.js";
import type {
  A2uiChoice,
  A2uiForm,
  A2uiFormAnswer,
  A2uiFormAnswers,
  A2uiFormField,
  A2uiLang,
  A2uiOption,
} from "./types.js";

const LANGS: readonly A2uiLang[] = ["en", "zh"];

/** The colon after a label, as either language writes it, without the space: ":" and "：". */
const COLONS = LANGS.map((lang) => answerColon(lang).trim());

/** The list separator, as either language writes it, without the space: "," and "、". */
const SEPARATORS = LANGS.map((lang) => listSeparator(lang).trim());

/** One way an option may be written in a message, and the label it stands for. */
interface Spelling {
  text: string;
  label: string;
}

/** How each option may be written: the value its pick fills, then its label where that differs. */
function spellingsOf(options: readonly A2uiOption[]): Spelling[] {
  const filled = options.map((option) => ({
    text: (option.value ?? option.label).trim(),
    label: option.label,
  }));
  const labels = options
    .filter((option) => option.value !== undefined && option.value.trim() !== option.label)
    .map((option) => ({ text: option.label, label: option.label }));
  return [...filled, ...labels].filter((spelling) => spelling.text !== "");
}

/** The label of the option a whole answer names, by its filled value first; undefined for none. */
function optionNamed(options: readonly A2uiOption[], text: string): string | undefined {
  return spellingsOf(options).find((spelling) => spelling.text === text)?.label;
}

/** Where the text goes on past a list separator at `at` (spaces around it allowed), or -1. */
function pastSeparator(text: string, at: number): number {
  let i = at;
  while (i < text.length && /\s/u.test(text[i]!)) i += 1;
  const separator = SEPARATORS.find((each) => text.startsWith(each, i));
  if (separator === undefined) return -1;
  i += separator.length;
  while (i < text.length && /\s/u.test(text[i]!)) i += 1;
  return i;
}

/**
 * The labels a list names, in the options' order: the whole text is options, each as it fills
 * or by its label, joined by either language's separator. The options are matched as whole
 * spellings, the longest first, so a label that contains a separator ("Logs, metrics") reads as
 * one option. Undefined when the text is not wholly such a list.
 */
function listedLabels(options: readonly A2uiOption[], text: string): string[] | undefined {
  const spellings = spellingsOf(options).sort((a, b) => b.text.length - a.text.length);
  // The labels the text lists from each position on, or null where it lists none.
  const memo = new Map<number, string[] | null>();
  const from = (at: number): string[] | null => {
    const known = memo.get(at);
    if (known !== undefined) return known;
    let found: string[] | null = null;
    for (const spelling of spellings) {
      if (!text.startsWith(spelling.text, at)) continue;
      const end = at + spelling.text.length;
      if (end === text.length) {
        found = [spelling.label];
        break;
      }
      const next = pastSeparator(text, end);
      const rest = next < 0 ? null : from(next);
      if (rest !== null) {
        found = [spelling.label, ...rest];
        break;
      }
    }
    memo.set(at, found);
    return found;
  };
  const picked = from(0);
  if (picked === null) return undefined;
  return options.map((option) => option.label).filter((label) => picked.includes(label));
}

/**
 * The options a choice's pick filled, as their labels in the options' order, or null when the
 * text is not a pick of this choice — an "Other…" answer the reader wrote, or another message.
 * A single choice is one option's value (or its label); a multiple choice may list several,
 * joined by either language's separator.
 */
export function parseChoicePick(spec: A2uiChoice, text: string): string[] | null {
  const answer = text.trim();
  if (answer === "") return null;
  const whole = optionNamed(spec.options, answer);
  if (whole !== undefined) return [whole];
  if (spec.multiple !== true) return null;
  return listedLabels(spec.options, answer) ?? null;
}

/** The field a line opens with its label and a colon, and the rest of the line; undefined for none. */
function headOf(
  fields: readonly A2uiFormField[],
  line: string,
): { field: A2uiFormField; rest: string } | undefined {
  // An indented line is a line of a longer answer, never a label.
  if (/^\s/u.test(line)) return undefined;
  for (const field of fields) {
    if (!line.startsWith(field.label)) continue;
    const after = line.slice(field.label.length).trimStart();
    const colon = COLONS.find((each) => after.startsWith(each));
    if (colon !== undefined) return { field, rest: after.slice(colon.length).trim() };
  }
  return undefined;
}

/** A longer answer's lines with the fill's two-space indent taken off, trailing blank lines dropped. */
function unindent(lines: readonly string[]): string {
  const kept = lines.map((line) => (line.startsWith("  ") ? line.slice(2) : line.trimStart()));
  return kept.join("\n").trim();
}

/**
 * Each field's answer as the message writes it, by field id: the rest of the line its label opens,
 * or, under a label with nothing after the colon, the indented lines that follow. A field's first
 * line counts; lines that open with no field's label are ignored. Labels are tried longest first,
 * so "Name" never claims the line of a "Name of owner".
 */
function answerTexts(spec: A2uiForm, text: string): Map<string, string> {
  const fields = [...spec.fields].sort((a, b) => b.label.length - a.label.length);
  const lines = splitLines(text);
  const out = new Map<string, string>();
  for (let i = 0; i < lines.length; i += 1) {
    const head = headOf(fields, lines[i]!);
    if (head === undefined) continue;
    let answer = head.rest;
    if (answer === "") {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(\s|$)/u.test(lines[i + 1]!)) {
        i += 1;
        block.push(lines[i]!);
      }
      answer = unindent(block);
    }
    if (!out.has(head.field.id)) out.set(head.field.id, answer);
  }
  return out;
}

/** A switch's answer from either language's Yes or No, any case; undefined for anything else. */
function switchState(text: string): boolean | undefined {
  const word = text.toLowerCase();
  for (const lang of LANGS) {
    if (word === switchAnswer(true, lang).toLowerCase()) return true;
    if (word === switchAnswer(false, lang).toLowerCase()) return false;
  }
  return undefined;
}

/** A figure with the unit the fill text put after it taken off: "3 pods" → "3", "70%" → "70". */
function withoutUnit(text: string, unit: string | undefined): string {
  if (unit === undefined || unit === "" || !text.endsWith(unit)) return text;
  return text.slice(0, -unit.length).trim();
}

/** One field's answer from the text written for it, undoing what the fill did; undefined for none. */
function answerFrom(field: A2uiFormField, text: string): A2uiFormAnswer | undefined {
  switch (field.kind) {
    case "switch":
      return switchState(text);
    case "single":
    case "select":
      return optionNamed(field.options ?? [], text);
    case "multiple":
      return listedLabels(field.options ?? [], text);
    case "number":
    case "slider":
      return withoutUnit(text, field.unit);
    case "datetime":
      // The fill writes the `T` as a space.
      return text.replace(/^(\S+)\s+(\S+)$/u, "$1T$2");
    default:
      return text;
  }
}

/** The answer holds something: a switch always does, a text once it is not blank, a list once it is not empty. */
function holdsAnswer(answer: A2uiFormAnswer): boolean {
  if (typeof answer === "boolean") return true;
  return typeof answer === "string" ? answer.trim() !== "" : answer.length > 0;
}

/**
 * The answers a form was filled with, by field id, read back out of the message: a field's line
 * found by its label in any order and in either language, each answer undone to what the form
 * holds (an option's value back to its label, a list split on either separator, the unit off a
 * figure, a datetime's space back to `T`, a longer answer's indent off). A field with no line, or
 * whose answer it would not accept, is left out. Null when no line names any field: the message
 * was not this form's answer.
 */
export function parseFormFill(spec: A2uiForm, text: string): A2uiFormAnswers | null {
  const texts = answerTexts(spec, text);
  if (texts.size === 0) return null;
  const answers: A2uiFormAnswers = {};
  for (const field of spec.fields) {
    const written = texts.get(field.id);
    if (written === undefined) continue;
    const answer = answerFrom(field, written);
    if (answer === undefined || !holdsAnswer(answer)) continue;
    if (fieldProblem(field, answer) !== null) continue;
    answers[field.id] = answer;
  }
  return answers;
}
