/**
 * Quick start: install, then a Web UI / CLI tab pair (Web is the default and never
 * touches the command line beyond `penguin web` — models are configured inside the
 * interface). API-key console links open in a new tab. Localized commands live in
 * the string dictionaries.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { S } from "../lib/strings";
import { DEEPSEEK_KEYS_URL, INSTALL_CMD, OPENROUTER_KEYS_URL } from "../lib/links";
import { Section } from "../components/section";
import { CodeCard } from "../components/code-card";
import {
  DownloadIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PlayIcon,
  SlidersIcon,
  TerminalIcon,
} from "../components/icons";

function Step({
  index,
  icon,
  title,
  desc,
  children,
}: {
  index: number;
  icon: ReactNode;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  return (
    <li className="relative pl-12 sm:pl-14">
      <span className="absolute top-0 left-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 sm:h-10 sm:w-10 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
        {icon}
      </span>
      <h3 className="text-base font-semibold tracking-tight">
        <span className="mr-2 text-gray-400 tabular-nums dark:text-gray-500">{index}.</span>
        {title}
      </h3>
      <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{desc}</p>
      {children && <div className="mt-3">{children}</div>}
    </li>
  );
}

/** API-key console links (open in a new tab). */
function KeyLinks() {
  const link =
    "inline-flex items-center gap-1 text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-600 dark:text-brand-300 dark:decoration-brand-700";
  return (
    <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
      {S.quickstart.getKeyPrefix}
      <a href={DEEPSEEK_KEYS_URL} target="_blank" rel="noreferrer" className={link}>
        {S.quickstart.getDeepseekKey}
        <ExternalLinkIcon className="h-3 w-3" />
      </a>
      <span className="mx-1.5">·</span>
      <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className={link}>
        {S.quickstart.getOpenrouterKey}
        <ExternalLinkIcon className="h-3 w-3" />
      </a>
    </p>
  );
}

export function Quickstart() {
  const [mode, setMode] = useState<"web" | "cli">("web");
  const [provider, setProvider] = useState<"deepseek" | "openrouter">("deepseek");

  const modeBtn = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;
  const providerBtn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  return (
    <Section
      id="quickstart"
      eyebrow={S.quickstart.eyebrow}
      title={S.quickstart.title}
      subtitle={S.quickstart.subtitle}
    >
      <div className="mx-auto max-w-3xl">
        <div
          className="mb-8 flex justify-center gap-1 rounded-lg border border-gray-200 bg-white p-1 sm:mx-auto sm:w-fit dark:border-gray-800 dark:bg-gray-900"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "web"}
            className={modeBtn(mode === "web")}
            onClick={() => setMode("web")}
          >
            <MonitorIcon className="h-4 w-4" />
            {S.quickstart.tabWeb}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "cli"}
            className={modeBtn(mode === "cli")}
            onClick={() => setMode("cli")}
          >
            <TerminalIcon className="h-4 w-4" />
            {S.quickstart.tabCli}
          </button>
        </div>

        <ol className="flex flex-col gap-10">
          <Step
            index={1}
            icon={<DownloadIcon className="h-4.5 w-4.5" />}
            title={S.quickstart.step1}
            desc={S.quickstart.step1Desc}
          >
            <CodeCard code={INSTALL_CMD} label="install" />
          </Step>

          {mode === "web" ? (
            <>
              <Step
                index={2}
                icon={<MonitorIcon className="h-4.5 w-4.5" />}
                title={S.quickstart.webStep2}
                desc={S.quickstart.webStep2Desc}
              >
                <CodeCard code={S.quickstart.webCmd} label="penguin web" />
              </Step>
              <Step
                index={3}
                icon={<SlidersIcon className="h-4.5 w-4.5" />}
                title={S.quickstart.webStep3}
                desc={S.quickstart.webStep3Desc}
              >
                <KeyLinks />
              </Step>
            </>
          ) : (
            <>
              <Step
                index={2}
                icon={<SlidersIcon className="h-4.5 w-4.5" />}
                title={S.quickstart.cliStep2}
                desc={S.quickstart.cliStep2Desc}
              >
                <div
                  className="mb-2 inline-flex gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
                  role="tablist"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={provider === "deepseek"}
                    className={providerBtn(provider === "deepseek")}
                    onClick={() => setProvider("deepseek")}
                  >
                    {S.quickstart.tabDeepseek}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={provider === "openrouter"}
                    className={providerBtn(provider === "openrouter")}
                    onClick={() => setProvider("openrouter")}
                  >
                    {S.quickstart.tabOpenrouter}
                  </button>
                </div>
                {provider === "deepseek" ? (
                  <>
                    <CodeCard code={S.quickstart.deepseekCmd} label="penguin config" />
                    <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      {S.quickstart.deepseekNote}
                    </p>
                  </>
                ) : (
                  <>
                    <CodeCard code={S.quickstart.openrouterCmd} label="penguin config" />
                    <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                      {S.quickstart.openrouterNote}
                    </p>
                  </>
                )}
                <KeyLinks />
              </Step>
              <Step
                index={3}
                icon={<PlayIcon className="h-4.5 w-4.5" />}
                title={S.quickstart.cliStep3}
                desc={S.quickstart.cliStep3Desc}
              >
                <CodeCard code={S.quickstart.runCmd} label="penguin run" />
              </Step>
            </>
          )}
        </ol>
      </div>
    </Section>
  );
}
