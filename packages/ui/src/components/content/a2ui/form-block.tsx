/**
 * A form: a few questions answered together, then filled into the composer as one message, a line
 * per answered field. This module is the form's frame — its title, its fields in order, the fill
 * button — and form-fields.tsx draws each field as the control its kind is.
 *
 * Each field starts at its answer before anyone touches it (the model's default, a slider at its
 * minimum, a switch off). The fill button stays disabled until every answer is acceptable to its
 * field and at least one field holds one (form-answers.ts); Enter in a one-line box fills, as a
 * form submits, and Mod+Enter in a textarea does.
 *
 * While the form is the open question its answers are kept as a draft (draft.ts), so a reload
 * brings them back over the defaults; filling leaves them on screen and in the draft.
 *
 * Read-only, the fields show with every control disabled and no fill button. Once the reply has
 * been answered they show the answers read back out of the message that answered it
 * (`answeredWith`, core's `parseFormFill`), so a reload brings back what the reader sent, not the
 * model's defaults; a field the message has no acceptable line for shows unanswered
 * (form-answers.ts). A message that is not the form's answer leaves the form as it was.
 */
import { useCallback, useMemo } from "react";
import type { FormEvent } from "react";
import { fieldProblem, formFillText, parseFormFill } from "@prismshadow/penguin-core/a2ui";
import type { A2uiForm } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { useA2uiActions } from "./actions";
import { useA2uiDraft } from "./draft";
import {
  answeredState,
  draftAnswers,
  filledAnswers,
  formReady,
  restoreAnswers,
} from "./form-answers";
import type { A2uiFormState } from "./form-answers";
import { FormFieldControl } from "./form-fields";
import { A2UI_TITLE, InlineText } from "./parts";

export function FormBlock({ spec }: { spec: A2uiForm }) {
  const actions = useA2uiActions();
  const strings = useUiStrings().a2ui;
  // The spec is parsed once per source (a2ui-block.tsx), so this keeps its identity across renders.
  const persist = useCallback((answers: A2uiFormState) => draftAnswers(spec, answers), [spec]);
  const [answers, setAnswers] = useA2uiDraft<A2uiFormState>(
    (saved) => restoreAnswers(spec, saved),
    persist,
  );
  const { interactive, answeredWith } = actions;
  // What the message that answered the reply says, or null to show the answers as they stand.
  const answered = useMemo(() => {
    if (interactive || answeredWith === undefined) return null;
    const recovered = parseFormFill(spec, answeredWith);
    return recovered === null ? null : answeredState(spec, recovered);
  }, [spec, interactive, answeredWith]);
  const shown = answered ?? answers;
  const disabled = !interactive;
  const ready = interactive && formReady(spec, answers);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    actions.fill(formFillText(spec, filledAnswers(spec, answers), actions.lang));
  };

  return (
    <form className="a2ui-block my-3" data-a2ui="form" onSubmit={submit}>
      {spec.title !== undefined && (
        <div className={A2UI_TITLE}>
          <InlineText text={spec.title} />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {spec.fields.map((field) => (
          <FormFieldControl
            key={field.id}
            field={field}
            answer={shown[field.id]}
            onChange={(answer) => setAnswers((current) => ({ ...current, [field.id]: answer }))}
            disabled={disabled}
            strings={strings}
            problem={fieldProblem(field, shown[field.id])}
          />
        ))}
      </div>
      {interactive && (
        <div className="mt-3">
          <Button type="submit" variant="primary" size="sm" disabled={!ready}>
            {spec.submitLabel ?? strings.fill}
          </Button>
        </div>
      )}
    </form>
  );
}
