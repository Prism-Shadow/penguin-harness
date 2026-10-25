/**
 * A run's message structure as one bar chart on one time axis: the Task on top, its Requests under
 * it, their messages under those, longest-lived first, each row touching the one above so every
 * span reads as inside its parent. The bars are a scripted run's own timestamps (`runSpans` over
 * `CHART_SCENARIO`, two tool rounds in three Requests), on the same records and timings as the
 * player's. The messages of a Request tile it from `request_begin` to `request_end`, each from
 * where the one before it ended to its complete record; the only blank stretches are between the
 * Requests, where a tool runs, and each `tool_call_output` bar sits in its own.
 *
 * The Task and Request spans are bounded by `event_msg` records, in that family's amber tints, as
 * everywhere on the page (lib/amsp-tones.ts). The messages take the colours the Web App's Trace
 * view gives each kind, as light tints: thinking violet, the reply sky, a tool call as the model
 * writes it orange, a tool's run up to its output emerald; each ends in its complete record, the
 * bar's end in the hue's strong shade. One grid holds it all: the level names in a column of their
 * own, then one lane per level, the names too long for their bar and the axis, every one on the
 * same scale, and the legend starting where the lanes start.
 * A bar wide enough holds its label; a narrow one is named under the lane, beside its neighbour.
 * On a phone the bars stay and the same steps in words take the labels' place; a screen reader
 * hears the figure's label and the steps at every width.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { CHART_SCENARIO, recordsOf } from "../../lib/amsp-demo";
import { runSpans } from "../../lib/amsp-replay";
import type { ItemKind, MessageSpan, RunSpans, Span } from "../../lib/amsp-replay";
import { TONES } from "../../lib/amsp-tones";
import { Section } from "../../components/section";

const SPANS = runSpans(recordsOf(CHART_SCENARIO.steps));

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
 * Light tints of `event_msg`, a step deeper for the Request than for the Task it sits in; the
 * amber spans keep a hairline edge so they hold on any page ground.
 */
const TONE = {
  task: `${TONES.event.ground} ${TONES.event.ink} ring-1 ring-amber-200/80 ring-inset dark:ring-amber-400/15`,
  request: `${TONES.event.fill} ${TONES.event.ink} ring-1 ring-amber-200 ring-inset dark:ring-amber-400/20`,
};
/**
 * Each kind of message in the Trace view's hue for it, in the legend's order (tool-call generation
 * on the orange side of its amber, a step redder in the dark theme, so it stays apart from the
 * amber Request it sits under). A pale fill at the weight of the page's other tints (a low-alpha
 * one in the dark theme), the label in a deep shade of the hue (a light one in the dark theme),
 * and the complete record that closes the message as the bar's end, in the hue's strong shade.
 * `mark` is that strong shade as a fill, for the legend.
 */
const KIND_TONE: Record<ItemKind, { bar: string; mark: string }> = {
  thinking: {
    bar: "border-violet-600 bg-violet-200 text-violet-800 dark:border-violet-400 dark:bg-violet-400/25 dark:text-violet-200",
    mark: "bg-violet-600 dark:bg-violet-400",
  },
  text: {
    bar: "border-sky-600 bg-sky-200 text-sky-800 dark:border-sky-400 dark:bg-sky-400/25 dark:text-sky-200",
    mark: "bg-sky-600 dark:bg-sky-400",
  },
  tool_call: {
    bar: "border-orange-600 bg-orange-200 text-orange-800 dark:border-orange-400 dark:bg-orange-500/25 dark:text-orange-200",
    mark: "bg-orange-600 dark:bg-orange-400",
  },
  tool_call_output: {
    bar: "border-emerald-600 bg-emerald-200 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-400/25 dark:text-emerald-200",
    mark: "bg-emerald-600 dark:bg-emerald-400",
  },
};
const KINDS = Object.keys(KIND_TONE) as ItemKind[];
/** The complete record that closes a message: its bar's end, in the bar's own strong shade. */
const RECORD_CAP = "border-r-2";

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
            <span className="hidden lg:inline">request_begin</span>
            <span className="hidden lg:inline">request_end</span>
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
            className={`${KIND_TONE[span.kind].bar} ${RECORD_CAP}`}
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
            {/* One line per level: the spans, the kinds of message, the record that ends one. */}
            <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
              <p className="flex items-center gap-2">
                <span aria-hidden="true" className={`h-3 w-7 shrink-0 ${TONE.request}`} />
                {M.boundaries}
              </p>
              <p className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {KINDS.map((kind) => (
                  <span key={kind} className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`h-3 w-7 shrink-0 ${KIND_TONE[kind].bar} ${RECORD_CAP}`}
                    />
                    {M.kinds[kind]}
                  </span>
                ))}
              </p>
              <p className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-flex shrink-0 gap-[3px]">
                  {KINDS.map((kind) => (
                    <span key={kind} className={`h-3 w-0.5 ${KIND_TONE[kind].mark}`} />
                  ))}
                </span>
                {M.complete}
              </p>
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
