import { S } from "../../lib/strings";
import { Section } from "../../components/section";

export function CompanyTradeoffs() {
  const t = S.company.tradeoffs;
  return (
    <Section title={t.title} subtitle={t.subtitle}>
      <div className="mx-auto grid max-w-5xl gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {t.groups.map((group) => (
          <div
            key={group.name}
            className="min-w-0 border-t border-gray-200 pt-4 dark:border-gray-800"
          >
            <h3 className="text-base font-semibold">{group.name}</h3>
            <ul className="mt-3 space-y-2.5">
              {group.items.map((item) => (
                <li key={item} className="text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-12 max-w-3xl text-center text-sm leading-6 text-gray-500 dark:text-gray-400">
        {t.mirror}
      </p>
    </Section>
  );
}
