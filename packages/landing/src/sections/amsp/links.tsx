/**
 * Where to read on: the reference pages on the docs site, then the SDK on npm and its source,
 * which leave the site and ask first. Ruled rows: name, what it is, an arrow; one line from `sm`
 * up, the description wrapping on a phone.
 */
import { ArrowRightIcon, ExternalLinkIcon } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { AMSP_NPM_URL, AMSP_SOURCE_URL, DOCS_URL } from "../../lib/links";
import { Section } from "../../components/section";
import { ExternalLink, ExternalLinkScope } from "../../components/external-link";

const ITEMS = [
  { key: "reference", href: `${DOCS_URL}amsp/`, external: false },
  { key: "records", href: `${DOCS_URL}amsp-records/`, external: false },
  { key: "guide", href: `${DOCS_URL}agent-api/`, external: false },
  { key: "npm", href: AMSP_NPM_URL, external: true },
  { key: "source", href: AMSP_SOURCE_URL, external: true },
] as const;

const ROW =
  "group flex items-baseline gap-4 py-3 text-sm leading-6 transition-colors hover:text-gray-950 dark:hover:text-white";

export function AmspLinks() {
  const L = S.amsp.links;
  return (
    <Section id="read-on" title={L.title}>
      <ExternalLinkScope>
        <ul className="mx-auto max-w-3xl divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {ITEMS.map((item) => {
            const words = L.items[item.key];
            const content = (
              <>
                <span className="shrink-0 font-semibold text-gray-900 dark:text-gray-100">
                  {words.name}
                </span>
                <span className="min-w-0 flex-1 text-gray-500 sm:truncate dark:text-gray-400">
                  {words.text}
                </span>
                {item.external ? (
                  <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500" />
                ) : (
                  <ArrowRightIcon className="h-4 w-4 shrink-0 self-center text-gray-400 transition-transform group-hover:translate-x-0.5 dark:text-gray-500" />
                )}
              </>
            );
            return (
              <li key={item.key}>
                {item.external ? (
                  <ExternalLink href={item.href} className={ROW}>
                    {content}
                  </ExternalLink>
                ) : (
                  <a href={item.href} className={ROW}>
                    {content}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </ExternalLinkScope>
    </Section>
  );
}
