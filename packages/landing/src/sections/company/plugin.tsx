import { S } from "../../lib/strings";
import { Section } from "../../components/section";

export function CompanyPlugin() {
  const p = S.company.plugin;
  return (
    <Section title={p.title} subtitle={p.subtitle}>
      <div className="mx-auto max-w-4xl">
        <div className="hidden grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] gap-6 pb-3 text-xs font-medium text-gray-500 md:grid dark:text-gray-400">
          <span />
          <span>{p.now}</span>
          <span>{p.use}</span>
        </div>
        <dl className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {p.rows.map((row) => (
            <div
              key={row.name}
              className="grid gap-2 py-5 md:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-6"
            >
              <dt className="text-sm font-semibold">{row.name}</dt>
              <dd className="text-sm leading-6 text-gray-600 dark:text-gray-400">
                <span className="mb-1 block text-xs font-medium text-gray-500 md:hidden dark:text-gray-400">
                  {p.now}
                </span>
                {row.now}
              </dd>
              <dd className="text-sm leading-6 text-gray-900 dark:text-gray-100">
                <span className="mb-1 block text-xs font-medium text-gray-500 md:hidden dark:text-gray-400">
                  {p.use}
                </span>
                {row.use}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
