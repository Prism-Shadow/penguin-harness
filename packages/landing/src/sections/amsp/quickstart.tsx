/**
 * Three steps to a first run: turn the agent's API on in the Web App, run it with curl (and what
 * comes back, cut from the scripted first-request run), or from TypeScript with the SDK. The code is
 * lib/amsp-quickstart.ts; the TypeScript is highlighted, the shell commands are code cards. Every
 * block wraps a line too long for its column instead of scrolling it out of view.
 */
import type { ReactNode } from "react";
import { highlightSiteCode, SiteCodeBlock } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { DOCS_URL } from "../../lib/links";
import { SCENARIOS } from "../../lib/amsp-demo";
import { CURL_RUN, SDK_EXAMPLE, SDK_INSTALL, responseExcerpt } from "../../lib/amsp-quickstart";
import { Section } from "../../components/section";
import { CodeCard } from "../../components/code-card";

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
        <Step index={2} title={Q.curl.title}>
          <CodeCard code={CURL_RUN} label="curl" className="amsp-wrap" />
          <CodeCard code={response} label={Q.curl.response} className="amsp-wrap" />
          <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{Q.curl.note}</p>
        </Step>
        <Step index={3} title={Q.sdk.title}>
          <CodeCard code={SDK_INSTALL} label="npm" className="amsp-wrap" />
          <div className="amsp-code overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
            <SiteCodeBlock code={SDK_EXAMPLE} language="typescript" highlight={highlightSiteCode} />
          </div>
        </Step>
      </ol>
    </Section>
  );
}
