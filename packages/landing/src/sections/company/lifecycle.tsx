/**
 * One ticket's life as a bar chart on one time axis (lib/company-demo.ts `LIFE`), in the grid the
 * /amsp message chart uses: the ticket on top, the work sessions under it, the person under those.
 * The ticket's row is tiled from filing to done by the stretches it waits on the person, in amber,
 * and the stretches an agent has it, in blue; each work session sits under the stretch it runs in;
 * the person's row holds only their three acts, each where a wait ends.
 *
 * A stretch wide enough holds its name; a narrow one is named under the row. On a phone the bars
 * keep their colours and lose their names. The same life in numbered steps follows the legend at
 * every width: the chart shows how long each stretch is, the steps say what the rule is.
 */
import { S } from "../../lib/strings";
import { LIFE } from "../../lib/company-demo";
import type { LifePhase } from "../../lib/company-demo";
import { COMPANY_TONES } from "../../lib/company-tones";
import { Section } from "../../components/section";

const TICK_MINUTES = 60;
/** A stretch narrower than this share of the axis gets its name under the row. */
const NARROW = 0.12;

const GRID = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[5.5rem_minmax(0,1fr)]";
const LEVEL =
  "flex h-7 items-center justify-end text-sm font-medium text-gray-600 dark:text-gray-300";
const LANE = "relative h-7";
const BAR =
  "absolute inset-y-0 flex items-center overflow-hidden px-2 text-xs font-medium whitespace-nowrap";
const TONE = {
  waiting: `${COMPANY_TONES.waiting.fill} ${COMPANY_TONES.waiting.ink} ring-1 ring-amber-200 ring-inset dark:ring-amber-400/20`,
  working: `${COMPANY_TONES.working.fill} ${COMPANY_TONES.working.ink}`,
  session: `${COMPANY_TONES.working.ground} ${COMPANY_TONES.working.ink} ring-1 ring-brand-200 ring-inset dark:ring-brand-400/20`,
};

const at = (minute: number) => `${(100 * minute) / LIFE.total}%`;
const narrow = (phase: LifePhase) => (phase.end - phase.begin) / LIFE.total < NARROW;
const clock = (minute: number) =>
  `${String(LIFE.startHour + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function LifeChart() {
  const L = S.company.lifecycle;
  const nameOf = (phase: LifePhase) =>
    phase.wait !== null ? L.phases[phase.wait] : L.phases.working;
  const ticks = Array.from(
    { length: Math.floor(LIFE.total / TICK_MINUTES) + 1 },
    (_, i) => i * TICK_MINUTES,
  );
  const waits = LIFE.phases.filter((phase) => phase.wait !== null);
  return (
    <div role="img" aria-label={L.figureLabel} className={GRID}>
      <div className={LEVEL}>{L.levels.ticket}</div>
      <div className={LANE}>
        {LIFE.phases.map((phase) => (
          <div
            key={phase.begin}
            title={`${nameOf(phase)}: ${clock(phase.begin)} – ${clock(phase.end)}`}
            className={`${BAR} ${phase.wait !== null ? TONE.waiting : TONE.working}`}
            style={{ left: at(phase.begin), width: at(phase.end - phase.begin) }}
          >
            {!narrow(phase) && <span className="hidden sm:inline">{nameOf(phase)}</span>}
          </div>
        ))}
      </div>

      <div aria-hidden="true" className="hidden sm:block" />
      <div className="relative hidden h-5 sm:block">
        {LIFE.phases.filter(narrow).map((phase) => (
          <span
            key={phase.begin}
            className="absolute top-0 flex h-5 items-end border-l border-gray-300 pl-1 text-xs leading-4 whitespace-nowrap text-gray-600 dark:border-gray-600 dark:text-gray-300"
            style={{ left: at(phase.begin) }}
          >
            {nameOf(phase)}
          </span>
        ))}
      </div>

      <div className={LEVEL}>{L.levels.session}</div>
      <div className={LANE}>
        {LIFE.sessions.map((session, i) => (
          <div
            key={session.begin}
            title={`${L.session(i + 1)}: ${clock(session.begin)} – ${clock(session.end)}`}
            className={`${BAR} ${TONE.session}`}
            style={{ left: at(session.begin), width: at(session.end - session.begin) }}
          >
            <span className="hidden sm:inline">{L.session(i + 1)}</span>
          </div>
        ))}
      </div>

      <div className={`${LEVEL} mt-1`}>{L.levels.person}</div>
      <div className={`${LANE} mt-1`}>
        {waits.map((phase) => {
          // An act at the axis's end is named to its left, so the name stays inside the chart.
          const atEnd = phase.end === LIFE.total;
          return (
            <span
              key={phase.end}
              className={`absolute inset-y-0 flex items-center border-gray-900 text-xs font-semibold whitespace-nowrap text-gray-900 dark:border-gray-100 dark:text-gray-100 ${
                atEnd ? "-translate-x-full border-r-2 pr-1.5" : "border-l-2 pl-1.5"
              }`}
              style={{ left: at(phase.end) }}
            >
              <span className="hidden sm:inline">{L.acts[phase.wait!]}</span>
            </span>
          );
        })}
      </div>

      <div aria-hidden="true" />
      <div className="relative mt-1 h-5 border-t border-gray-300 dark:border-gray-700">
        {ticks.map((minute) => (
          <span
            key={minute}
            // The tick at the axis's end is named to its left, so its name stays inside the page.
            className={`absolute top-0 flex flex-col text-xs leading-4 text-gray-500 tabular-nums dark:text-gray-400 ${
              minute === LIFE.total
                ? "-translate-x-full items-end"
                : "-translate-x-1/2 items-center"
            }`}
            style={{ left: at(minute) }}
          >
            <span className="h-1 w-px bg-gray-300 dark:bg-gray-700" />
            {clock(minute)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function CompanyLifecycle() {
  const L = S.company.lifecycle;
  return (
    <Section id="lifecycle" title={L.title} subtitle={L.subtitle}>
      <div className="mx-auto max-w-5xl">
        <LifeChart />
        <div className={`mt-6 ${GRID}`}>
          <div className="col-span-2 space-y-3 sm:col-span-1 sm:col-start-2">
            <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
              <p className="flex items-center gap-2">
                <span aria-hidden="true" className={`h-3 w-7 shrink-0 ${TONE.waiting}`} />
                {L.legend.waiting}
              </p>
              <p className="flex items-center gap-2">
                <span aria-hidden="true" className={`h-3 w-7 shrink-0 ${TONE.working}`} />
                {L.legend.working}
              </p>
              <p className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-3 w-7 shrink-0 border-l-2 border-gray-900 dark:border-gray-100"
                />
                {L.legend.act}
              </p>
            </div>
            <ol className="list-decimal space-y-2 pt-3 pl-5 text-sm leading-6 text-gray-600 dark:text-gray-300">
              {L.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </Section>
  );
}
