/**
 * Where to read on: the docs pages the spec builds on. Ruled rows in the /amsp page's shape: name,
 * what it is, an arrow; one line from `sm` up, the description wrapping on a phone.
 */
import { ArrowRightIcon } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL } from "../../lib/links";
import { Section } from "../../components/section";

const ITEMS = [
  { key: "current", href: `${DOCS_URL}company-mode/` },
  { key: "schedules", href: `${DOCS_URL}schedules/` },
  { key: "traces", href: `${DOCS_URL}sessions-and-traces/` },
] as const;

export function CompanyLinks() {
  const L = S.company.links;
  return (
    <Section id="read-on" title={L.title}>
      <ul className="mx-auto max-w-3xl divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {ITEMS.map((item) => {
          const words = L.items[item.key];
          return (
            <li key={item.key}>
              <a
                href={item.href}
                className="flex items-baseline gap-4 py-3 text-sm leading-6 transition-colors hover:text-gray-950 dark:hover:text-white"
              >
                <span className="shrink-0 font-semibold text-gray-900 dark:text-gray-100">
                  {words.name}
                </span>
                <span className="min-w-0 flex-1 text-gray-500 sm:truncate dark:text-gray-400">
                  {words.text}
                </span>
                <ArrowRightIcon className="h-4 w-4 shrink-0 self-center text-gray-400 dark:text-gray-500" />
              </a>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
