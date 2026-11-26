/**
 * The organization in one picture, drawn in markup so it follows the page's language and mode:
 * the delivery line (you, the lead, the executor and the verifier inside the ticket's state
 * machine with its automatic send-back, the exception inbox, the domain workbench), then the
 * two-loop learning every step feeds, then what the first version got wrong and the answer here.
 * Across the page from `xl` up; narrower, the line runs down, the state machine's two boxes
 * side by side from `sm`. The words are the dictionaries'
 * `company.architecture`.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

type Tone = "plain" | "lead" | "gate";

const NODE: Record<Tone, string> = {
  plain: "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950",
  lead: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950",
  gate: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950",
};

const LABEL = "text-xs font-medium text-gray-500 dark:text-gray-400";
const DASHED = "rounded-xl border border-dashed border-gray-300 dark:border-gray-700";
const DIVIDED = "divide-gray-200 border-gray-200 dark:divide-gray-800 dark:border-gray-800";

function Node({ name, text, tone = "plain" }: { name: string; text: string; tone?: Tone }) {
  return (
    <div
      className={`flex flex-1 flex-col justify-center rounded-lg border px-4 py-3 text-center ${NODE[tone]}`}
    >
      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{name}</p>
      <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">{text}</p>
    </div>
  );
}

/** Where a row turns from running down to running across. */
type Across = "sm" | "xl";

const ROW: Record<Across, string> = {
  sm: "flex flex-col items-stretch gap-2 sm:flex-row",
  xl: "flex flex-col items-stretch gap-2 xl:flex-row",
};
const DOWN: Record<Across, string> = { sm: "sm:hidden", xl: "xl:hidden" };
const ACROSS: Record<Across, string> = { sm: "hidden sm:inline", xl: "hidden xl:inline" };

/** The step to the next box, down or across as its row runs, with what passes along it. */
function Arrow({ label, across = "xl" }: { label?: string; across?: Across }) {
  return (
    <div
      aria-hidden="true"
      className="flex shrink-0 flex-col items-center justify-center gap-0.5 px-1 text-gray-400 dark:text-gray-500"
    >
      {label !== undefined && (
        <span className="max-w-20 text-center text-xs leading-4 text-gray-500 dark:text-gray-400">
          {label}
        </span>
      )}
      <span className={DOWN[across]}>↓</span>
      <span className={ACROSS[across]}>→</span>
    </div>
  );
}

function Row({ children, across = "xl" }: { children: ReactNode; across?: Across }) {
  return <div className={ROW[across]}>{children}</div>;
}

export function CompanyArchitecture() {
  const A = S.company.architecture;
  const N = A.nodes;
  return (
    <Section id="architecture" title={A.title} subtitle={A.subtitle}>
      <figure className="mx-auto max-w-6xl space-y-4">
        <p className={LABEL}>{A.flowLabel}</p>
        <Row>
          <div className="flex xl:w-28">
            <Node {...N.person} />
          </div>
          <Arrow />
          <div className="flex xl:w-40">
            <Node {...N.lead} tone="lead" />
          </div>
          <Arrow />
          <div className={`flex-1 bg-gray-50 p-3 dark:bg-gray-900 ${DASHED}`}>
            <p className={`mb-2 ${LABEL}`}>{A.machineLabel}</p>
            <Row across="sm">
              <Node {...N.executor} />
              <Arrow across="sm" />
              <Node {...N.verifier} tone="gate" />
            </Row>
            <p className="mt-2 text-center text-xs font-medium text-amber-700 dark:text-amber-400">
              <span aria-hidden="true">↺ </span>
              {A.sendBack}
            </p>
          </div>
          <Arrow label={A.toInbox} />
          <div className="flex xl:w-40">
            <Node {...N.inbox} tone="lead" />
          </div>
          <Arrow />
          <div className="flex xl:w-36">
            <Node {...N.workbench} />
          </div>
        </Row>

        <ul
          aria-hidden="true"
          className="hidden grid-cols-3 gap-2 text-center text-xs text-gray-500 xl:grid dark:text-gray-400"
        >
          <li>↑ {A.feedback.rules}</li>
          <li>↓ {A.feedback.lessons}</li>
          <li>↓ {A.feedback.calls}</li>
        </ul>

        <div className={`p-4 ${DASHED}`}>
          <p className={LABEL}>{A.evolveLabel}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[A.inner, A.outer].map((loop) => (
              <div key={loop.name} className={`rounded-lg border px-4 py-3 ${NODE.plain}`}>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {loop.name}
                </p>
                <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
                  {loop.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </figure>

      <div className="mx-auto mt-16 max-w-5xl">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{A.whyTitle}</h3>
        <div
          aria-hidden="true"
          className={`mt-4 hidden grid-cols-2 gap-x-8 border-b pb-2 md:grid ${DIVIDED} ${LABEL}`}
        >
          <span>{A.head.problem}</span>
          <span>{A.head.answer}</span>
        </div>
        <dl className={`divide-y border-b ${DIVIDED} max-md:mt-4 max-md:border-t`}>
          {A.why.map((item) => (
            <div
              key={item.problem}
              className="grid gap-x-8 gap-y-2 py-4 text-sm leading-6 md:grid-cols-2"
            >
              <dt className="text-gray-500 dark:text-gray-400">
                <span className={`block md:hidden ${LABEL}`}>{A.head.problem}</span>
                {item.problem}
              </dt>
              <dd className="text-gray-900 dark:text-gray-100">
                <span className={`block md:hidden ${LABEL}`}>{A.head.answer}</span>
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
