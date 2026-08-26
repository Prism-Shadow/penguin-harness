/** Desktop-first quick start with separate paths for installation, Web UI, and CLI use. */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { ReactNode } from "react";
import { S } from "../lib/strings";
import { INSTALL_CMD, INSTALL_CMD_WINDOWS, OFFLINE_INSTALL_CMDS, RELEASES_URL } from "../lib/links";
import { Section } from "../components/section";
import { CodeCard } from "../components/code-card";
import {
  ArrowRightIcon,
  DownloadIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PlayIcon,
  TerminalIcon,
} from "../components/icons";

type Mode = "desktop" | "install" | "web" | "cli";
type InstallOs = "linux" | "macos" | "windows";

const MODES: Array<{ id: Mode; icon: typeof DownloadIcon }> = [
  { id: "desktop", icon: DownloadIcon },
  { id: "install", icon: TerminalIcon },
  { id: "web", icon: MonitorIcon },
  { id: "cli", icon: PlayIcon },
];

function NumberedItem({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex gap-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white dark:bg-gray-100 dark:text-gray-900">
        {index}
      </span>
      <span>{children}</span>
    </li>
  );
}

export function Quickstart() {
  const { hash } = useLocation();
  const [mode, setMode] = useState<Mode>("desktop");
  const [os, setOs] = useState<InstallOs>("linux");

  useEffect(() => {
    const requested = hash.replace("#quickstart-", "") as Mode;
    if (MODES.some(({ id }) => id === requested)) setMode(requested);
  }, [hash]);

  const modeLabel: Record<Mode, string> = {
    desktop: S.quickstart.tabs.desktop,
    install: S.quickstart.tabs.install,
    web: S.quickstart.tabs.web,
    cli: S.quickstart.tabs.cli,
  };
  const modeBtn = (active: boolean) =>
    `inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-gray-900 text-white shadow-sm dark:bg-gray-100 dark:text-gray-900"
        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;
  const osBtn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  const installCommand = os === "windows" ? INSTALL_CMD_WINDOWS : INSTALL_CMD;

  return (
    <Section
      id="quickstart"
      eyebrow={S.quickstart.eyebrow}
      title={S.quickstart.title}
      subtitle={S.quickstart.subtitle}
    >
      <div className="mx-auto max-w-4xl">
        <div
          className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 sm:grid-cols-4 dark:border-gray-800 dark:bg-gray-900"
          role="tablist"
          aria-label={S.quickstart.eyebrow}
        >
          {MODES.map(({ id, icon: Icon }) => (
            <button
              key={id}
              id={`quickstart-${id}`}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={modeBtn(mode === id)}
              onClick={() => setMode(id)}
            >
              <Icon className="h-4 w-4" />
              {modeLabel[id]}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          key={mode}
          className="anim-fade mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
        >
          {mode === "desktop" && (
            <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[1fr_1.15fr] md:items-center">
              <div>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                  <DownloadIcon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 text-xl font-semibold tracking-tight">
                  {S.quickstart.desktop.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {S.quickstart.desktop.desc}
                </p>
                <Link
                  to="/download"
                  className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                >
                  {S.quickstart.desktop.cta}
                  <ArrowRightIcon className="h-4 w-4" />
                </Link>
              </div>
              <ol className="grid gap-4 rounded-xl bg-gray-50 p-5 dark:bg-gray-950">
                {S.quickstart.desktop.steps.map((step, index) => (
                  <NumberedItem key={step} index={index + 1}>
                    {step}
                  </NumberedItem>
                ))}
              </ol>
            </div>
          )}

          {mode === "install" && (
            <div className="p-6 sm:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="max-w-xl">
                  <h3 className="text-xl font-semibold tracking-tight">
                    {S.quickstart.install.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                    {S.quickstart.install.desc}
                  </p>
                </div>
                <div
                  className="inline-flex w-fit gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-950"
                  role="tablist"
                  aria-label={S.quickstart.install.osLabel}
                >
                  {(["linux", "macos", "windows"] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={os === key}
                      className={osBtn(os === key)}
                      onClick={() => setOs(key)}
                    >
                      {S.install[key]}
                    </button>
                  ))}
                </div>
              </div>
              <CodeCard
                code={installCommand}
                label={os === "windows" ? "PowerShell" : "curl | sh"}
                className="mt-6"
              />
              <p className="mt-4 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {S.quickstart.install.offlinePrefix}{" "}
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-600 dark:text-brand-300 dark:decoration-brand-700"
                >
                  {S.quickstart.install.offlineLink}
                  <ExternalLinkIcon className="h-3 w-3" />
                </a>
              </p>
              <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs dark:border-gray-800 dark:bg-gray-950">
                <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-300">
                  {S.quickstart.install.offlineTitle}
                </summary>
                <CodeCard
                  code={OFFLINE_INSTALL_CMDS[os]}
                  label={os === "windows" ? "PowerShell" : "shell"}
                  className="mt-3"
                />
              </details>
            </div>
          )}

          {mode === "web" && (
            <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">{S.quickstart.web.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {S.quickstart.web.desc}
                </p>
                <ol className="mt-5 grid gap-3">
                  {S.quickstart.web.steps.map((step, index) => (
                    <NumberedItem key={step} index={index + 1}>
                      {step}
                    </NumberedItem>
                  ))}
                </ol>
              </div>
              <CodeCard code={S.quickstart.web.command} label="penguin web" />
            </div>
          )}

          {mode === "cli" && (
            <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
              <div>
                <h3 className="text-xl font-semibold tracking-tight">{S.quickstart.cli.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {S.quickstart.cli.desc}
                </p>
                <p className="mt-5 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {S.quickstart.localNote}
                </p>
              </div>
              <CodeCard code={S.quickstart.cli.command} label="penguin" />
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
