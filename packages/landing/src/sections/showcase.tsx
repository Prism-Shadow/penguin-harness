/** Three concise capability summaries beside the hero's single live walkthrough. */
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { DOCS_URL } from "../lib/links";
import { RSI_TOOLKITS } from "../lib/rsi-stats";
import { useReveal } from "../lib/reveal";
import { ArrowRightIcon } from "../components/icons";

function paperToolkits(locale: Locale): string {
  const names = RSI_TOOLKITS.filter((toolkit) => toolkit.href !== null).map((t) => t.label);
  if (locale === "zh") return names.join("、");
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function Showcase() {
  const { locale } = useSiteLocale();
  const ref = useReveal<HTMLElement>();
  const c = S.showcase;
  const items = [
    { ...c.evolve, href: "self-improvement" },
    { ...c.evaluate, href: "evaluation-center" },
    { ...c.toolkits, text: c.toolkits.text(paperToolkits(locale)), href: "skills" },
  ];
  return (
    <section ref={ref} className="px-4 pt-2 pb-8 sm:px-6 sm:pb-12">
      <div className="mx-auto grid max-w-6xl gap-6 border-t border-gray-200 pt-6 md:grid-cols-3 md:gap-8 dark:border-gray-800">
        {items.map((item) => (
          <article key={item.href}>
            <h2 className="text-lg leading-snug font-semibold tracking-tight text-balance text-gray-900 dark:text-gray-100">
              {item.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{item.text}</p>
            <a
              href={`${DOCS_URL}${item.href}`}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300 dark:hover:text-brand-200"
            >
              {item.link}
              <ArrowRightIcon className="h-4 w-4" />
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
