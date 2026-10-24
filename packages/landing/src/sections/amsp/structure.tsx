/**
 * A run's message structure as one bar chart on one time axis: the Task on top, its Requests under
 * it, their messages under those, longest-lived first, each row touching the one above so every
 * span reads as inside its parent. The bars are the scripted first-request run's own timestamps
 * (`runSpans`), so the chart and the player cannot drift apart. The messages of a Request tile it
 * from `request_begin` to `request_end`, each from where the one before it ended to its complete
 * record; the one blank stretch is between the Requests, where the tool runs, and the
 * `tool_call_output` bar sits in it.
 *
 * Colour says the family, as everywhere on the page (lib/amsp-tones.ts): the Task and Request
 * spans are bounded by `event_msg` records, in amber; the messages are `model_msg`, in blue, each
 * ending in its complete record. One grid holds it all: the level names in a column of their own,
 * then one lane per level, the names too long for their bar and the axis, every one on the same
 * scale, and the legend starting where the lanes start. A bar wide enough holds its label; a
 * narrow one is named under the lane, beside its neighbour. On a phone the bars stay and the same
 * steps in words take the labels' place; a screen reader hears the figure's label and the steps at
 * every width.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { recordsOf, SCENARIOS } from "../../lib/amsp-demo";
import { runSpans } from "../../lib/amsp-replay";
import type { MessageSpan, RunSpans, Span } from "../../lib/amsp-replay";
import { TONES } from "../../lib/amsp-tones";
import { Section } from "../../components/section";

const SPANS = runSpans(recordsOf(SCENARIOS[0]!.steps));

/** One tick per second of the run. */
const TICK_MS = 1000;
/**
 * The narrowest the lanes get while the chart shows its labels (from `sm`), in characters of the
 * bars' monospace: a message bar narrower than its name plus padding gets its name under the lane.
 */
const NARROWEST_LANE_CH = 70;

const LEVEL =
  "flex h-7 items-center justify-end text-[13px] font-medium text-gray-600 dark:text-gray-300";
const LANE = "relative h-7";
const BAR =
  "absolute inset-y-0 flex items-center justify-between gap-2 overflow-hidden px-2 font-mono text-[12px] whitespace-nowrap";
/**
 * Light tints of each family, a step deeper for the Request than for the Task it sits in; the
 * amber spans keep a hairline edge so they hold on any page ground.
 */
const TONE = {
  task: `${TONES.event.ground} ${TONES.event.ink} ring-1 ring-amber-200/80 ring-inset dark:ring-amber-400/15`,
  request: `${TONES.event.fill} ${TONES.event.ink} ring-1 ring-amber-200 ring-inset dark:ring-amber-400/20`,
  message: `${TONES.model.fill} ${TONES.model.ink}`,
};
/** The complete record that closes a message: its bar's end, in the deep blue. */
const RECORD_CAP = "border-r-2 border-brand-600 dark:border-brand-300";

const at = (ms: number, total: number) => `${(100 * ms) / total}%`;

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
      style={{ left: at(span.begin, total), width: at(span.end - span.begin, total) }}
    >
      {children}
    </div>
  );
}

const duration = (span: Span) => `${((span.end - span.begin) / 1000).toFixed(2)} s`;

/** Whether a message bar holds its own name at the narrowest lane the labels show at. */
const fits = (span: MessageSpan, total: number) =>
  ((span.end - span.begin) / total) * NARROWEST_LANE_CH >= span.kind.length + 2;

function StructureChart({ spans }: { spans: RunSpans }) {
  const M = S.amsp.structure;
  const total = spans.task.end;
  const ticks = Array.from({ length: Math.floor(total / TICK_MS) + 1 }, (_, i) => i * TICK_MS);
  // Names that do not fit their bar go under the lane, by turns ending at their bar's end and
  // starting at their bar's start, so two neighbours meet at the gap between their bars.
  const outside = spans.messages.filter((span) => !fits(span, total));
  return (
    <div
      role="img"
      aria-label={M.figureLabel}
      className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]"
    >
      <div className={LEVEL}>{M.levels.task}</div>
      <div className={LANE}>
        <Bar
          span={spans.task}
          total={total}
          className={TONE.task}
          title={`task_begin … task_end · ${duration(spans.task)}`}
        >
          <span className="hidden sm:inline">task_begin</span>
          <span className="hidden sm:inline">task_end</span>
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
            <span className="hidden md:inline">request_begin</span>
            <span className="hidden md:inline">request_end</span>
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
          >
            {fits(span, total) && <span className="hidden sm:inline">{span.kind}</span>}
          </Bar>
        ))}
      </div>

      <div aria-hidden="true" className="hidden sm:block" />
      <div className="relative hidden h-5 sm:block">
        {outside.map((span, i) => {
          const toEnd = i % 2 === 0;
          return (
            <span
              key={span.begin}
              className={`absolute top-0 flex h-5 items-end font-mono text-[12px] leading-4 whitespace-nowrap text-gray-600 dark:text-gray-300 ${
                toEnd
                  ? "-translate-x-full border-r border-gray-300 pr-1 dark:border-gray-600"
                  : "border-l border-gray-300 pl-1 dark:border-gray-600"
              }`}
              style={{ left: at(toEnd ? span.end : span.begin, total) }}
            >
              {span.kind}
            </span>
          );
        })}
      </div>

      <div aria-hidden="true" />
      <div className="relative mt-1 h-5 border-t border-gray-300 dark:border-gray-700">
        {ticks.map((ms) => (
          <span
            key={ms}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[11px] leading-4 text-gray-500 tabular-nums dark:text-gray-400"
            style={{ left: at(ms, total) }}
          >
            <span className="h-1 w-px bg-gray-300 dark:bg-gray-700" />
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
      <div className="mx-auto max-w-5xl">
        {SPANS !== null && <StructureChart spans={SPANS} />}
        <div className="mt-4 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
          <div className="col-span-2 space-y-3 sm:col-span-1 sm:col-start-2">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`h-3 w-7 ${TONE.request}`} />
                {M.boundaries}
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`h-3 w-7 ${TONE.message}`} />
                {M.partial}
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={`h-3 w-0 ${RECORD_CAP}`} />
                {M.complete}
              </span>
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-600 sm:sr-only dark:text-gray-300">
              {M.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Section>
  );
}
