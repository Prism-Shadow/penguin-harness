/**
 * A form's answers as the reader gives them, and the two questions the fill button asks of them:
 * may the form be filled yet, and what goes into the composer. Pure, so the gate is testable
 * without a DOM.
 *
 * An option field's answer is its options' labels (unique within the field), a text field's the
 * text as typed, a number field's the digits as typed — a number is checked, never rewritten.
 */
import type { A2uiForm, A2uiFormField } from "@prismshadow/penguin-core/a2ui";

export type A2uiFormAnswer = string | readonly string[];
export type A2uiFormAnswers = Readonly<Record<string, A2uiFormAnswer | undefined>>;

/** The field has an answer: a non-blank text, or at least one option. */
export function fieldAnswered(answer: A2uiFormAnswer | undefined): boolean {
  if (answer === undefined) return false;
  return typeof answer === "string" ? answer.trim() !== "" : answer.length > 0;
}

/** A number field's answer that is not a number, or falls outside the field's range. */
export function numberOutOfRange(field: A2uiFormField, answer: A2uiFormAnswer | undefined) {
  if (field.kind !== "number" || typeof answer !== "string" || answer.trim() === "") return false;
  const value = Number(answer.trim());
  if (!Number.isFinite(value)) return true;
  return (
    (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)
  );
}

/**
 * The fill button's gate: something is answered, every required field is, and no number is
 * malformed or out of range — a form that fills a wrong number would hand the model a wrong fact.
 */
export function formReady(spec: A2uiForm, answers: A2uiFormAnswers): boolean {
  let any = false;
  for (const field of spec.fields) {
    const answer = answers[field.id];
    const answered = fieldAnswered(answer);
    if (field.required === true && !answered) return false;
    if (numberOutOfRange(field, answer)) return false;
    any ||= answered;
  }
  return any;
}

/** The answered fields only, text trimmed: what the grammar turns into the composer's lines. */
export function filledAnswers(
  spec: A2uiForm,
  answers: A2uiFormAnswers,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const field of spec.fields) {
    const answer = answers[field.id];
    if (!fieldAnswered(answer) || answer === undefined) continue;
    out[field.id] = typeof answer === "string" ? answer.trim() : [...answer];
  }
  return out;
}
