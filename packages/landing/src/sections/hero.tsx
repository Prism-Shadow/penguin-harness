/**
 * Hero: enlarged logo + product name, the one-line headline whose rotating word
 * crossfades through a gaussian blur (Desktop <-> Server, localized per dictionary),
 * the desktop-first CTAs — a platform-aware download button pointing at /download
 * (artifact resolution stays on that page), an all-platforms line and a link down to
 * the quick start for CLI / self-hosted installs — and stats.
 * The rotating word is a stacked inline-grid so line width never jumps.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { REPO_URL } from "../lib/links";
import { detectPlatform } from "../lib/platform";
import { ArrowRightIcon, DownloadIcon, GitHubIcon } from "../components/icons";

const ROTATE_MS = 2600;

function RotatingWord({ words }: { words: string[] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (words.length < 2) return;
    const timer = setInterval(() => setActive((i) => (i + 1) % words.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [words.length]);
  return (
    <span className="inline-grid justify-items-center align-bottom">
      {words.map((word, i) => (
        <span
          key={word}
          aria-hidden={i !== active}
          className={`col-start-1 row-start-1 text-brand-600 transition-[opacity,filter] duration-500 dark:text-brand-300 ${
            i === active ? "opacity-100 blur-none" : "opacity-0 blur-[6px]"
          }`}
        >
          {word}
        </span>
      ))}
    </span>
  );
}

export function Hero() {
  // Platform-aware label only; every link goes to /download, where the platform
  // cards and the GitHub/OSS artifact resolution live.
  const detected = detectPlatform();
  const downloadLabel = detected
    ? S.hero.downloadCtaFor(S.download.platforms[detected].name)
    : S.hero.downloadCta;
  const textLink =
    "inline-flex items-center gap-1 text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-600 dark:text-brand-300 dark:decoration-brand-700";

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
        {/* No text-balance: balance may break inside the breakable prefix ("…Agent /
            Builder…"); greedy wrapping + the nowrap span pins the desktop break to
            "Your Automated Agent Builder, / Right on Your Desktop". */}
        <h1
          className="anim-rise mx-auto mt-6 max-w-full text-3xl font-semibold tracking-tight sm:text-5xl"
          style={{ animationDelay: "80ms" }}
        >
          {S.hero.titlePrefix}
          <span className="whitespace-nowrap">
            {S.hero.titleNoWrap}
            <RotatingWord words={S.hero.titleWords} />
            {S.hero.titleSuffix}
          </span>
        </h1>

        <p
          className="anim-rise mt-6 text-base font-medium text-gray-600 sm:text-lg dark:text-gray-300"
          style={{ animationDelay: "140ms" }}
        >
          {S.hero.subtitle}
        </p>

        <div
          className="anim-rise mt-8 flex flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "200ms" }}
        >
          <Link
            to="/download"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-gray-900 px-5 text-sm font-medium text-white transition-colors hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            <DownloadIcon className="h-4 w-4" />
            {downloadLabel}
          </Link>
          <Link
            to="/#quickstart"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            {S.hero.ctaQuickstart}
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

        <p
          className="anim-rise mt-5 text-sm text-gray-600 dark:text-gray-400"
          style={{ animationDelay: "240ms" }}
        >
          <Link to="/download" className={textLink}>
            {S.hero.downloadAll}
          </Link>
          <span className="mx-2 text-gray-300 dark:text-gray-700">·</span>
          <Link to="/#quickstart" className={textLink}>
            {S.hero.cliAlt}
          </Link>
        </p>

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
