/** Product-first hero with one visible install path at a time. */
import { useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { INSTALL_CMD, INSTALL_CMD_WINDOWS } from "../lib/links";
import { detectPlatform } from "../lib/platform";
import { ArrowRightIcon, DownloadIcon, TerminalIcon } from "../components/icons";
import { CopyButton } from "../components/copy-button";

type InstallMode = "desktop" | "cli";

export function Hero() {
  const [mode, setMode] = useState<InstallMode>("desktop");
  const detected = detectPlatform();
  const downloadLabel = detected
    ? S.hero.downloadCtaFor(S.download.platforms[detected].name)
    : S.hero.downloadCta;
  const installCommand = detected === "windows" ? INSTALL_CMD_WINDOWS : INSTALL_CMD;
  const installShell = detected === "windows" ? "PowerShell" : "Terminal";

  const modeButton = (active: boolean) =>
    `inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors ${
      active
        ? "bg-gray-900 text-white shadow-sm dark:bg-gray-100 dark:text-gray-900"
        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  return (
    <section className="relative overflow-hidden border-b border-gray-200/70 dark:border-gray-800/70">
      <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-14 text-center sm:px-6 sm:pt-24 sm:pb-20">
        <h1 className="anim-rise flex items-center justify-center gap-3.5">
          <img
            src={`${import.meta.env.BASE_URL}penguin-logo.svg`}
            alt=""
            className="h-14 w-14 sm:h-16 sm:w-16"
          />
          <span className="text-3xl font-semibold tracking-tight sm:text-4xl">{S.siteName}</span>
        </h1>

        <p
          className="anim-rise mx-auto mt-7 whitespace-nowrap text-[clamp(0.95rem,4.3vw,3rem)] leading-tight font-semibold tracking-[-0.035em]"
          style={{ animationDelay: "70ms" }}
        >
          {S.hero.eyebrow}
        </p>

        <p
          className="anim-rise mt-4 text-sm text-gray-600 sm:text-base dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.subtitle}
        </p>

        <div
          className="anim-rise mx-auto mt-7 inline-flex rounded-xl border border-gray-200 bg-white/90 p-1 shadow-sm dark:border-gray-800 dark:bg-gray-900/90"
          role="tablist"
          aria-label={S.quickstart.eyebrow}
          style={{ animationDelay: "170ms" }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "desktop"}
            className={modeButton(mode === "desktop")}
            onClick={() => setMode("desktop")}
          >
            <DownloadIcon className="h-4 w-4" />
            {S.quickstart.tabs.desktop}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "cli"}
            className={modeButton(mode === "cli")}
            onClick={() => setMode("cli")}
          >
            <TerminalIcon className="h-4 w-4" />
            {S.quickstart.tabs.install}
          </button>
        </div>

        <div
          className="anim-rise mx-auto mt-4 flex min-h-14 max-w-2xl items-start justify-center"
          style={{ animationDelay: "220ms" }}
        >
          {mode === "desktop" ? (
            <Link
              to="/download"
              role="tabpanel"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-gray-900 px-6 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              <DownloadIcon className="h-4 w-4" />
              {downloadLabel}
            </Link>
          ) : (
            <div role="tabpanel" className="w-full">
              <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950 text-left shadow-lg shadow-gray-950/5">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
                  <span className="inline-flex items-center gap-2 text-xs text-gray-400">
                    <TerminalIcon className="h-3.5 w-3.5" />
                    {installShell}
                  </span>
                  <CopyButton
                    text={installCommand}
                    className="border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white dark:border-white/10 dark:bg-white/5"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3 px-4 py-4 font-mono text-[13px] sm:text-sm">
                  <span className="shrink-0 text-brand-400">$</span>
                  <code className="min-w-0 overflow-x-auto whitespace-nowrap text-gray-100">
                    {installCommand}
                  </code>
                </div>
              </div>
              <Link
                to="/#quickstart-install"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-600 dark:text-brand-300"
              >
                {S.download.cliHintLink}
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}
        </div>

        <dl
          className="anim-rise mx-auto mt-11 grid max-w-5xl grid-cols-2 overflow-hidden rounded-2xl border border-gray-200 bg-white/80 text-left shadow-sm lg:grid-cols-4 dark:border-gray-800 dark:bg-gray-900/75"
          style={{ animationDelay: "270ms" }}
        >
          {S.hero.stats.map((stat, index) => (
            <div
              key={stat.value}
              className={`px-4 py-4 sm:px-5 ${index > 1 ? "border-t border-gray-200 dark:border-gray-800" : ""} ${
                index % 2 === 1 ? "border-l border-gray-200 dark:border-gray-800" : ""
              } ${index > 0 ? "lg:border-l lg:border-gray-200 lg:dark:border-gray-800" : ""} ${
                index > 1 ? "lg:border-t-0" : ""
              }`}
            >
              <dt className="text-sm font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {stat.value}
              </dt>
              <dd className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
