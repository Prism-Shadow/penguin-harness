/**
 * The one persuasion section: three NUMBERED reasons in deliberate order —
 * (1) better results at lower cost on complex tasks (benchmark suites),
 * (2) an Agent builds your Agent app from one sentence (real demo shot),
 * (3) self-evolution (loop diagram; demo video coming later). The numbers are
 * rendered as large chips so the progression reads as one argument, not three
 * unrelated features. Reason 1 keeps the #benchmark anchor for old deep links.
 */
import type { ReactNode } from "react";
import { S } from "../lib/strings";
import { Section } from "../components/section";
import { BrowserFrame } from "../components/browser-frame";
import { BenchmarkSuites } from "./benchmark";
import { SelfImproveLoop } from "./self-improve";
import ragDemoLight from "../assets/rag-demo-light.webp";
import ragDemoDark from "../assets/rag-demo-dark.webp";

/** One-sentence demo prompt (code is code — shared across languages). */
const DEMO_PROMPT =
  "Build a RAG app that answers questions over the Markdown files in docs/ with citations.";

function Reason({
  index,
  id,
  title,
  desc,
  children,
}: {
  index: number;
  id?: string;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-20">
      <div className="mx-auto mb-8 max-w-3xl text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gray-900 font-mono text-lg font-semibold text-white dark:bg-gray-100 dark:text-gray-900"
        >
          {index}
        </span>
        <h3 className="mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h3>
        <p className="mt-3 leading-7 text-pretty text-gray-600 dark:text-gray-400">{desc}</p>
      </div>
      {children}
    </div>
  );
}

export function Why() {
  return (
    <Section id="why" eyebrow={S.why.eyebrow} title={S.why.title} subtitle={S.why.subtitle}>
      <div className="flex flex-col gap-20 sm:gap-24">
        <Reason id="benchmark" index={1} title={S.why.reason1Title} desc={S.why.reason1Desc}>
          <BenchmarkSuites />
        </Reason>

        <Reason index={2} title={S.why.reason2Title} desc={S.why.reason2Desc}>
          <figure className="mx-auto max-w-5xl">
            <div className="mx-auto mb-5 w-fit max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900">
              <code className="font-mono text-[13px] whitespace-nowrap text-gray-800 dark:text-gray-200">
                <span className="mr-2 text-gray-400 select-none dark:text-gray-500">&gt;</span>
                {DEMO_PROMPT}
              </code>
            </div>
            <BrowserFrame>
              <img
                src={ragDemoLight}
                alt={S.why.reason2Caption}
                loading="lazy"
                className="block h-auto w-full dark:hidden"
              />
              <img
                src={ragDemoDark}
                alt={S.why.reason2Caption}
                loading="lazy"
                className="hidden h-auto w-full dark:block"
              />
            </BrowserFrame>
            <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
              {S.why.reason2Caption}
            </figcaption>
          </figure>
        </Reason>

        <Reason index={3} title={S.why.reason3Title} desc={S.why.reason3Desc}>
          <SelfImproveLoop />
          <p className="mt-6 text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-1 text-[13px] text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
              {S.why.videoSoon}
            </span>
          </p>
        </Reason>
      </div>
    </Section>
  );
}
