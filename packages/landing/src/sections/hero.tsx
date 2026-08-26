/** Product-first hero with two direct installation paths. */
import { Link } from "react-router";
import { S } from "../lib/strings";
import { RELEASE_VERSION } from "../lib/version";
import { DownloadIcon, TerminalIcon } from "../components/icons";

export function Hero() {
  return (
    <section className="relative overflow-hidden">
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
          {S.hero.platformLead}
          <span className="text-brand-600 dark:text-brand-300">{S.hero.platformAccent}</span>
          {S.hero.platformTail}
        </p>

        <p
          className="anim-rise mt-4 text-sm text-gray-600 sm:text-base dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.automation}
        </p>

        <div
          className="anim-rise mx-auto mt-7 grid max-w-md grid-cols-2 gap-3"
          style={{ animationDelay: "170ms" }}
        >
          <div>
            <Link
              to="/download"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              <DownloadIcon className="h-4 w-4" />
              {S.hero.downloadCta}
            </Link>
            <p className="mt-2 text-xs font-medium text-gray-400 tabular-nums dark:text-gray-500">
              {RELEASE_VERSION}
            </p>
          </div>
          <Link
            to="/#quickstart-install"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 shadow-sm transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            <TerminalIcon className="h-4 w-4" />
            {S.hero.cliInstall}
          </Link>
        </div>

        <dl
          className="anim-rise mx-auto mt-11 grid max-w-5xl grid-cols-2 gap-x-4 gap-y-8 text-center lg:grid-cols-4"
          style={{ animationDelay: "250ms" }}
        >
          {S.hero.stats.map((stat) => (
            <div key={stat.value}>
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
