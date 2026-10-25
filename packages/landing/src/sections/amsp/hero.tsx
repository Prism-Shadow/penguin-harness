/**
 * The AMSP page's opening, in two columns as on mmsp.penguin.ooo: on the left the AMSP mark and the
 * protocol's full name with its initials in the brand colour, the claim, the line to MMSP and two
 * actions (the reference, and a prompt to copy for a coding agent); on the right the player. One
 * column below `lg`, the player under the copy.
 */
import { ArrowRightIcon } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL, MMSP_URL } from "../../lib/links";
import { AmspMark } from "../../components/amsp-mark";
import { CopyPromptButton } from "../../components/copy-prompt-button";
import { ExternalLink, ExternalLinkScope } from "../../components/external-link";
import { StreamPlayer } from "../../components/stream-player";

/** The name spells its acronym: each word's initial is drawn in the brand colour. */
const NAME = ["Agent", "Message", "Stream", "Protocol"];

export function AmspHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:pt-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0">
          <p className="anim-rise flex items-center gap-3">
            <AmspMark className="h-10 w-10 shrink-0" />
            <span className="text-xl font-semibold tracking-tight sm:text-2xl">
              {NAME.map((word, i) => (
                <span key={word}>
                  {i > 0 && " "}
                  <span className="text-brand-600 dark:text-brand-300">{word[0]}</span>
                  {word.slice(1)}
                </span>
              ))}
            </span>
          </p>

          <h1
            className="anim-rise mt-8 text-4xl leading-[1.18] font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-5xl"
            style={{ animationDelay: "60ms" }}
          >
            {S.amsp.headline}
          </h1>
          <p
            className="anim-rise mt-5 text-base leading-7 text-pretty text-gray-600 sm:text-xl sm:leading-7 dark:text-gray-300"
            style={{ animationDelay: "120ms" }}
          >
            {S.amsp.subline}
          </p>
          <ExternalLinkScope>
            <p
              className="anim-rise mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400"
              style={{ animationDelay: "150ms" }}
            >
              <ExternalLink
                href={MMSP_URL}
                className="font-medium text-gray-700 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-950 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-white"
              >
                MMSP
              </ExternalLink>
              {S.amsp.lineage}
            </p>
          </ExternalLinkScope>

          <div
            className="anim-rise mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "180ms" }}
          >
            <a
              href={`${DOCS_URL}amsp/`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 text-[15px] font-medium whitespace-nowrap text-white shadow-sm transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              {S.amsp.reference}
              <ArrowRightIcon className="h-4 w-4" />
            </a>
            <CopyPromptButton />
          </div>
        </div>

        <div className="anim-rise min-w-0" style={{ animationDelay: "120ms" }}>
          <StreamPlayer />
        </div>
      </div>
    </section>
  );
}
