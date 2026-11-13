/**
 * The /company page's opening, in the /amsp hero's two columns: on the left the page's name with
 * the mark that says it is a draft spec, the claim, what it claims in one paragraph, the line to
 * the shipped company mode and two ways into the spec; on the right the player. One column below
 * `lg`, the player under the copy.
 */
import { ArrowRightIcon, SitePill } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL } from "../../lib/links";
import { InboxPlayer } from "../../components/inbox-player";

const TEXT_LINK =
  "font-medium text-gray-700 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-950 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white";

export function CompanyHero() {
  const C = S.company;
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pt-2">
        <div className="min-w-0">
          <p className="anim-rise flex flex-wrap items-center gap-3">
            <span className="text-xl font-semibold tracking-tight sm:text-2xl">{C.name}</span>
            <SitePill tone="neutral">{C.draft}</SitePill>
          </p>

          <h1
            className="anim-rise mt-8 text-3xl leading-tight font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-4xl"
            style={{ animationDelay: "60ms" }}
          >
            {C.headline}
          </h1>
          <p
            className="anim-rise mt-5 text-base leading-7 text-pretty text-gray-600 sm:text-xl sm:leading-7 dark:text-gray-300"
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

          <div
            className="anim-rise mt-8 flex flex-wrap items-center gap-x-5 gap-y-3"
            style={{ animationDelay: "180ms" }}
          >
            <a
              href="#ticket"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium whitespace-nowrap text-white shadow-sm transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              {C.toTicket}
              <ArrowRightIcon className="h-4 w-4" />
            </a>
            <a href="#invariants" className={`text-sm whitespace-nowrap ${TEXT_LINK}`}>
              {C.toInvariants}
            </a>
          </div>
        </div>

        <div className="anim-rise min-w-0" style={{ animationDelay: "120ms" }}>
          <InboxPlayer />
        </div>
      </div>
    </section>
  );
}
