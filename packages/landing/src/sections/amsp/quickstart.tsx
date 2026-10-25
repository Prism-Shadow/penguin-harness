/**
 * Two steps to a first run: turn the agent's API on in the Web App, then run it — from TypeScript
 * with the SDK (the tab shown first) or with curl, and what comes back, cut from the scripted
 * first-request run. Beside the tabs, the hero's button copies the prompt that hands this to a
 * coding agent. The code is lib/amsp-quickstart.ts; the TypeScript is highlighted, the shell
 * commands are code cards, and every block wraps a line too long for its column instead of
 * scrolling it out of view.
 */
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { highlightSiteCode, SiteCodeBlock } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL } from "../../lib/links";
import { SCENARIOS } from "../../lib/amsp-demo";
import { CURL_RUN, SDK_EXAMPLE, SDK_INSTALL, responseExcerpt } from "../../lib/amsp-quickstart";
import { Section } from "../../components/section";
import { CodeCard } from "../../components/code-card";
import { CopyPromptButton } from "../../components/copy-prompt-button";

const WAYS = ["typescript", "curl"] as const;
type Way = (typeof WAYS)[number];

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <li className="grid gap-x-5 gap-y-3 md:grid-cols-[1.75rem_minmax(0,1fr)]">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
        {index}
      </span>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <div className="mt-3 space-y-3">{children}</div>
      </div>
    </li>
  );
}

export function AmspQuickstart() {
  const Q = S.amsp.quickstart;
  const response = responseExcerpt(SCENARIOS[0]!.steps, 3, 3, Q.curl.elided);
  const [way, setWay] = useState<Way>("typescript");
  const tabsId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (WAYS.indexOf(way) + step + WAYS.length) % WAYS.length;
    setWay(WAYS[next]!);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };

  return (
    <Section id="quickstart" title={Q.title}>
      <ol className="mx-auto max-w-4xl space-y-12">
        <Step index={1} title={Q.enable.title}>
          <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{Q.enable.text}</p>
          <a
            href={`${DOCS_URL}agent-api/`}
            className="inline-flex items-center text-sm font-medium text-brand-700 underline-offset-4 hover:underline dark:text-brand-300"
          >
            {Q.enable.link}
          </a>
        </Step>
        <Step index={2} title={Q.run.title}>
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-gray-200 dark:border-gray-800">
            <div
              ref={tabsRef}
              role="tablist"
              aria-label={Q.run.label}
              className="flex gap-1"
              onKeyDown={onTabKey}
            >
              {WAYS.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  role="tab"
                  id={`${tabsId}-tab-${candidate}`}
                  aria-controls={`${tabsId}-panel`}
                  aria-selected={candidate === way}
                  tabIndex={candidate === way ? 0 : -1}
                  onClick={() => setWay(candidate)}
                  className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-gray-500 transition-colors hover:text-gray-900 aria-selected:border-brand-600 aria-selected:font-medium aria-selected:text-brand-700 dark:text-gray-400 dark:hover:text-gray-100 dark:aria-selected:border-brand-400 dark:aria-selected:text-brand-300"
                >
                  {Q.run[candidate]}
                </button>
              ))}
            </div>
            <div className="pb-2">
              <CopyPromptButton compact />
            </div>
          </div>
          <div
            role="tabpanel"
            id={`${tabsId}-panel`}
            aria-labelledby={`${tabsId}-tab-${way}`}
            className="space-y-3"
          >
            {way === "typescript" ? (
              <>
                <CodeCard code={SDK_INSTALL} label="npm" className="amsp-wrap" />
                <div className="amsp-code overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
                  <SiteCodeBlock
                    code={SDK_EXAMPLE}
                    language="typescript"
                    highlight={highlightSiteCode}
                  />
                </div>
              </>
            ) : (
              <>
                <CodeCard code={CURL_RUN} label="curl" className="amsp-wrap" />
                <CodeCard code={response} label={Q.curl.response} className="amsp-wrap" />
              </>
            )}
          </div>
        </Step>
      </ol>
    </Section>
  );
}
