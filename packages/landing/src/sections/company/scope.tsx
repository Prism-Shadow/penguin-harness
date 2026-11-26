/**
 * Where the spec draws its edges: what this mode will not become, and what it leaves for later,
 * each a ruled list of a short name and a sentence. Two columns from `md` up, stacked on a phone.
 * The words are the dictionaries' `company.scope`.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

const DIVIDED = "divide-gray-200 border-gray-200 dark:divide-gray-800 dark:border-gray-800";

export function CompanyScope() {
  const C = S.company.scope;
  return (
    <Section id="scope" title={C.title} subtitle={C.subtitle}>
      <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2">
        {[C.out, C.later].map((group) => (
          <div key={group.title}>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {group.title}
            </h3>
            <dl className={`mt-3 divide-y border-y text-sm leading-6 ${DIVIDED}`}>
              {group.items.map((item) => (
                <div key={item.name} className="py-2.5">
                  <dt className="font-medium text-gray-900 dark:text-gray-100">{item.name}</dt>
                  <dd className="mt-0.5 text-gray-700 dark:text-gray-300">{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Section>
  );
}
