/**
 * Feature section in two layers: the three features with real captures
 * (multi-session chat, trace view, agent evaluation) form switchable tabs whose
 * active panel embeds the locale/theme-matched screenshot; the remaining
 * features sit below as a plain card grid, closed by an "and more…" card.
 */
import { useState } from "react";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import {
  ActivityIcon,
  BarChartIcon,
  BotIcon,
  ClockIcon,
  MessageSquareIcon,
  PieChartIcon,
  ShareIcon,
  SparklesIcon,
  UsersIcon,
} from "../components/icons";
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
  // image loads, so switching tabs doesn't shift the page.
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

/** Icon order matches S.features.items. */
const ICONS = [
  MessageSquareIcon,
  BotIcon,
  SparklesIcon,
  ClockIcon,
  ShareIcon,
  PieChartIcon,
  ActivityIcon,
  BarChartIcon,
  UsersIcon,
];

/** Item indexes with a real capture, in tab order. */
const SHOT_TABS: Array<{ index: number; shot: keyof typeof SHOTS }> = [
  { index: 0, shot: "chat" },
  { index: 6, shot: "traces" },
  { index: 7, shot: "benchmark" },
];

/** The rest of the grid, in the original item order. */
const PLAIN_INDEXES = [1, 2, 3, 4, 5, 8];

export function Features() {
  const [active, setActive] = useState(0);
  const tab = SHOT_TABS[active] ?? SHOT_TABS[0]!;
  const item = S.features.items[tab.index]!;

  return (
    <Section
      id="features"
      eyebrow={S.features.eyebrow}
      title={S.features.title}
      subtitle={S.features.subtitle}
    >
      <div
        role="tablist"
        aria-label={S.features.eyebrow}
        className="flex flex-wrap justify-center gap-2"
      >
        {SHOT_TABS.map((t, i) => {
          const tabItem = S.features.items[t.index]!;
          const TabIcon = ICONS[t.index] ?? SparklesIcon;
          const activeTab = i === active;
          return (
            <button
              key={t.shot}
              type="button"
              role="tab"
              aria-selected={activeTab}
              onClick={() => setActive(i)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
                activeTab
                  ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-900"
              }`}
            >
              <TabIcon className="h-3.5 w-3.5 shrink-0" />
              {tabItem.title}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="anim-fade mx-auto mt-6 max-w-5xl" key={tab.shot}>
        {/* Centered feature text above the shot — the tab chip already names it. */}
        <p className="mx-auto mb-5 max-w-2xl text-center text-sm leading-6 text-gray-600 dark:text-gray-400">
          {item.desc}
        </p>
        <BrowserFrame>
          <ThemedShot set={SHOTS[tab.shot]} alt={item.title} />
        </BrowserFrame>
      </div>

      {/* Features without a capture: the classic card grid, closed by "and more…". */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PLAIN_INDEXES.map((index) => {
          const plain = S.features.items[index]!;
          const IconCmp = ICONS[index] ?? SparklesIcon;
          return (
            <article
              key={plain.title}
              className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
            >
              {/* Oversized faint icon as the card backdrop (decorative). */}
              <IconCmp
                strokeWidth={1.25}
                className="pointer-events-none absolute -right-5 -bottom-5 h-26 w-26 text-gray-100 dark:text-gray-800"
              />
              <h3 className="relative text-[15px] font-semibold tracking-tight">{plain.title}</h3>
              <p className="relative mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                {plain.desc}
              </p>
            </article>
          );
        })}
        <article className="flex items-center justify-center rounded-xl border border-dashed border-gray-300 p-5 text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500">
          {S.features.more}
        </article>
      </div>
    </Section>
  );
}
