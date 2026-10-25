/**
 * Product-first hero: the slogan, the subtitle in grey, two direct installation paths, three stat
 * tiles (the small label over the big value), three catalogue rows (supported models,
 * self-evolution algorithms, Benchmarks) each led by its count, whose outside links confirm
 * before they open (the models row's closing "and more" links to MMSP's model index), and then
 * the app itself, live: the start page in a frame. What the rows list, and where each entry
 * links, is lib/rsi-stats.ts; the algorithm and Benchmark counts are those lists' lengths.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { mmspModelsUrl } from "../lib/links";
import { RELEASE_VERSION } from "../lib/version";
import { BENCHMARKS, MODEL_PROVIDERS, RSI_TOOLKITS } from "../lib/rsi-stats";
import {
  DownloadIcon,
  ExternalLinkIcon,
  ModelProviderLogo,
  TerminalIcon,
} from "../components/icons";
import { ExternalLink, ExternalLinkScope } from "../components/external-link";
import { LiveAppFrame } from "../components/live-app-frame";

/**
 * An entry of a text catalogue row: plain text on the page, no box of its own — the row is a
 * list, read the way the model logos beside it are.
 */
const ENTRY = "inline-flex items-center gap-1 text-sm font-medium text-gray-700 dark:text-gray-300";

/** An entry that links out: the same text, underlined on hover, with the outside-link mark. */
const ENTRY_LINK = `${ENTRY} underline-offset-4 decoration-gray-300 transition-colors hover:text-gray-950 hover:underline dark:decoration-gray-600 dark:hover:text-white`;

/**
 * One row of the catalogue, led by its count: the count and label above the items on phones;
 * from `sm` up, they share the catalogue's two columns (subgrid), the count-and-label column
 * aligned left so the three counts line up.
 */
function CatalogRow({
  count,
  label,
  delay,
  listClassName,
  children,
}: {
  count: string;
  label: string;
  delay: number;
  listClassName: string;
  children: ReactNode;
}) {
  return (
    <div
      className="anim-rise flex flex-col items-center sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-center"
      style={{ animationDelay: `${delay}ms` }}
    >
      <dt className="flex items-baseline gap-2 sm:text-left">
        <span className="text-2xl leading-none font-semibold tracking-tight text-brand-600 tabular-nums dark:text-brand-300">
          {count}
        </span>
        <span className="text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </span>
      </dt>
      {/* Spaced by margin, not `gap`: a gap on the subgrid would override the catalogue's own. */}
      <dd className="mt-2.5 sm:mt-0">
        <ul
          className={`flex flex-wrap items-center justify-center sm:justify-start ${listClassName}`}
        >
          {children}
        </ul>
      </dd>
    </div>
  );
}

export function Hero() {
  const { locale } = useSiteLocale();
  return (
    <section className="relative overflow-hidden">
      <div className="hero-dots pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl px-4 pt-12 pb-12 text-center sm:px-6 sm:pt-24 sm:pb-14">
        <h1 className="anim-rise flex items-center justify-center gap-2.5 sm:gap-3.5">
          <img
            src={`${import.meta.env.BASE_URL}penguin-logo.svg`}
            alt=""
            className="h-12 w-12 sm:h-16 sm:w-16"
          />
          <span className="text-[1.7rem] font-semibold tracking-tight sm:text-4xl">
            {S.siteName}
          </span>
        </h1>

        <p
          className="hero-positioning anim-rise mx-auto mt-6 leading-tight font-semibold tracking-[-0.035em] text-balance break-keep [overflow-wrap:break-word]"
          style={{ animationDelay: "70ms" }}
        >
          {S.hero.positioning}
        </p>

        <p
          className="hero-automation anim-rise mt-5 leading-6 text-balance break-keep text-gray-600 [overflow-wrap:break-word] sm:leading-8 dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.subtitle}
        </p>

        <div
          className="anim-rise mt-7 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "170ms" }}
        >
          <Link
            to="/download"
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-gray-900 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            <DownloadIcon className="h-4 w-4" />
            <span>{S.hero.downloadCta}</span>
            <span className="border-l border-white/25 pl-2 text-xs font-medium text-white/70 tabular-nums dark:border-gray-900/20 dark:text-gray-900/60">
              {RELEASE_VERSION}
            </span>
          </Link>
          <Link
            to="/#quickstart-install"
            className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <TerminalIcon className="h-4 w-4" />
            {S.hero.cliInstall}
          </Link>
        </div>

        <dl
          className="anim-rise mx-auto mt-10 grid max-w-5xl gap-y-5 sm:mt-12 sm:grid-cols-3 sm:gap-x-6"
          style={{ animationDelay: "250ms" }}
        >
          {S.hero.stats.map((stat) => (
            <div key={stat.value} className="min-w-0">
              <dt className="mx-auto mt-1 max-w-64 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {stat.label}
              </dt>
              <dd className="hero-stat-value mx-auto mt-0.5 text-xl leading-tight font-semibold tracking-tight text-balance text-gray-900 sm:text-[22px] dark:text-gray-100">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <ExternalLinkScope>
          <dl className="mx-auto mt-10 grid w-fit max-w-full gap-y-6 sm:mt-12 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-4">
            <CatalogRow
              count={S.hero.supportedModelsCount}
              label={S.hero.supportedModelsLabel}
              delay={300}
              listClassName="gap-x-2 gap-y-1"
            >
              {MODEL_PROVIDERS.map((provider) => (
                <li key={provider.id}>
                  <ExternalLink
                    href={provider.href}
                    aria-label={provider.name}
                    title={provider.name}
                    className="inline-flex rounded-md p-1 text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    <ModelProviderLogo provider={provider.id} className="h-6 w-6" />
                  </ExternalLink>
                </li>
              ))}
              <li className="ml-1">
                <ExternalLink href={mmspModelsUrl(locale)} className={ENTRY_LINK}>
                  {S.hero.supportedModelsMore}
                  <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                </ExternalLink>
              </li>
            </CatalogRow>

            <CatalogRow
              count={String(RSI_TOOLKITS.length)}
              label={S.hero.algorithmsLabel}
              delay={340}
              listClassName="gap-x-5 gap-y-1.5"
            >
              {RSI_TOOLKITS.map((toolkit) => (
                <li key={toolkit.plugin}>
                  {toolkit.href !== null ? (
                    <ExternalLink href={toolkit.href} className={ENTRY_LINK}>
                      {toolkit.label}
                      <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                    </ExternalLink>
                  ) : (
                    <span className={ENTRY}>{toolkit.label}</span>
                  )}
                </li>
              ))}
            </CatalogRow>

            <CatalogRow
              count={String(BENCHMARKS.length)}
              label={S.hero.benchmarksLabel}
              delay={380}
              listClassName="gap-x-5 gap-y-1.5"
            >
              {BENCHMARKS.map((benchmark, index) => (
                <li key={benchmark.href}>
                  <ExternalLink href={benchmark.href} className={ENTRY_LINK}>
                    {S.hero.benchmarkKinds[index]}
                    <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                  </ExternalLink>
                </li>
              ))}
            </CatalogRow>
          </dl>
        </ExternalLinkScope>

        <LiveAppFrame
          surface="chat-new"
          title={S.showcase.start}
          className="anim-rise mx-auto mt-14 max-w-6xl text-left sm:mt-16"
        />
      </div>
    </section>
  );
}
