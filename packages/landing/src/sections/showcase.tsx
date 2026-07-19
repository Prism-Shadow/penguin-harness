/**
 * Use cases: daily tasks + zero-code AI development, illustrated with real
 * screenshots captured from the Web App with Playwright. Twelve variants — three
 * views (chat building an Agent app / trace view / evaluation center) x two UI
 * languages x two themes (WebP) — and the one shown always matches the visitor's
 * active locale and theme. Each figure carries a scenario tag.
 */
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import chatZhLight from "../assets/shots/chat-zh-light.webp";
import chatZhDark from "../assets/shots/chat-zh-dark.webp";
import chatEnLight from "../assets/shots/chat-en-light.webp";
import chatEnDark from "../assets/shots/chat-en-dark.webp";
import tracesZhLight from "../assets/shots/traces-zh-light.webp";
import tracesZhDark from "../assets/shots/traces-zh-dark.webp";
import tracesEnLight from "../assets/shots/traces-en-light.webp";
import tracesEnDark from "../assets/shots/traces-en-dark.webp";
import benchmarkZhLight from "../assets/shots/benchmark-zh-light.webp";
import benchmarkZhDark from "../assets/shots/benchmark-zh-dark.webp";
import benchmarkEnLight from "../assets/shots/benchmark-en-light.webp";
import benchmarkEnDark from "../assets/shots/benchmark-en-dark.webp";

type ShotSet = Record<Locale, { light: string; dark: string }>;

const SHOTS: Record<"chat" | "traces" | "benchmark", ShotSet> = {
  chat: {
    zh: { light: chatZhLight, dark: chatZhDark },
    en: { light: chatEnLight, dark: chatEnDark },
  },
  traces: {
    zh: { light: tracesZhLight, dark: tracesZhDark },
    en: { light: tracesEnLight, dark: tracesEnDark },
  },
  benchmark: {
    zh: { light: benchmarkZhLight, dark: benchmarkZhDark },
    en: { light: benchmarkEnLight, dark: benchmarkEnDark },
  },
};

function ThemedShot({ set, alt }: { set: ShotSet; alt: string }) {
  const { locale } = useLocale();
  const pair = set[locale];
  // Explicit intrinsic size (all shots are 1920x1200): reserves layout before the
  // image loads, so in-page anchor jumps don't drift when the showcase pops in.
  return (
    <>
      <img
        src={pair.light}
        alt={alt}
        width={1920}
        height={1200}
        loading="lazy"
        className="block h-auto w-full dark:hidden"
      />
      <img
        src={pair.dark}
        alt={alt}
        width={1920}
        height={1200}
        loading="lazy"
        className="hidden h-auto w-full dark:block"
      />
    </>
  );
}

function Caption({ tag, text }: { tag: string; text: string }) {
  return (
    <figcaption className="mt-3 flex flex-wrap items-center justify-center gap-2 text-center text-xs text-gray-500 dark:text-gray-400">
      <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 dark:border-brand-800 dark:bg-brand-950 dark:text-brand-300">
        {tag}
      </span>
      {text}
    </figcaption>
  );
}

export function Showcase() {
  return (
    <Section
      id="showcase"
      eyebrow={S.showcase.eyebrow}
      title={S.showcase.title}
      subtitle={S.showcase.subtitle}
    >
      <figure className="mx-auto max-w-5xl">
        <BrowserFrame>
          <ThemedShot set={SHOTS.chat} alt={S.showcase.captionChat} />
        </BrowserFrame>
        <Caption tag={S.showcase.tagChat} text={S.showcase.captionChat} />
      </figure>

      <div className="mx-auto mt-10 grid max-w-5xl gap-8 sm:grid-cols-2">
        <figure>
          <BrowserFrame>
            <ThemedShot set={SHOTS.traces} alt={S.showcase.captionTraces} />
          </BrowserFrame>
          <Caption tag={S.showcase.tagTraces} text={S.showcase.captionTraces} />
        </figure>
        <figure>
          <BrowserFrame>
            <ThemedShot set={SHOTS.benchmark} alt={S.showcase.captionBenchmark} />
          </BrowserFrame>
          <Caption tag={S.showcase.tagBenchmark} text={S.showcase.captionBenchmark} />
        </figure>
      </div>
    </Section>
  );
}
