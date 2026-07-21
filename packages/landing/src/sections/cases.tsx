/**
 * Use-case gallery as switchable tabs — one tab per case, RAG only for now
 * (the tab bar is already plural so future cases just append). The RAG tab shows the
 * one-sentence example prompt and the finished-app shot, both in the active language.
 */
import { useState } from "react";
import { S } from "../lib/strings";
import { useLocale } from "../state/locale";
import type { Locale } from "../state/locale";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import ragAppEnLight from "../assets/rag-app-en-light.webp";
import ragAppEnDark from "../assets/rag-app-en-dark.webp";
import ragAppZhLight from "../assets/rag-app-zh-light.webp";
import ragAppZhDark from "../assets/rag-app-zh-dark.webp";

/** The real one-sentence example task, per UI language (matches the README + draft-screen card). */
const DEMO_PROMPT: Record<Locale, string> = {
  en: "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.",
  zh: "收集 https://github.com/ericbuess/claude-code-docs 的文档，做一个化身 Claude Code 配置专家、回答带来源引用的 RAG 问答应用。",
};

/** Finished-app shot per language × theme. */
const RAG_SHOT: Record<Locale, { light: string; dark: string }> = {
  en: { light: ragAppEnLight, dark: ragAppEnDark },
  zh: { light: ragAppZhLight, dark: ragAppZhDark },
};

export function Cases() {
  const { locale } = useLocale();
  const tabs = S.cases.tabs;
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0]!;
  const shot = RAG_SHOT[locale];

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
            {DEMO_PROMPT[locale]}
          </code>
        </div>
        <BrowserFrame>
          <img
            src={shot.light}
            alt={tab.caption}
            loading="lazy"
            className="block h-auto w-full dark:hidden"
          />
          <img
            src={shot.dark}
            alt={tab.caption}
            loading="lazy"
            className="hidden h-auto w-full dark:block"
          />
        </BrowserFrame>
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {tab.caption}
        </figcaption>
      </figure>
    </Section>
  );
}
