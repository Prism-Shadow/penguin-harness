import { useState } from "react";
import { Link } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { S } from "../lib/strings";
import { mmspModelsUrl } from "../lib/links";
import { RELEASE_VERSION } from "../lib/version";
import counts from "virtual:penguin-catalog-counts";
import { DownloadIcon, AirplaneIcon, TerminalIcon } from "../components/icons";
import { ExternalLink, ExternalLinkScope } from "../components/external-link";
import { LiveAppFrame } from "../components/live-app-frame";
import { useVisibleActivity } from "../lib/visible-activity";

function HeroWord({ text, variant }: { text: string; variant: "growth" | "reach" }) {
  return (
    <span className={`hero-word hero-word-${variant}`}>
      <span className="hero-word-ink">{text}</span>
      <span className="hero-word-trace" aria-hidden="true">
        <span className="hero-word-flight">
          <span className="hero-word-trail" />
          <AirplaneIcon className="hero-word-plane" />
        </span>
      </span>
    </span>
  );
}

/** The link and its reserved bounds are available while the external artwork loads. */
function ListingBadge({
  href,
  src,
  name,
  label,
}: {
  href: string;
  src: string;
  name: string;
  label: string;
}) {
  const [ready, setReady] = useState(false);
  return (
    <ExternalLink
      href={href}
      aria-label={label}
      className="flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span className="relative block aspect-[250/54] w-full">
        {!ready && (
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center rounded-md border border-gray-300 bg-white text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          >
            {name}
          </span>
        )}
        <img
          alt=""
          width="250"
          height="54"
          src={src}
          onLoad={() => setReady(true)}
          onError={() => setReady(false)}
          className={`absolute inset-0 h-full w-full object-contain ${ready ? "visible" : "invisible"}`}
        />
      </span>
    </ExternalLink>
  );
}

export function Hero() {
  const { locale } = useSiteLocale();
  const { ref: motion, active } = useVisibleActivity<HTMLHeadingElement>();
  return (
    <section className="relative overflow-hidden">
      <div className="relative mx-auto max-w-6xl px-4 pt-8 pb-12 text-center sm:px-6 sm:pt-12 sm:pb-14">
        <h1
          id="home-top"
          tabIndex={-1}
          ref={motion}
          className={`hero-positioning anim-rise mx-auto font-semibold tracking-[-0.035em] text-balance break-keep [overflow-wrap:break-word] ${active ? "" : "hero-motion-paused"}`}
          style={{ animationDelay: "70ms" }}
        >
          <span className="hero-positioning-clause">
            {S.hero.positioning.growthLead}
            <HeroWord text={S.hero.positioning.growth} variant="growth" />
          </span>
          {S.hero.positioning.separator}
          <wbr />
          <span className="hero-positioning-clause">
            {S.hero.positioning.reachLead}
            <HeroWord text={S.hero.positioning.reach} variant="reach" />
          </span>
        </h1>

        <p
          className="hero-automation anim-rise mt-2 leading-6 text-balance break-keep text-gray-600 [overflow-wrap:break-word] sm:leading-8 dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {S.hero.subtitle}
        </p>

        <ExternalLinkScope>
          <ul
            className="anim-rise mx-auto mt-6 grid max-w-lg grid-cols-3 gap-2"
            style={{ animationDelay: "160ms" }}
          >
            {[
              {
                value: counts.models,
                label: S.hero.supportedModelsLabel,
                href: mmspModelsUrl(locale),
              },
              { value: counts.algorithms, label: S.hero.algorithmsLabel, href: "/plugins" },
              { value: counts.benchmarks, label: S.hero.benchmarksLabel, href: "/benchmarks" },
            ].map(({ value, label, href }) => {
              const name = (
                <>
                  <span className="text-xl font-semibold tabular-nums sm:text-2xl">{value}</span>
                  <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
                </>
              );
              const classes =
                "flex min-h-11 flex-col items-center justify-center gap-1 rounded-md hover:underline focus-visible:outline-2";
              return (
                <li key={href}>
                  {href.startsWith("/") ? (
                    <Link to={href} className={classes}>
                      {name}
                    </Link>
                  ) : (
                    <ExternalLink href={href} className={classes}>
                      {name}
                    </ExternalLink>
                  )}
                </li>
              );
            })}
          </ul>
        </ExternalLinkScope>

        <LiveAppFrame
          surface="chat-new"
          autoplay="evolution"
          title={S.live.evolutionFrame}
          className="anim-rise mx-auto mt-7 max-w-6xl text-left sm:mt-10"
        />

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
            <span className="text-xs font-medium text-gray-400 tabular-nums dark:text-gray-600">
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

        <ExternalLinkScope>
          <div
            className="anim-rise mx-auto mt-4 flex max-w-[360px] items-center justify-center gap-2"
            style={{ animationDelay: "210ms" }}
          >
            <ListingBadge
              href="https://www.producthunt.com/products/penguinharness"
              src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1202577&theme=light&t=1784804711946"
              name="Product Hunt"
              label={S.hero.productHuntBadge}
            />
            <ListingBadge
              href="https://watcha.cn/products/penguinharness"
              src="https://watcha.cn/api/v2/products/penguinharness/badge?style=1&dark=false"
              name={S.hero.watcha}
              label={S.hero.watchaBadge}
            />
          </div>
        </ExternalLinkScope>
      </div>
    </section>
  );
}
