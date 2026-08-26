/**
 * Product-first hero: one promise, two install paths, then four compact proof points.
 * The command stays visible like a terminal-native product, while the desktop path remains
 * the primary action and resolves the actual artifact on /download.
 */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { INSTALL_CMD, INSTALL_CMD_WINDOWS } from "../lib/links";
import { detectPlatform } from "../lib/platform";
import { ArrowRightIcon, DownloadIcon, TerminalIcon } from "../components/icons";
import { CopyButton } from "../components/copy-button";

export function Hero() {
  const detected = detectPlatform();
  const downloadLabel = detected
    ? S.hero.downloadCtaFor(S.download.platforms[detected].name)
    : S.hero.downloadCta;
  const installCommand = detected === "windows" ? INSTALL_CMD_WINDOWS : INSTALL_CMD;
  const installShell = detected === "windows" ? "PowerShell" : "Terminal";

  return (
    <section className="relative overflow-hidden border-b border-gray-200/70 dark:border-gray-800/70">
      <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24 sm:pb-20">
        <div className="mx-auto max-w-5xl text-center">
          <p className="anim-rise inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50/80 px-3 py-1.5 text-xs font-semibold tracking-wide text-brand-700 dark:border-brand-800 dark:bg-brand-950/70 dark:text-brand-200">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
            {S.hero.eyebrow}
          </p>

          <h1
            className="anim-rise mx-auto mt-7 max-w-5xl text-4xl leading-[1.08] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl"
            style={{ animationDelay: "70ms" }}
          >
            {S.hero.titleLead}
            <span className="whitespace-nowrap text-brand-600 dark:text-brand-300">
              {S.hero.titleAccent}
            </span>
            {S.hero.titleTail}
          </h1>

          <p
            className="anim-rise mx-auto mt-6 max-w-2xl text-base leading-7 text-pretty text-gray-600 sm:text-lg dark:text-gray-300"
            style={{ animationDelay: "130ms" }}
          >
            {S.hero.subtitle}
          </p>

          <div
            className="anim-rise mt-8 flex flex-wrap items-center justify-center gap-3"
            style={{ animationDelay: "190ms" }}
          >
            <Link
              to="/download"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-gray-900 px-6 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              <DownloadIcon className="h-4 w-4" />
              {downloadLabel}
            </Link>
            <Link
              to="/#quickstart-install"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-gray-200 bg-white/90 px-6 text-sm font-semibold text-gray-900 transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              <TerminalIcon className="h-4 w-4" />
              {S.hero.cliInstall}
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>

          <div
            className="anim-rise mx-auto mt-7 max-w-2xl overflow-hidden rounded-xl border border-gray-200 bg-gray-950 text-left shadow-lg shadow-gray-950/5 dark:border-gray-800"
            style={{ animationDelay: "240ms" }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
              <span className="inline-flex items-center gap-2 text-xs text-gray-400">
                <TerminalIcon className="h-3.5 w-3.5" />
                {installShell} · {S.hero.cliInstall}
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

          <p
            className="anim-rise mt-3 text-xs text-gray-500 dark:text-gray-400"
            style={{ animationDelay: "270ms" }}
          >
            {S.hero.installHint}
          </p>
        </div>

        <dl
          className="anim-rise mx-auto mt-12 grid max-w-5xl grid-cols-2 overflow-hidden rounded-2xl border border-gray-200 bg-white/80 shadow-sm sm:grid-cols-4 dark:border-gray-800 dark:bg-gray-900/75"
          style={{ animationDelay: "310ms" }}
        >
          {S.hero.stats.map((stat, index) => (
            <div
              key={stat.label}
              className={`px-4 py-5 text-left sm:px-5 ${
                index % 2 === 1 ? "border-l border-gray-200 dark:border-gray-800" : ""
              } ${index > 0 ? "sm:border-l sm:border-gray-200 sm:dark:border-gray-800" : ""} ${
                index >= 2 ? "border-t border-gray-200 sm:border-t-0 dark:border-gray-800" : ""
              }`}
            >
              <dd className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {stat.value}
              </dd>
              <dt className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {stat.label}
              </dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
