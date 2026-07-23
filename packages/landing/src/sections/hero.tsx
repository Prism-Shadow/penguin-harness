/**
 * Hero: enlarged logo + product name, the slogan inside the pill badge, then the
 * two-line comparison headline (the LangChain 1× baseline over the PenguinHarness
 * 100× answer, each sentence on its own line), the tagline line, the install
 * one-liner and stats.
 */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { INSTALL_CMD, REPO_URL } from "../lib/links";
import { CopyButton } from "../components/copy-button";
import { ArrowRightIcon, GitHubIcon } from "../components/icons";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-16 text-center sm:px-6 sm:pt-24 sm:pb-20">
        <div className="anim-rise flex items-center justify-center gap-3.5">
          <img
            src={`${import.meta.env.BASE_URL}penguin-logo.svg`}
            alt=""
            className="h-14 w-14 sm:h-16 sm:w-16"
          />
          <span className="text-3xl font-semibold tracking-tight sm:text-4xl">{S.siteName}</span>
        </div>
        <p
          className="anim-rise mx-auto mt-6 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3.5 py-1 text-[13px] text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400"
          style={{ animationDelay: "40ms" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" />
          {S.hero.badge}
        </p>
        {/* Two block lines rather than one balanced run: the 1×/100× contrast only lands
            when each sentence owns a line (they still wrap internally on narrow screens). */}
        {/* tracking-tighter (not -tight): buys the ~50px that keeps the longer English
            sentence on a single line at desktop widths (content max 1104px). */}
        <h1
          className="anim-rise mx-auto mt-6 max-w-full text-2xl font-semibold tracking-tighter sm:text-4xl"
          style={{ animationDelay: "80ms" }}
        >
          <span className="block text-balance text-gray-500 dark:text-gray-400">
            {S.hero.titleLine1}
          </span>
          <span className="mt-1 block text-balance">{S.hero.titleLine2}</span>
        </h1>

        <p
          className="anim-rise mx-auto mt-6 max-w-2xl text-base font-medium text-balance text-gray-600 sm:text-lg dark:text-gray-300"
          style={{ animationDelay: "140ms" }}
        >
          {S.hero.tagline}
        </p>

        <div
          className="anim-rise mt-8 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "200ms" }}
        >
          <Link
            to="/#quickstart"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {S.hero.ctaPrimary}
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <GitHubIcon className="h-4 w-4" />
            {S.hero.ctaGithub}
          </a>
        </div>

        <div
          className="anim-rise mx-auto mt-10 w-fit max-w-full"
          style={{ animationDelay: "240ms" }}
        >
          <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 py-2.5 pr-2.5 pl-4 text-left dark:border-gray-800 dark:bg-gray-900">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap text-gray-800 dark:text-gray-200">
              <span className="mr-2 text-gray-400 select-none dark:text-gray-500">$</span>
              {INSTALL_CMD}
            </code>
            <CopyButton text={INSTALL_CMD} className="shrink-0" />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{S.hero.installHint}</p>
        </div>

        <dl
          className="anim-rise mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4"
          style={{ animationDelay: "280ms" }}
        >
          {S.hero.stats.map((s) => (
            <div key={s.label}>
              <dt className="order-last mt-1 text-xs text-gray-500 dark:text-gray-400">
                {s.label}
              </dt>
              <dd className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
