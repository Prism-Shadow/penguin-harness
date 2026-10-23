/**
 * The AMSP page's opening, in two columns as on mmsp.penguin.ooo: on the left the protocol's full
 * name with its initials in the brand colour, the claim, the line to MMSP, two actions (the
 * reference, and a prompt to copy for a coding agent) and three counts read from the vocabulary;
 * on the right the player. One column below `lg`, the player under the copy.
 */
import { useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  TerminalIcon,
  writeSiteClipboard,
} from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL, MMSP_URL } from "../../lib/links";
import { ENVELOPE_COUNT, STORED_KIND_COUNT, STREAM_COUNT } from "../../lib/amsp-vocabulary";
import { ExternalLink, ExternalLinkScope } from "../../components/external-link";
import { StreamPlayer } from "../../components/stream-player";

/** The name spells its acronym: each word's initial is drawn in the brand colour. */
const NAME = ["Agent", "Message", "Stream", "Protocol"];

/** How long the copy button shows its check after a copy. */
const COPIED_MS = 2000;

function CopyPromptButton() {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    // The prompt is read by a coding agent elsewhere, so the guide's address must be absolute.
    const guide = new URL(`${DOCS_URL}agent-api/`, window.location.origin).href;
    if (await writeSiteClipboard(S.amsp.agentPrompt(guide))) setCopied(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-5 text-sm font-semibold whitespace-nowrap text-gray-900 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
      >
        {copied ? (
          <CheckIcon className="site-copy-done h-4 w-4" />
        ) : (
          <TerminalIcon className="h-4 w-4" />
        )}
        {S.amsp.copyPrompt}
      </button>
      <span role="status" className="sr-only">
        {copied ? S.amsp.copied : ""}
      </span>
    </>
  );
}

export function AmspHero() {
  const facts = [
    { value: ENVELOPE_COUNT, label: S.amsp.facts.envelopes },
    { value: STORED_KIND_COUNT, label: S.amsp.facts.records },
    { value: STREAM_COUNT, label: S.amsp.facts.streams },
  ];
  return (
    <section className="relative overflow-hidden">
      <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 pt-12 pb-14 sm:px-6 sm:pt-16 lg:pt-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-12">
        <div className="min-w-0">
          <p className="anim-rise flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}penguin-logo.svg`}
              alt=""
              className="h-10 w-10 shrink-0"
            />
            <span className="text-lg font-semibold tracking-tight sm:text-xl">
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
            className="anim-rise mt-6 text-4xl leading-[1.15] font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-5xl lg:text-[2.6rem]"
            style={{ animationDelay: "60ms" }}
          >
            {S.amsp.headline}
          </h1>
          <p
            className="anim-rise mt-5 text-base leading-7 text-pretty text-gray-600 sm:text-lg sm:leading-8 lg:text-base lg:leading-7 dark:text-gray-300"
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
            className="anim-rise mt-7 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "180ms" }}
          >
            <a
              href={`${DOCS_URL}amsp/`}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-semibold whitespace-nowrap text-white shadow-sm transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              {S.amsp.reference}
              <ArrowRightIcon className="h-4 w-4" />
            </a>
            <CopyPromptButton />
          </div>

          <ul
            className="anim-rise mt-10 grid grid-cols-3 gap-4 border-t border-gray-200 pt-6 dark:border-gray-800"
            style={{ animationDelay: "240ms" }}
          >
            {facts.map((fact) => (
              <li key={fact.label} className="min-w-0">
                <span className="block text-2xl leading-none font-semibold tracking-tight text-brand-600 tabular-nums dark:text-brand-300">
                  {fact.value}
                </span>
                <span className="mt-2 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {fact.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="anim-rise min-w-0" style={{ animationDelay: "120ms" }}>
          <StreamPlayer />
        </div>
      </div>
    </section>
  );
}
