/**
 * A run's message structure as one bar chart on one time axis: the Task on top, its Requests under
 * it, their messages under those, longest-lived first, each row touching the one above so every
 * span reads as inside its parent. The bars are the scripted first-request run's own timestamps
 * (`runSpans`), so the chart and the caption's number cannot drift from the player. A message bar is
 * its `partial_*` fragments and ends in its complete record; the tool's output runs past its
 * Request's end, which the chart shows and the caption measures.
 *
 * The labels inside and under the bars need the width of `sm` and up. On a phone the bars stay and
 * the same steps in words take the labels' place; a screen reader hears the figure's label and the
 * steps at every width.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { recordsOf, SCENARIOS } from "../../lib/amsp-demo";
import { resultAfterRequestEnd, runSpans } from "../../lib/amsp-replay";
import type { Span } from "../../lib/amsp-replay";
import { Section } from "../../components/section";

const RECORDS = recordsOf(SCENARIOS[0]!.steps);
const SPANS = runSpans(RECORDS);
/** How long after `request_end` the first-request run's tool output completed. */
const RESULT_AFTER_END_MS = resultAfterRequestEnd(RECORDS);

/** One tick per half second of the run. */
const TICK_MS = 500;

const LEVEL =
  "flex items-center pr-3 text-sm font-medium text-gray-700 sm:pr-4 dark:text-gray-200";
const LANE = "relative h-9";
const BAR =
  "absolute inset-y-0 flex items-center justify-between gap-2 overflow-hidden rounded-[3px] px-2 font-mono text-[12px] whitespace-nowrap";
/** A sequential ramp of the one accent: each level a step deeper than the one above. */
const TONE = {
  task: "bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100",
  request: "bg-brand-200 text-brand-900 dark:bg-brand-800 dark:text-brand-50",
  message: "bg-brand-300 dark:bg-brand-700",
};
/** The complete record that closes a message: its bar's end, in the accent's deep step. */
const RECORD_CAP = "border-r-[3px] border-brand-700 dark:border-brand-300";

function Bar({
  span,
  total,
  className,
  title,
  children,
}: {
  span: Span;
  total: number;
  className: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      title={title}
      className={`${BAR} ${className}`}
      style={{
        left: `${(100 * span.begin) / total}%`,
        width: `${(100 * (span.end - span.begin)) / total}%`,
      }}
    >
      {children}
    </div>
  );
}

/** A span's two boundary records, inside its bar from `sm` up. */
function Ends({ open, close }: { open: string; close: string }) {
  return (
    <>
      <span className="hidden sm:inline">{open}</span>
      <span className="hidden sm:inline">{close}</span>
    </>
  );
}

const duration = (span: Span) => `${span.end - span.begin} ms`;

function StructureChart({ spans }: { spans: NonNullable<typeof SPANS> }) {
  const M = S.amsp.structure;
  const total = spans.task.end;
  const ticks = Array.from({ length: Math.floor(total / TICK_MS) + 1 }, (_, i) => i * TICK_MS);
  const at = (ms: number) => `${(100 * ms) / total}%`;
  return (
    <div
      role="img"
      aria-label={M.figureLabel}
      className="mx-auto grid max-w-5xl grid-cols-[4.75rem_minmax(0,1fr)] sm:grid-cols-[6rem_minmax(0,1fr)]"
    >
      <div className={LEVEL}>{M.levels.task}</div>
      <div className={LANE}>
        <Bar
          span={spans.task}
          total={total}
          className={TONE.task}
          title={`task_begin … task_end · ${duration(spans.task)}`}
        >
          <Ends open="task_begin" close="task_end" />
        </Bar>
      </div>

      <div className={LEVEL}>{M.levels.request}</div>
      <div className={LANE}>
        {spans.requests.map((span) => (
          <Bar
            key={span.begin}
            span={span}
            total={total}
            className={TONE.request}
            title={`request_begin … request_end · ${duration(span)}`}
          >
            <Ends open="request_begin" close="request_end" />
          </Bar>
        ))}
      </div>

      <div className={LEVEL}>{M.levels.message}</div>
      <div className={LANE}>
        {spans.messages.map((span) => (
          <Bar
            key={span.begin}
            span={span}
            total={total}
            className={`${TONE.message} ${RECORD_CAP}`}
            title={`${span.kind} · ${duration(span)}`}
          />
        ))}
      </div>

      {/* Each message's kind under its bar, on two staggered lines so neighbours never touch. */}
      <div aria-hidden="true" />
      <div className="relative hidden h-10 sm:block">
        {spans.messages.map((span, i) => (
          <span
            key={span.begin}
            className={`absolute top-0 flex items-end border-l border-gray-300 pl-1 font-mono text-[12px] leading-5 whitespace-nowrap text-gray-600 dark:border-gray-600 dark:text-gray-300 ${
              i % 2 === 0 ? "h-5" : "h-10"
            }`}
            style={{ left: at(span.begin) }}
          >
            {span.kind}
          </span>
        ))}
      </div>

      <div aria-hidden="true" />
      <div className="relative mt-1 h-6 border-t border-gray-300 dark:border-gray-700">
        {ticks.map((ms) => (
          <span
            key={ms}
            className={`absolute top-0 flex flex-col text-[11px] text-gray-500 tabular-nums dark:text-gray-400 ${
              ms === 0 ? "items-start" : "-translate-x-1/2 items-center"
            }`}
            style={{ left: at(ms) }}
          >
            <span className="h-1.5 w-px bg-gray-300 dark:bg-gray-700" />
            {ms / 1000} s
          </span>
        ))}
      </div>
    </div>
  );
}

export function AmspStructure() {
  const M = S.amsp.structure;
  return (
    <Section id="structure" title={M.title} subtitle={M.subtitle}>
      {SPANS !== null && <StructureChart spans={SPANS} />}
      <div className="mx-auto mt-6 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={`h-2.5 w-7 rounded-[2px] ${TONE.message}`} />
          {M.partial}
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden="true" className={`h-2.5 w-0 ${RECORD_CAP}`} />
          {M.complete}
        </span>
      </div>
      <ol className="mx-auto mt-6 max-w-2xl list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-600 sm:sr-only dark:text-gray-300">
        {M.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {RESULT_AFTER_END_MS !== null && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-pretty text-gray-600 dark:text-gray-300">
          {M.caption(RESULT_AFTER_END_MS)}
        </p>
      )}
    </Section>
  );
}
