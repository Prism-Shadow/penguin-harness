/** Two-step quick start: choose installation first, then a launch mode for CLI installs. */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import type { ReactNode } from "react";
import { S } from "../lib/strings";
import {
  CLI_INSTALLERS,
  GITHUB_LATEST_DOWNLOAD,
  INSTALL_CMD,
  INSTALL_CMD_WINDOWS,
  OFFLINE_INSTALL_CMDS,
} from "../lib/links";
import { Section } from "../components/section";
import { CodeCard } from "../components/code-card";
import {
  ArrowRightIcon,
  DownloadIcon,
  MonitorIcon,
  PlayIcon,
  TerminalIcon,
} from "../components/icons";

type InstallMethod = "desktop" | "install";
type LaunchMode = "web" | "cli";
type InstallOs = "linux" | "macos" | "windows";

const INSTALL_METHODS: Array<{ id: InstallMethod; icon: typeof DownloadIcon }> = [
  { id: "desktop", icon: DownloadIcon },
  { id: "install", icon: TerminalIcon },
];

const LAUNCH_MODES: Array<{ id: LaunchMode; icon: typeof MonitorIcon }> = [
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

function StepHeading({ step, title }: { step: string; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-xs font-semibold tracking-wide text-brand-600 uppercase dark:text-brand-300">
        {step}
      </span>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
    </div>
  );
}

export function Quickstart() {
  const { hash } = useLocation();
  const [method, setMethod] = useState<InstallMethod>("desktop");
  const [launchMode, setLaunchMode] = useState<LaunchMode>("web");
  const [os, setOs] = useState<InstallOs>("linux");

  useEffect(() => {
    const requested = hash.replace("#quickstart-", "");
    if (requested === "desktop") {
      setMethod("desktop");
      return;
    }
    if (requested === "install") {
      setMethod("install");
      return;
    }
    if (requested === "web" || requested === "cli") {
      setMethod("install");
      setLaunchMode(requested);
    }
  }, [hash]);

  const installLabel: Record<InstallMethod, string> = {
    desktop: S.quickstart.tabs.desktop,
    install: S.quickstart.tabs.install,
  };
  const launchLabel: Record<LaunchMode, string> = {
    web: S.quickstart.tabs.web,
    cli: S.quickstart.tabs.cli,
  };
  const choiceBtn = (active: boolean) =>
    `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
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
        <StepHeading step={S.quickstart.stepOne} title={S.quickstart.chooseInstall} />
        <div
          className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
          role="tablist"
          aria-label={S.quickstart.chooseInstall}
        >
          {INSTALL_METHODS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              id={`quickstart-${id}`}
              type="button"
              role="tab"
              aria-selected={method === id}
              className={choiceBtn(method === id)}
              onClick={() => setMethod(id)}
            >
              <Icon className="h-4 w-4" />
              {installLabel[id]}
            </button>
          ))}
        </div>

        {method === "desktop" && (
          <div
            role="tabpanel"
            className="anim-fade mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
          >
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
          </div>
        )}

        {method === "install" && (
          <div className="anim-fade">
            <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 dark:border-gray-800 dark:bg-gray-900">
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

              <div className="mt-6 rounded-xl bg-gray-50 p-4 dark:bg-gray-950">
                <h4 className="text-sm font-semibold tracking-tight">
                  {S.quickstart.install.offlineTitle}
                </h4>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {S.quickstart.install.offlineDesc}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {CLI_INSTALLERS[os].map(({ file, variant }) => (
                    <a
                      key={file}
                      href={`${GITHUB_LATEST_DOWNLOAD}/${file}`}
                      className="flex min-w-0 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
                    >
                      <DownloadIcon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <strong className="block text-xs font-semibold">{variant}</strong>
                        <span className="block truncate font-mono text-[10px] text-gray-500 dark:text-gray-400">
                          {file}
                        </span>
                      </span>
                    </a>
                  ))}
                </div>
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer font-medium text-brand-700 dark:text-brand-300">
                    {S.quickstart.install.offlineCommand}
                  </summary>
                  <CodeCard
                    code={OFFLINE_INSTALL_CMDS[os]}
                    label={os === "windows" ? "PowerShell" : "shell"}
                    className="mt-3"
                  />
                </details>
              </div>
            </div>

            <div className="mt-10">
              <StepHeading step={S.quickstart.stepTwo} title={S.quickstart.chooseLaunch} />
              <div
                className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
                role="tablist"
                aria-label={S.quickstart.chooseLaunch}
              >
                {LAUNCH_MODES.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    id={`quickstart-${id}`}
                    type="button"
                    role="tab"
                    aria-selected={launchMode === id}
                    className={choiceBtn(launchMode === id)}
                    onClick={() => setLaunchMode(id)}
                  >
                    <Icon className="h-4 w-4" />
                    {launchLabel[id]}
                  </button>
                ))}
              </div>
            </div>

            <div
              role="tabpanel"
              key={launchMode}
              className="anim-fade mt-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              {launchMode === "web" ? (
                <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight">
                      {S.quickstart.web.title}
                    </h3>
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
              ) : (
                <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[0.9fr_1.1fr] md:items-center">
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight">
                      {S.quickstart.cli.title}
                    </h3>
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
        )}
      </div>
    </Section>
  );
}
