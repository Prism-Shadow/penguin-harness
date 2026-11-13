/**
 * The three roles of the spec, side by side under one rule each: who it is in a line, what it
 * does, and the one thing it never does. Under them, what the shipped company mode shows on its
 * first screen and this spec moves behind the ticket, as ruled rows: the name, then where it went.
 */
import { S } from "../../lib/strings";
import { Section } from "../../components/section";

const ROLES = ["person", "lead", "session"] as const;
const LABEL = "text-xs font-semibold text-gray-500 dark:text-gray-400";

export function CompanyRoles() {
  const R = S.company.roles;
  return (
    <Section id="roles" title={R.title} subtitle={R.subtitle}>
      <div className="grid gap-x-10 gap-y-10 md:grid-cols-3">
        {ROLES.map((role) => {
          const words = R.items[role];
          return (
            <article key={role} className="border-t border-gray-300 pt-4 dark:border-gray-700">
              <h3 className="text-xl font-semibold tracking-tight">{words.name}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {words.text}
              </p>
              <h4 className={`mt-5 ${LABEL}`}>{R.does}</h4>
              <ul className="mt-1.5 space-y-1 text-sm leading-6 text-gray-900 dark:text-gray-100">
                {words.does.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <h4 className={`mt-5 ${LABEL}`}>{R.never}</h4>
              <p className="mt-1.5 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {words.neverText}
              </p>
            </article>
          );
        })}
      </div>

      <div className="mx-auto mt-16 max-w-3xl">
        <h3 className="text-xl font-semibold tracking-tight">{R.behindTitle}</h3>
        <dl className="mt-4 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {R.behind.map((row) => (
            <div
              key={row.name}
              className="grid gap-x-4 gap-y-0.5 py-3 text-sm leading-6 sm:grid-cols-[10rem_minmax(0,1fr)]"
            >
              <dt className="font-semibold text-gray-900 dark:text-gray-100">{row.name}</dt>
              <dd className="text-gray-600 dark:text-gray-300">{row.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
