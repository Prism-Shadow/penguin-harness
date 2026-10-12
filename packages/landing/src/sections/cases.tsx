/**
 * The one-sentence case: the prompt as it was typed, then the recording of the run that built a
 * RAG question-answering app from it, with a matching PenguinHarness screenshot as the poster,
 * and the Token cost of the whole build under the caption.
 */
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import { demoVideoUrl } from "../lib/links";
import chatZhLight from "../assets/shots/chat-zh-light.webp";
import chatZhDark from "../assets/shots/chat-zh-dark.webp";
import chatEnLight from "../assets/shots/chat-en-light.webp";
import chatEnDark from "../assets/shots/chat-en-dark.webp";

/**
 * The recording, per language. The community-hosted file only downloads on play
 * (preload="none"), and the poster is a still of the same conversation — so the section costs a
 * visitor one image until they press play.
 */
const VIDEO: Record<Locale, string> = { zh: demoVideoUrl("rag_zh"), en: demoVideoUrl("rag_en") };

const POSTERS: Record<Locale, { light: string; dark: string }> = {
  zh: { light: chatZhLight, dark: chatZhDark },
  en: { light: chatEnLight, dark: chatEnDark },
};

export function Cases() {
  const { locale } = useLocale();
  const posters = POSTERS[locale];
  const c = S.cases;

  return (
    <Section id="cases" eyebrow={c.eyebrow} title={c.title} subtitle={c.subtitle}>
      <figure className="mx-auto max-w-5xl">
        <div className="mx-auto mb-5 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-left sm:w-fit sm:max-w-full sm:overflow-x-auto dark:border-gray-800 dark:bg-gray-900">
          <code className="font-mono text-[12px] leading-5 whitespace-pre-wrap text-gray-800 sm:text-[13px] sm:whitespace-nowrap dark:text-gray-200">
            <span className="mr-2 text-gray-400 select-none dark:text-gray-500">&gt;</span>
            {c.prompt}
          </code>
        </div>
        <BrowserFrame>
          {/* Light and dark are two elements rather than one with a swapped source: a <video>
              takes a single poster, and the theme-matched still is what stands in for the
              recording before play. Only the visible one's poster is ever fetched. */}
          <video
            src={VIDEO[locale]}
            poster={posters.light}
            controls
            preload="none"
            playsInline
            aria-label={c.caption}
            className="block h-auto w-full bg-gray-950 dark:hidden"
          />
          <video
            src={VIDEO[locale]}
            poster={posters.dark}
            controls
            preload="none"
            playsInline
            aria-label={c.caption}
            className="hidden h-auto w-full bg-gray-950 dark:block"
          />
        </BrowserFrame>
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {c.caption}
        </figcaption>
        <p className="mt-2 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
          {c.cost}
        </p>
      </figure>
    </Section>
  );
}
