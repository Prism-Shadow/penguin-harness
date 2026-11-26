/**
 * Where the spec draws its edges: the two kinds of need pulled apart (this mode, and the mirror
 * of a real company built elsewhere), what this mode will not become, and where it could go,
 * each a ruled list of a short name and a sentence. Side by side from `md` up, stacked on a
 * phone. The words are the dictionaries' `company.scope`.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

const DIVIDED = "divide-gray-200 border-gray-200 dark:divide-gray-800 dark:border-gray-800";

type Group = { title: string; items: readonly { name: string; text: string }[] };

function Ruled({ group }: { group: Group }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{group.title}</h3>
      <dl className={`mt-3 divide-y border-y text-sm leading-6 ${DIVIDED}`}>
        {group.items.map((item) => (
          <div key={item.name} className="py-2.5">
            <dt className="font-medium text-gray-900 dark:text-gray-100">{item.name}</dt>
            <dd className="mt-0.5 text-gray-700 dark:text-gray-300">{item.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function CompanyScope() {
  const C = S.company.scope;
  return (
    <Section id="scope" title={C.title} subtitle={C.subtitle}>
      <div className="mx-auto max-w-5xl space-y-12">
        <Ruled group={C.split} />
        <div className="grid gap-10 md:grid-cols-2">
          <Ruled group={C.out} />
          <Ruled group={C.later} />
        </div>
      </div>
    </Section>
  );
}
