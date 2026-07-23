/**
 * Hero: enlarged logo + product name, the slogan inside the pill badge, then a
 * bilingual headline whose rotating word crossfades through a gaussian blur
 * (building <-> improving / 构建 <-> 优化), the tagline line, the install
 * one-liner and stats. The rotating word is a stacked inline-grid so line
 * width never jumps.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { S } from "../lib/strings";
import { INSTALL_CMD, REPO_URL } from "../lib/links";
import { CopyButton } from "../components/copy-button";
import { ArrowRightIcon, GitHubIcon } from "../components/icons";

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
        <h1
          className="anim-rise mx-auto mt-6 max-w-full text-3xl font-semibold tracking-tight text-balance sm:text-5xl"
          style={{ animationDelay: "80ms" }}
        >
          {S.hero.titlePrefix}
          <RotatingWord words={S.hero.titleWords} />
          {S.hero.titleSuffix}
          {S.hero.titleSuffixNoWrap && (
            <span className="whitespace-nowrap">{S.hero.titleSuffixNoWrap}</span>
          )}
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
