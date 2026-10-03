/**
 * A procedure: numbered steps, one instruction each.
 *
 * A step's warning and caution come BEFORE its instruction — a reader must meet the risk before
 * the action, not after it — and its note after, each as the blocks' one-row tone note. A step's
 * code is a code block under the instruction, with the copy button every code block has.
 *
 * The list keeps its list semantics (`role="list"`, since a list drawn without markers loses them
 * in Safari) and draws its own numbers beside the instructions, so a number sits with the step it
 * counts rather than beside the warning above it; the warnings, the code and the note are indented
 * to the instruction's column, so everything a step carries reads as that step's.
 */
import type { A2uiStep, A2uiSteps } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { CodeBlock } from "../code-block/code-block";
import { A2uiNote, InlineText } from "./parts";

function Step({ step, n, strings }: { step: A2uiStep; n: number; strings: A2uiStrings }) {
  return (
    <li className="flex flex-col gap-2">
      {/* Indented to the instruction's column like the code and the note, so a warning reads as
          part of the step it guards rather than as a notice between two steps. */}
      {(step.warning !== undefined || step.caution !== undefined) && (
        <div className="flex flex-col gap-2 pl-7">
          {step.warning !== undefined && (
            <A2uiNote tone="warning" text={step.warning} strings={strings} />
          )}
          {step.caution !== undefined && (
            <A2uiNote tone="caution" text={step.caution} strings={strings} />
          )}
        </div>
      )}
      <div className="flex items-start gap-2">
        {/* One line tall, so the number centres on the instruction's first line. */}
        <span aria-hidden className="flex h-[1lh] shrink-0 items-center">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-tone-neutral-bg text-xs font-medium tabular-nums text-fg-muted">
            {n}
          </span>
        </span>
        <span className="min-w-0 text-fg">
          <InlineText text={step.text} />
        </span>
      </div>
      {step.code !== undefined && (
        <div className="pl-7">
          <CodeBlock language={step.lang ?? ""} code={step.code} />
        </div>
      )}
      {step.note !== undefined && (
        <div className="pl-7">
          <A2uiNote tone="note" text={step.note} strings={strings} />
        </div>
      )}
    </li>
  );
}

export function StepsBlock({ spec }: { spec: A2uiSteps }) {
  const strings = useUiStrings().a2ui;
  return (
    <div className="a2ui-block my-3" data-a2ui="steps">
      {spec.title !== undefined && (
        <div className="mb-2 font-medium text-fg">
          <InlineText text={spec.title} />
        </div>
      )}
      <ol role="list" className="a2ui-steps flex flex-col gap-3">
        {spec.steps.map((step, i) => (
          <Step key={i} step={step} n={i + 1} strings={strings} />
        ))}
      </ol>
    </div>
  );
}
