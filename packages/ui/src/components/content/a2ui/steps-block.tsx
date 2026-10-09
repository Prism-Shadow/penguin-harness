/**
 * A procedure: numbered steps, one instruction each, drawn as a vertical timeline.
 *
 * A step is a row of two columns: its numbered disc, and everything it carries — its warning and
 * caution first (a reader must meet the risk before the action, not after it), then the
 * instruction, the code under it with the copy button every code block has, and the note last,
 * each note as the blocks' one-row tone note. A one-pixel rule joins each disc to the next, so a
 * procedure reads as one path and whatever sits beside a disc reads as that step's.
 *
 * The list keeps its list semantics (`role="list"`, since a list drawn without markers loses them
 * in Safari), and the disc's number is hidden from assistive tech: the list already says which
 * item of how many a step is.
 */
import type { A2uiStep, A2uiSteps } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { CodeBlock } from "../code-block/code-block";
import { A2UI_TITLE, A2uiNote, InlineText } from "./parts";

/** A step that opens with a note: its disc moves down by the note's padding, to the note's text. */
function opensWithNote(step: A2uiStep): boolean {
  return step.warning !== undefined || step.caution !== undefined;
}

/**
 * A step's row: the disc's column as wide as the disc (`size-5`), the step's content beside it.
 * `isolate` keeps the rule's negative z-index inside the row — under the discs, never under the
 * reply behind the list.
 */
const ROW = "relative isolate grid grid-cols-[calc(var(--ui-space-unit)*5)_minmax(0,1fr)] gap-x-2";

/**
 * The rule from one disc to the next, drawn on the step's row (`::after`) behind both discs:
 * from the centre of this disc to the centre of the next, which sits past the list's gap
 * (`gap-3`), half a line down its row and, when that step opens with a note, the note's padding
 * (`py-2`) further. The discs are filled and paint over it, so the rule meets each one at its
 * edge in every theme's density. The class names are spelled whole, since Tailwind only emits
 * the ones it finds.
 */
const RULE =
  "after:absolute after:left-[calc(var(--ui-space-unit)*2.5_-_0.5px)] after:-z-1 after:w-px " +
  "after:bg-line after:content-['']";
const RULE_FROM = {
  line: "after:top-[0.5lh]",
  note: "after:top-[calc(0.5lh_+_var(--ui-space-unit)*2)]",
};
const RULE_TO = {
  line: "after:bottom-[calc(-0.5lh_-_var(--ui-space-unit)*3)]",
  note: "after:bottom-[calc(-0.5lh_-_var(--ui-space-unit)*5)]",
};

/** The rule a step draws down to the step after it; the last step draws none. */
function ruleClass(step: A2uiStep, next: A2uiStep | undefined): string {
  if (next === undefined) return "";
  const from = RULE_FROM[opensWithNote(step) ? "note" : "line"];
  const to = RULE_TO[opensWithNote(next) ? "note" : "line"];
  return `${RULE} ${from} ${to}`;
}

function Step({
  step,
  n,
  rule,
  strings,
}: {
  step: A2uiStep;
  n: number;
  rule: string;
  strings: A2uiStrings;
}) {
  return (
    <li className={`${ROW} ${rule}`}>
      {/* One line tall, so the disc centres on the first line beside it: the instruction's, or
          the text of a leading note, below the note's padding. */}
      <span
        aria-hidden
        className={`flex h-[1lh] items-center justify-center ${opensWithNote(step) ? "mt-2" : ""}`}
      >
        <span className="inline-flex size-5 items-center justify-center rounded-full border border-line-emphasis bg-surface text-xs font-medium tabular-nums text-fg-muted">
          {n}
        </span>
      </span>
      <div className="col-start-2 flex min-w-0 flex-col gap-2">
        {step.warning !== undefined && (
          <A2uiNote tone="warning" text={step.warning} strings={strings} />
        )}
        {step.caution !== undefined && (
          <A2uiNote tone="caution" text={step.caution} strings={strings} />
        )}
        <div className="text-fg">
          <InlineText text={step.text} />
        </div>
        {step.code !== undefined && <CodeBlock language={step.lang ?? ""} code={step.code} />}
        {step.note !== undefined && <A2uiNote tone="note" text={step.note} strings={strings} />}
      </div>
    </li>
  );
}

export function StepsBlock({ spec }: { spec: A2uiSteps }) {
  const strings = useUiStrings().a2ui;
  const { steps } = spec;
  return (
    <div className="a2ui-block my-3" data-a2ui="steps">
      {spec.title !== undefined && (
        <div className={A2UI_TITLE}>
          <InlineText text={spec.title} />
        </div>
      )}
      <ol role="list" className="a2ui-steps flex flex-col gap-3">
        {steps.map((step, i) => (
          <Step
            key={i}
            step={step}
            n={i + 1}
            rule={ruleClass(step, steps[i + 1])}
            strings={strings}
          />
        ))}
      </ol>
    </div>
  );
}
