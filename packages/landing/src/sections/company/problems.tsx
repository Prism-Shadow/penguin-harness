/**
 * The two problems the products tried left open, and this spec's answer to each. First, general
 * tickets against expert review: the ticket keeps the assignment and the record, and each domain
 * is reviewed in a workbench of its own (the gallery's spec.ts `WORKBENCHES`, ruled rows). Then
 * getting steadier as it runs: the inner loop, local and every day, and the outer loop, the
 * community's public benchmarks, side by side from `md` up, and the numbers a review reads. The
 * words are the dictionaries' `company.problems`.
 */
import { S } from "../../lib/strings";
import { WORKBENCHES } from "../../../../ui-gallery/src/company/spec";
import { Section } from "../../components/section";

const LABEL = "text-xs font-medium text-gray-500 dark:text-gray-400";
const DIVIDED = "divide-gray-200 border-gray-200 dark:divide-gray-800 dark:border-gray-800";
const HEADING = "text-xl font-semibold tracking-tight";
const PROSE = "mt-2 max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300";

export function CompanyProblems() {
  const P = S.company.problems;
  const W = P.workbench;
  const E = P.evolution;
  return (
    <Section id="problems" title={P.title} subtitle={P.subtitle}>
      <div className="mx-auto max-w-5xl space-y-16">
        <div>
          <h3 className={HEADING}>
            <span className="text-gray-500 tabular-nums dark:text-gray-400">1 </span>
            {W.title}
          </h3>
          <p className={PROSE}>{W.text}</p>
          <div
            aria-hidden="true"
            className={`mt-6 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-8 border-b pb-2 ${DIVIDED} ${LABEL}`}
          >
            <span>{W.head.kind}</span>
            <span>{W.head.accept}</span>
          </div>
          <dl className={`divide-y border-b ${DIVIDED}`}>
            {WORKBENCHES.map((kind) => (
              <div
                key={kind}
                className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-8 py-2.5 text-sm leading-6"
              >
                <dt className="font-mono text-xs leading-6 text-gray-900 dark:text-gray-100">
                  {kind}
                </dt>
                <dd className="text-gray-700 dark:text-gray-300">{W.workbenches[kind]}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <h3 className={HEADING}>
            <span className="text-gray-500 tabular-nums dark:text-gray-400">2 </span>
            {E.title}
          </h3>
          <p className={PROSE}>{E.text}</p>
          <div className="mt-6 grid gap-10 md:grid-cols-2">
            {E.loops.map((loop) => (
              <div key={loop.title}>
                <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  {loop.title}
                </h4>
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

          <h4 className="mt-12 text-base font-semibold text-gray-900 dark:text-gray-100">
            {E.metrics.title}
          </h4>
          <div
            aria-hidden="true"
            className={`mt-4 grid grid-cols-2 gap-x-8 border-b pb-2 ${DIVIDED} ${LABEL}`}
          >
            <span>{E.metrics.head.metric}</span>
            <span>{E.metrics.head.trend}</span>
          </div>
          <dl className={`divide-y border-b ${DIVIDED}`}>
            {E.metrics.items.map((item) => (
              <div key={item.metric} className="grid grid-cols-2 gap-x-8 py-3 text-sm leading-6">
                <dt className="text-gray-900 dark:text-gray-100">{item.metric}</dt>
                <dd className="text-gray-700 dark:text-gray-300">{item.trend}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {E.metrics.note}
          </p>
        </div>
      </div>
    </Section>
  );
}
