/**
 * What is taken from which product, as ruled rows: the product, the mechanisms taken, how they
 * land in PenguinHarness, and where the prototype shows them. Three columns from `md` up; on a
 * phone each row stacks, the answers under their own small labels. The words are the
 * dictionaries' `company.borrow`.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

const LABEL = "text-xs font-medium text-gray-500 dark:text-gray-400";
const COLUMNS = "md:grid-cols-[9rem_minmax(0,0.8fr)_minmax(0,1.4fr)]";

export function CompanyBorrow() {
  const B = S.company.borrow;
  return (
    <Section id="borrow" title={B.title} subtitle={B.subtitle}>
      <div className="mx-auto max-w-5xl">
        <div
          aria-hidden="true"
          className={`hidden gap-x-8 border-b border-gray-200 pb-2 md:grid dark:border-gray-800 ${COLUMNS} ${LABEL}`}
        >
          <span>{B.head.from}</span>
          <span>{B.head.what}</span>
          <span>{B.head.how}</span>
        </div>
        <dl className="divide-y divide-gray-200 border-b border-gray-200 max-md:border-t dark:divide-gray-800 dark:border-gray-800">
          {B.items.map((item) => (
            <div
              key={item.from}
              className={`grid gap-x-8 gap-y-2 py-4 text-sm leading-6 ${COLUMNS}`}
            >
              <dt className="font-semibold text-gray-900 dark:text-gray-100">{item.from}</dt>
              <dd className="text-gray-700 dark:text-gray-300">
                <span className={`block md:hidden ${LABEL}`}>{B.head.what}</span>
                {item.what}
              </dd>
              <dd className="text-gray-900 dark:text-gray-100">
                <span className={`block md:hidden ${LABEL}`}>{B.head.how}</span>
                {item.how}
                <span className="mt-1 block text-gray-500 dark:text-gray-400">
                  {B.where}
                  {item.where}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
