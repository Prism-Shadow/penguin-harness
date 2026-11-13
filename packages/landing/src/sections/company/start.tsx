/**
 * Setting a company up, as numbered ruled rows: the four steps from one sentence to the first
 * inbox. The setup's output is tickets to accept or reject, the same thing every later day holds.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

export function CompanyStart() {
  const T = S.company.start;
  return (
    <Section id="start" title={T.title} subtitle={T.subtitle}>
      <ol className="mx-auto max-w-3xl divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {T.steps.map((step, i) => (
          <li
            key={step.title}
            className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 py-4 text-sm leading-6"
          >
            <span className="text-gray-500 tabular-nums dark:text-gray-400">{i + 1}</span>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">{step.title}</h3>
              <p className="mt-1 text-gray-600 dark:text-gray-300">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
