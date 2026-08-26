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
      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 text-center sm:px-6 sm:pt-24 sm:pb-14">
        <h1 className="anim-rise flex items-center justify-center gap-3.5">
          <img
            src={`${import.meta.env.BASE_URL}penguin-logo.svg`}
            alt=""
            className="h-14 w-14 sm:h-16 sm:w-16"
          />
          <span className="text-3xl font-semibold tracking-tight sm:text-4xl">{S.siteName}</span>
        </h1>

        <p
          className="hero-positioning anim-rise mx-auto mt-6 whitespace-nowrap leading-tight font-semibold tracking-[-0.035em]"
          style={{ animationDelay: "70ms" }}
        >
          {S.hero.platformLead}
          <span className="text-brand-600 dark:text-brand-300">{S.hero.platformAccent}</span>
          {S.hero.platformTail}
        </p>

        <p
          className="hero-automation anim-rise mt-5 leading-8 text-gray-600 dark:text-gray-300"
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
          className="anim-rise mx-auto mt-12 grid max-w-5xl grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4"
          style={{ animationDelay: "250ms" }}
        >
          {S.hero.stats.map((stat) => (
            <div key={stat.value} className="min-w-0">
              <dt className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {stat.label}
              </dt>
              <dd className="whitespace-nowrap text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>

        <div
          className="anim-rise mx-auto mt-12 flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-4 text-center text-sm"
          style={{ animationDelay: "300ms" }}
        >
          <span className="mr-1 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-gray-500">
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
          <span className="whitespace-nowrap font-medium text-gray-400 dark:text-gray-500">
            {S.hero.supportedModelsMore}
          </span>
        </div>
      </div>
    </section>
  );
}
