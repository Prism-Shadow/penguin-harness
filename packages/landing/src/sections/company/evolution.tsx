/**
 * How the company gets better, with no scores and no test runs: the person's verdicts are the
 * measure. Two loops side by side from `md` up, stacked on a phone, each a ruled list (every
 * ticket, automatic; every N closed tickets, a retrospective that proposes); then the four
 * curves a retrospective reads, as the same ruled three-column rows the changes section uses; then
 * how the handbook is kept short, as a numbered list. The words are the dictionaries'
 * `company.evolution`.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

const LABEL = "text-xs font-medium text-gray-500 dark:text-gray-400";
const RULE = "border-gray-200 dark:border-gray-800";
const DIVIDED = "divide-gray-200 border-gray-200 dark:divide-gray-800 dark:border-gray-800";

export function CompanyEvolution() {
  const E = S.company.evolution;
  return (
    <Section id="evolution" title={E.title} subtitle={E.subtitle}>
      <div className="mx-auto max-w-5xl space-y-14">
        <div className="grid gap-10 md:grid-cols-2">
          {E.loops.map((loop) => (
            <div key={loop.title}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {loop.title}
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{loop.when}</p>
              <ul className={`mt-3 divide-y border-y text-sm leading-6 ${DIVIDED}`}>
                {loop.items.map((item) => (
                  <li key={item} className="py-2.5 text-gray-700 dark:text-gray-300">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {E.curves.title}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{E.curves.subtitle}</p>
          <div
            aria-hidden="true"
            className={`mt-4 hidden grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-8 border-b pb-2 md:grid ${RULE} ${LABEL}`}
          >
            <span>{E.curves.head.expect}</span>
            <span>{E.curves.head.read}</span>
            <span>{E.curves.head.trend}</span>
          </div>
          <dl className={`divide-y border-b ${DIVIDED}`}>
            {E.curves.items.map((item) => (
              <div
                key={item.expect}
                className="grid gap-x-8 gap-y-2 py-4 text-sm leading-6 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]"
              >
                <dt className="font-semibold text-gray-900 dark:text-gray-100">{item.expect}</dt>
                <dd className="text-gray-700 dark:text-gray-300">
                  <span className={`block md:hidden ${LABEL}`}>{E.curves.head.read}</span>
                  {item.read}
                </dd>
                <dd className="text-gray-900 dark:text-gray-100">
                  <span className={`block md:hidden ${LABEL}`}>{E.curves.head.trend}</span>
                  {item.trend}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">{E.curves.note}</p>
        </div>

        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {E.shrink.title}
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{E.shrink.subtitle}</p>
          <ol className={`mt-3 divide-y border-y text-sm leading-6 ${DIVIDED}`}>
            {E.shrink.items.map((item, i) => (
              <li
                key={item}
                className="grid grid-cols-[2rem_minmax(0,1fr)] py-2.5 text-gray-700 dark:text-gray-300"
              >
                <span className="text-gray-500 tabular-nums dark:text-gray-400">{i + 1}</span>
                {item}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}
