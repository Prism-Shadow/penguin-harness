/** Product-first hero with two direct installation paths. */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { RELEASE_VERSION } from "../lib/version";
import { DownloadIcon, ModelProviderLogo, TerminalIcon } from "../components/icons";

const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "zai",
  "moonshot",
  "qwen",
  "openrouter",
] as const;

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
          {S.hero.platformLead}
          <span className="text-brand-600 dark:text-brand-300">{S.hero.platformAccent}</span>
          {S.hero.platformTail}
        </p>

        <p
          className="hero-automation anim-rise mt-5 leading-6 text-balance text-gray-600 sm:leading-8 dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.automationLead}
          {S.hero.automationActions.map((action, index) => (
            <span key={action}>
              {index > 0 && <span className="font-normal"> · </span>}
              <strong className="font-semibold text-gray-900 dark:text-gray-100">{action}</strong>
            </span>
          ))}{" "}
          {S.hero.automationTail}
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
          className="anim-rise mx-auto mt-10 grid max-w-6xl grid-cols-2 gap-x-4 gap-y-7 sm:mt-12 sm:gap-x-6 sm:gap-y-8 xl:grid-cols-4 xl:gap-x-2"
          style={{ animationDelay: "250ms" }}
        >
          {S.hero.stats.map((stat) => (
            <div key={stat.value} className="min-w-0">
              <dt className="mx-auto mt-1 max-w-56 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {stat.label}
              </dt>
              <dd className="hero-stat-value mx-auto mt-0.5 max-w-64 text-[19px] leading-tight font-semibold tracking-tight text-balance text-gray-900 sm:text-2xl xl:max-w-none dark:text-gray-100">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div
          className="anim-rise mx-auto mt-12 flex max-w-5xl flex-wrap items-center justify-center gap-x-5 gap-y-4 text-center text-sm sm:gap-x-6"
          style={{ animationDelay: "300ms" }}
        >
          <span className="mr-1 basis-full text-xs font-semibold tracking-wide text-gray-400 uppercase sm:basis-auto dark:text-gray-500">
            {S.hero.supportedModelsLabel}
          </span>
          {MODEL_PROVIDERS.map((provider, index) => (
            <span
              key={provider}
              aria-label={S.hero.supportedModels[index]}
              title={S.hero.supportedModels[index]}
              className="inline-flex items-center text-gray-700 dark:text-gray-300"
            >
              <ModelProviderLogo provider={provider} className="h-6 w-6" />
            </span>
          ))}
          <span className="basis-full whitespace-nowrap font-medium text-gray-400 sm:basis-auto dark:text-gray-500">
            {S.hero.supportedModelsMore}
          </span>
        </div>
      </div>
    </section>
  );
}
