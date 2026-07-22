/**
 * Use-case gallery as switchable tabs — the RAG docs expert and the penguin sled
 * game, each shown as its FINISHED PRODUCT (mockup shots matched to the visitor's
 * locale and theme) under its condensed one-sentence prompt. Tab order follows
 * S.cases.tabs; CASE_SHOTS is index-aligned with it. A tab may carry a `cost`
 * line (the RAG one does) — an emphasized token-cost hook under the caption.
 */
import { useState } from "react";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import { demoVideoUrl } from "../lib/links";
import ragAppZhLight from "../assets/rag-app-zh-light.webp";
import ragAppZhDark from "../assets/rag-app-zh-dark.webp";
import ragAppEnLight from "../assets/rag-app-en-light.webp";
import ragAppEnDark from "../assets/rag-app-en-dark.webp";
import gameZhLight from "../assets/game-zh-light.webp";
import gameZhDark from "../assets/game-zh-dark.webp";
import gameEnLight from "../assets/game-en-light.webp";
import gameEnDark from "../assets/game-en-dark.webp";

type ShotSet = Record<Locale, { light: string; dark: string }>;

/**
 * Demo recording for a case, index-aligned with S.cases.tabs; null where the finished
 * product is still shown as a still. The community-hosted file only downloads on play
 * (preload="none"), and the matching screenshot doubles as the poster — so a video tab
 * costs a visitor exactly what an image tab already did until they press play.
 */
const CASE_VIDEOS: Array<Record<Locale, string> | null> = [
  { zh: demoVideoUrl("rag_zh"), en: demoVideoUrl("rag_en") },
  null,
];

/** Finished-product shots, index-aligned with S.cases.tabs. */
const CASE_SHOTS: ShotSet[] = [
  {
    zh: { light: ragAppZhLight, dark: ragAppZhDark },
    en: { light: ragAppEnLight, dark: ragAppEnDark },
  },
  {
    zh: { light: gameZhLight, dark: gameZhDark },
    en: { light: gameEnLight, dark: gameEnDark },
  },
];

export function Cases() {
  const { locale } = useLocale();
  const tabs = S.cases.tabs;
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0]!;
  const shots = (CASE_SHOTS[active] ?? CASE_SHOTS[0]!)[locale];
  const video = (CASE_VIDEOS[active] ?? null)?.[locale];

  return (
    <Section id="cases" eyebrow={S.cases.eyebrow} title={S.cases.title} subtitle={S.cases.subtitle}>
      <div
        role="tablist"
        aria-label={S.cases.eyebrow}
        className="flex flex-wrap justify-center gap-2"
      >
        {tabs.map((t, i) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              i === active
                ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <figure role="tabpanel" className="anim-fade mx-auto mt-8 max-w-5xl" key={tab.label}>
        <div className="mx-auto mb-5 w-fit max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900">
          <code className="font-mono text-[13px] whitespace-nowrap text-gray-800 dark:text-gray-200">
            <span className="mr-2 text-gray-400 select-none dark:text-gray-500">&gt;</span>
            {tab.prompt}
          </code>
        </div>
        <BrowserFrame>
          {/* Light/dark are two elements rather than one with a swapped source: a <video>
              takes a single poster, and the theme-matched still is what stands in for the
              recording before play. Only the visible one's poster is ever fetched. */}
          {video ? (
            <>
              <video
                src={video}
                poster={shots.light}
                controls
                preload="none"
                playsInline
                aria-label={tab.caption}
                className="block h-auto w-full bg-gray-950 dark:hidden"
              />
              <video
                src={video}
                poster={shots.dark}
                controls
                preload="none"
                playsInline
                aria-label={tab.caption}
                className="hidden h-auto w-full bg-gray-950 dark:block"
              />
            </>
          ) : (
            <>
              <img
                src={shots.light}
                alt={tab.caption}
                loading="lazy"
                className="block h-auto w-full dark:hidden"
              />
              <img
                src={shots.dark}
                alt={tab.caption}
                loading="lazy"
                className="hidden h-auto w-full dark:block"
              />
            </>
          )}
        </BrowserFrame>
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {tab.caption}
        </figcaption>
        {tab.cost && (
          <p className="mt-2 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
            {tab.cost}
          </p>
        )}
      </figure>
    </Section>
  );
}
