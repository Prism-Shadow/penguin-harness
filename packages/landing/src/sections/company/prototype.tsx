/**
 * The /company page's opening: what the page is, in a few lines, then the prototype itself, live,
 * in a browser window across the page. The prototype is the gallery's `company.html`, built of the
 * Web App's own shell and controls (packages/ui-gallery/src/company); this page frames it in the
 * site's language and mode, as the home page frames the app.
 *
 * The window bar holds the one choice the page adds: which state the prototype opens in, a
 * company a week in or one before its first sentence. Choosing points the frame at a new
 * document, so the prototype starts over from that state.
 */
import { useState } from "react";
import { SitePill, useSiteLocale, useSiteTheme } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL } from "../../lib/links";
import { companyLiveSrc, companyOpenUrl } from "../../lib/live-frame";
import type { CompanyStart } from "../../lib/live-frame";
import { LiveFrame } from "../../components/live-app-frame";

const STARTS: readonly CompanyStart[] = ["week", "fresh"];

const TEXT_LINK =
  "font-medium text-gray-700 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-950 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white";

export function CompanyPrototypeSection() {
  const C = S.company;
  const { locale } = useSiteLocale();
  const { dark } = useSiteTheme();
  const [start, setStart] = useState<CompanyStart>("week");
  return (
    <section className="px-4 pt-12 pb-16 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-4xl text-center">
        <p className="anim-rise flex flex-wrap items-center justify-center gap-3">
          <span className="text-xl font-semibold tracking-tight sm:text-2xl">{C.name}</span>
          <SitePill tone="neutral">{C.draft}</SitePill>
        </p>
        <h1
          className="anim-rise mt-6 text-3xl leading-tight font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-4xl"
          style={{ animationDelay: "60ms" }}
        >
          {C.headline}
        </h1>
        <p
          className="anim-rise mx-auto mt-4 max-w-3xl text-base leading-7 text-pretty text-gray-600 sm:text-lg sm:leading-7 dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {C.subline}
        </p>
        <p
          className="anim-rise mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400"
          style={{ animationDelay: "150ms" }}
        >
          {C.specNote}
          <a href={`${DOCS_URL}company-mode/`} className={TEXT_LINK}>
            {C.currentDocs}
          </a>
          {C.specEnd}
        </p>
      </div>

      <div className="anim-rise mx-auto mt-10 max-w-7xl" style={{ animationDelay: "180ms" }}>
        <LiveFrame
          // A new start is a new document: the prototype begins again from that state.
          key={start}
          src={companyLiveSrc(start, locale, dark)}
          openHref={() => companyOpenUrl(start, locale, dark)}
          openLabel={C.frame.open}
          title={C.frame.title}
          lead={
            <div
              role="group"
              aria-label={C.frame.startsLabel}
              className="flex items-center gap-1 text-xs"
            >
              {STARTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={option === start}
                  onClick={() => setStart(option)}
                  className="rounded-md px-2 py-0.5 font-medium whitespace-nowrap text-gray-500 transition-colors hover:text-gray-900 aria-pressed:bg-gray-100 aria-pressed:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-pressed:bg-gray-800 dark:aria-pressed:text-gray-100"
                >
                  {C.frame.starts[option]}
                </button>
              ))}
            </div>
          }
        />
        <p className="mx-auto mt-3 max-w-3xl text-center text-xs leading-5 text-gray-500 dark:text-gray-400">
          {C.frame.note}
        </p>
      </div>
    </section>
  );
}
