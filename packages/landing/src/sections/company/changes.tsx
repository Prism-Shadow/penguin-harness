/**
 * What the spec changes against the shipped company mode, as ruled rows: the matter, what the
 * shipped mode does, what the spec does instead. Three columns from `md` up; on a phone each row
 * stacks, the two answers under their own small labels.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

const LABEL = "text-xs font-medium text-gray-500 dark:text-gray-400";

export function CompanyChanges() {
  const C = S.company.changes;
  return (
    <Section id="changes" title={C.title} subtitle={C.subtitle}>
      <div className="mx-auto max-w-5xl">
        <div
          aria-hidden="true"
          className={`hidden grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)] gap-x-8 border-b border-gray-200 pb-2 md:grid dark:border-gray-800 ${LABEL}`}
        >
          <span>{C.head.topic}</span>
          <span>{C.head.now}</span>
          <span>{C.head.spec}</span>
        </div>
        <dl className="divide-y divide-gray-200 border-b border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {C.items.map((item) => (
            <div
              key={item.topic}
              className="grid gap-x-8 gap-y-2 py-4 text-sm leading-6 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <dt className="font-semibold text-gray-900 dark:text-gray-100">{item.topic}</dt>
              <dd className="text-gray-500 dark:text-gray-400">
                <span className={`block md:hidden ${LABEL}`}>{C.head.now}</span>
                {item.now}
              </dd>
              <dd className="text-gray-900 dark:text-gray-100">
                <span className={`block md:hidden ${LABEL}`}>{C.head.spec}</span>
                {item.spec}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
