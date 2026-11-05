/**
 * A form's answers as the reader gives them, the two questions the fill button asks of them —
 * may the form be filled yet, and what goes into the composer — the draft they are kept as
 * across a reload (draft.ts), and what an answered form shows. Pure, so the gate and the draft's
 * check are testable without a DOM.
 *
 * Whether one answer is acceptable, and what a field starts with, are the grammar's questions
 * (`fieldProblem`, `initialAnswer`): the rule the grammar holds a `default` to is the rule the
 * gate, the error line under a control and a restored draft are held to, so the four never
 * disagree.
 *
 * An option field's answer is its options' labels (unique within the field), a switch's its state,
 * and every other field's the text as typed — a number as the reader typed it or as its stepper
 * left it, a slider's figure, a date or a time as its native input emits it. The gate checks an
 * answer; it never rewrites one.
 */
import { fieldProblem, initialAnswer } from "@prismshadow/penguin-core/a2ui";
import type { A2uiForm, A2uiFormAnswer, A2uiFormAnswers } from "@prismshadow/penguin-core/a2ui";

/** Every field's answer as it stands, by field id; a field with none is absent. */
export type A2uiFormState = Readonly<Record<string, A2uiFormAnswer | undefined>>;

/** The field holds an answer: a switch always does, a text once it is not blank, options once one is picked. */
export function fieldAnswered(answer: A2uiFormAnswer | undefined): boolean {
  if (answer === undefined) return false;
  if (typeof answer === "boolean") return true;
  return typeof answer === "string" ? answer.trim() !== "" : answer.length > 0;
}

/** What the form shows before the reader touches it: each field's default, a slider at its minimum, a switch off. */
export function initialAnswers(spec: A2uiForm): A2uiFormState {
  const out: Record<string, A2uiFormAnswer> = {};
  for (const field of spec.fields) {
    const answer = initialAnswer(field);
    if (answer !== undefined) out[field.id] = answer;
  }
  return out;
}

/**
 * The fill button's gate: every field's answer is acceptable to it — a required one present, a
 * number in range, a date a real date, a text within its length and pattern — and at least one
 * field holds an answer. A form that filled a wrong answer would hand the model a wrong fact.
 */
export function formReady(spec: A2uiForm, answers: A2uiFormState): boolean {
  let any = false;
  for (const field of spec.fields) {
    const answer = answers[field.id];
    if (fieldProblem(field, answer) !== null) return false;
    any ||= fieldAnswered(answer);
  }
  return any;
}

/** The answered fields only, text trimmed: what the grammar turns into the composer's lines. */
export function filledAnswers(
  spec: A2uiForm,
  answers: A2uiFormState,
): Record<string, A2uiFormAnswer> {
  const out: Record<string, A2uiFormAnswer> = {};
  for (const field of spec.fields) {
    const answer = answers[field.id];
    if (answer === undefined || !fieldAnswered(answer)) continue;
    out[field.id] = typeof answer === "string" ? answer.trim() : answer;
  }
  return out;
}

/** Two answers that read the same: equal texts, equal states, the same labels in the same order. */
function sameAnswer(a: A2uiFormAnswer | undefined, b: A2uiFormAnswer | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((label, i) => label === b[i]);
  }
  return a === b;
}

/**
 * What a form's draft keeps: the fields whose answer differs from the one the form starts with,
 * or null when none does — so a form nobody has touched, defaults and all, writes nothing, and
 * a field typed into and emptied again counts as untouched.
 */
export function draftAnswers(
  spec: A2uiForm,
  answers: A2uiFormState,
): Record<string, A2uiFormAnswer> | null {
  const start = initialAnswers(spec);
  const out: Record<string, A2uiFormAnswer> = {};
  for (const field of spec.fields) {
    const answer = answers[field.id];
    const first = start[field.id];
    if (answer === undefined || sameAnswer(answer, first)) continue;
    if (first === undefined && !fieldAnswered(answer)) continue;
    out[field.id] = answer;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * A saved draft checked against the form as it stands, over the answers it starts with: an entry
 * comes back only for a field the form still has, and only when the field would accept it — the
 * JSON its kind holds (a boolean on a switch and nowhere else), a label among its options, a
 * number in range, a date in format. Anything else is dropped, field by field, and that field
 * keeps its starting answer, so a malformed entry yields the form as first drawn rather than an
 * error.
 */
export function restoreAnswers(spec: A2uiForm, saved: unknown): A2uiFormState {
  const out: Record<string, A2uiFormAnswer | undefined> = { ...initialAnswers(spec) };
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return out;
  const record = saved as Record<string, unknown>;
  for (const field of spec.fields) {
    if (!Object.hasOwn(record, field.id)) continue;
    // Whatever the store held: the grammar's rule refuses an answer of the wrong shape too.
    const value = record[field.id] as A2uiFormAnswer;
    if (fieldProblem(field, value) !== null) continue;
    out[field.id] = value;
  }
  return out;
}

/**
 * What an answered form shows: the answers read back out of the message that answered it (core's
 * `parseFormFill`), and a field with none unanswered — an empty box, nothing picked. A slider and
 * a switch cannot show no answer (a slider always stands somewhere, a switch off reads as "No"),
 * so one with none stands at its starting answer, the form as asked; the fill text always holds
 * a line for them, so only a message the reader edited lacks one.
 */
export function answeredState(spec: A2uiForm, recovered: A2uiFormAnswers): A2uiFormState {
  const out: Record<string, A2uiFormAnswer> = {};
  for (const field of spec.fields) {
    const answer =
      recovered[field.id] ??
      (field.kind === "slider" || field.kind === "switch" ? initialAnswer(field) : undefined);
    if (answer !== undefined) out[field.id] = answer;
  }
  return out;
}
