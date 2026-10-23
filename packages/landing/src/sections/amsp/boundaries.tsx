/**
 * The run's three boundaries, drawn: `task_begin … task_end` around the run, `request_begin …
 * request_end` around each model request, and each message streaming as fragments until its
 * complete record arrives — with the tool's output completing after its Request closed. The closers
 * are in the brand colour, the fragments are small gray dots on a dashed span. The caption's number
 * is read from the scripted tool-call run, so it cannot drift from the player. On a phone the
 * figure and its legend give way to the same steps in words, which a screen reader always hears.
 */
import { S } from "../../lib/strings";
import { SCENARIOS } from "../../lib/amsp-demo";
import { resultAfterRequestEnd } from "../../lib/amsp-replay";
import { Section } from "../../components/section";

/** How long after `request_end` the tool-call run's output completed. */
const RESULT_AFTER_END_MS = resultAfterRequestEnd(SCENARIOS[0]!.events);

const LABEL = "font-mono text-[12px]";
const OPENER = `${LABEL} fill-gray-500 dark:fill-gray-400`;
const CLOSER = `${LABEL} fill-brand-600 dark:fill-brand-300`;

/** A bracket over [x1, x2] at height y, its ends turned down, labelled with its two records. */
function Bracket({
  x1,
  x2,
  y,
  open,
  close,
}: {
  x1: number;
  x2: number;
  y: number;
  open: string;
  close: string;
}) {
  return (
    <g>
      <path
        d={`M${x1},${y + 9} V${y} H${x2}`}
        fill="none"
        strokeWidth={1.5}
        className="stroke-gray-300 dark:stroke-gray-600"
      />
      <path
        d={`M${x2},${y} V${y + 9}`}
        fill="none"
        strokeWidth={2}
        className="stroke-brand-500 dark:stroke-brand-400"
      />
      <text x={x1} y={y - 8} className={OPENER}>
        {open}
      </text>
      <text x={x2} y={y - 8} textAnchor="end" className={CLOSER}>
        {close}
      </text>
    </g>
  );
}

/** A message streaming as fragments at `dots`, then its complete record at `done`. */
function Message({
  y,
  from,
  dots,
  done,
  kind,
}: {
  y: number;
  from: number;
  dots: readonly number[];
  done: number;
  kind: string;
}) {
  return (
    <g>
      <path
        d={`M${from},${y} H${done - 6}`}
        fill="none"
        strokeWidth={1.25}
        strokeDasharray="3 4"
        className="stroke-gray-300 dark:stroke-gray-600"
      />
      {dots.map((x) => (
        <circle key={x} cx={x} cy={y} r={2} className="fill-gray-400 dark:fill-gray-500" />
      ))}
      <circle cx={done} cy={y} r={4.5} className="fill-brand-500 dark:fill-brand-400" />
      <text x={done} y={y + 21} textAnchor="middle" className={CLOSER}>
        {kind}
      </text>
    </g>
  );
}

function RunFigure() {
  return (
    <svg
      viewBox="0 0 760 206"
      role="img"
      aria-label={S.amsp.boundaries.figureLabel}
      className="mx-auto hidden w-full max-w-4xl sm:block"
    >
      <Bracket x1={30} x2={730} y={34} open="task_begin" close="task_end" />
      <Bracket x1={60} x2={430} y={88} open="request_begin" close="request_end" />
      <Bracket x1={510} x2={710} y={88} open="request_begin" close="request_end" />
      {/* The first request_end, carried down: the tool's output completes to its right. */}
      <path
        d="M430,97 V178"
        fill="none"
        strokeWidth={1}
        strokeDasharray="2 3"
        className="stroke-gray-300 dark:stroke-gray-600"
      />
      <Message y={130} from={78} dots={[84, 112, 140, 168]} done={190} kind="thinking" />
      <Message y={130} from={240} dots={[246, 270, 294, 318]} done={340} kind="tool_call" />
      <Message y={172} from={358} dots={[362, 448, 458]} done={480} kind="tool_call_output" />
      <Message y={130} from={528} dots={[534, 562, 590, 618, 646]} done={672} kind="text" />
    </svg>
  );
}

export function AmspBoundaries() {
  const B = S.amsp.boundaries;
  return (
    <Section id="boundaries" title={B.title} subtitle={B.subtitle}>
      <RunFigure />
      <ol className="mx-auto max-w-2xl list-decimal space-y-2 pl-5 text-sm leading-6 text-gray-600 sm:sr-only dark:text-gray-300">
        {B.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mx-auto mt-6 hidden max-w-4xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-gray-500 sm:flex dark:text-gray-400">
        <span className="inline-flex items-center gap-2">
          <svg viewBox="0 0 28 8" className="h-2 w-7" aria-hidden="true">
            <path
              d="M0,4 H28"
              strokeWidth={1.25}
              strokeDasharray="3 4"
              className="stroke-gray-300 dark:stroke-gray-600"
            />
            <circle cx={4} cy={4} r={2} className="fill-gray-400 dark:fill-gray-500" />
            <circle cx={20} cy={4} r={2} className="fill-gray-400 dark:fill-gray-500" />
          </svg>
          {B.partial}
        </span>
        <span className="inline-flex items-center gap-2">
          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden="true">
            <circle cx={5} cy={5} r={4.5} className="fill-brand-500 dark:fill-brand-400" />
          </svg>
          {B.complete}
        </span>
      </div>
      {RESULT_AFTER_END_MS !== null && (
        <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-6 text-pretty text-gray-600 dark:text-gray-300">
          {B.caption(RESULT_AFTER_END_MS)}
        </p>
      )}
    </Section>
  );
}
