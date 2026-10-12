/**
 * Product-first hero: the positioning line, two direct installation paths, two stat tiles, and
 * three catalogue rows (supported models, self-evolution algorithms, Benchmarks)
 * whose outside links confirm before they open. What the rows list, and where each entry links,
 * is lib/rsi-stats.ts.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { RELEASE_VERSION } from "../lib/version";
import { BENCHMARKS, MODEL_PROVIDERS, RSI_TOOLKITS } from "../lib/rsi-stats";
import {
  DownloadIcon,
  ExternalLinkIcon,
  ModelProviderLogo,
  TerminalIcon,
} from "../components/icons";
import { ExternalLink, ExternalLinkScope } from "../components/external-link";
import { useLocale } from "../state/locale";

const CHIP_STATIC =
  "inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300";

/** A chip that links somewhere: the static chip plus a hover that says it can be clicked. */
const CHIP = `${CHIP_STATIC} transition-colors hover:border-gray-300 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-800`;

/**
 * One labelled row of the catalogue: label above the items on phones; from `sm` up, label and
 * items share the catalogue's two columns (subgrid), so the three labels line up.
 */
function CatalogRow({
  label,
  delay,
  listClassName,
  children,
}: {
  label: string;
  delay: number;
  listClassName: string;
  children: ReactNode;
}) {
  // Uppercase suits the English labels; on a Chinese label it would only shout whatever Latin
  // word the label carries.
  const { locale } = useLocale();
  return (
    <div
      className="anim-rise flex flex-col items-center sm:col-span-2 sm:grid sm:grid-cols-subgrid sm:items-center"
      style={{ animationDelay: `${delay}ms` }}
    >
      <dt
        className={`text-xs font-semibold tracking-wide text-gray-500 sm:text-right ${locale === "en" ? "uppercase" : ""}`}
      >
        {label}
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
          className="hero-positioning anim-rise mx-auto mt-6 leading-tight font-semibold tracking-[-0.035em] text-balance"
          style={{ animationDelay: "70ms" }}
        >
          {S.hero.positioning}
        </p>

        <p
          className="hero-automation anim-rise mt-5 leading-6 text-balance text-gray-600 sm:leading-8 dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.automation}
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
          className="anim-rise mx-auto mt-10 grid max-w-md grid-cols-2 gap-x-6 sm:mt-12"
          style={{ animationDelay: "250ms" }}
        >
          {S.hero.stats.map((stat) => (
            <div key={stat.value} className="min-w-0">
              <dt className="text-[19px] leading-tight font-semibold tracking-tight text-gray-900 sm:text-2xl dark:text-gray-100">
                {stat.value}
              </dt>
              <dd className="mt-1 text-xs leading-5 text-balance text-gray-500 dark:text-gray-400">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>

        <ExternalLinkScope>
          <dl className="mx-auto mt-10 grid w-fit max-w-full gap-y-6 sm:mt-12 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6 sm:gap-y-4">
            <CatalogRow
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
              <li className="ml-1 text-sm font-medium whitespace-nowrap text-gray-500 dark:text-gray-400">
                {S.hero.supportedModelsMore}
              </li>
            </CatalogRow>

            <CatalogRow label={S.hero.algorithmsLabel} delay={340} listClassName="gap-2">
              {RSI_TOOLKITS.map((toolkit) => (
                <li key={toolkit.plugin}>
                  {toolkit.href !== null ? (
                    <ExternalLink href={toolkit.href} className={CHIP}>
                      {toolkit.label}
                      <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                    </ExternalLink>
                  ) : (
                    <span className={CHIP_STATIC}>{toolkit.label}</span>
                  )}
                </li>
              ))}
            </CatalogRow>

            <CatalogRow label={S.hero.benchmarksLabel} delay={380} listClassName="gap-2">
              {BENCHMARKS.map((benchmark, index) => (
                <li key={benchmark.id}>
                  <ExternalLink href={benchmark.href} className={CHIP}>
                    {S.hero.benchmarkKinds[index]}
                    <ExternalLinkIcon className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                  </ExternalLink>
                </li>
              ))}
            </CatalogRow>
          </dl>
        </ExternalLinkScope>
      </div>
    </section>
  );
}
