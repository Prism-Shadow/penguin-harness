import { SitePill } from "@prismshadow/penguin-ui/site";
import { S } from "../../lib/strings";
import { LiveAppFrame } from "../../components/live-app-frame";

export function CompanyHero() {
  const c = S.company;
  return (
    <section className="px-4 pt-12 pb-8 sm:px-6 sm:pt-16">
      <div className="mx-auto max-w-3xl text-center">
        <p className="anim-rise">
          <SitePill tone="neutral">{c.status}</SitePill>
        </p>
        <h1
          className="anim-rise mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance break-keep [overflow-wrap:break-word] sm:text-4xl"
          style={{ animationDelay: "60ms" }}
        >
          {c.headline}
        </h1>
        <p
          className="anim-rise mt-5 text-base leading-7 text-pretty text-gray-600 sm:text-lg dark:text-gray-300"
          style={{ animationDelay: "120ms" }}
        >
          {c.subline}
        </p>
      </div>
      <LiveAppFrame
        surface="company"
        title={c.frame}
        className="anim-rise mx-auto mt-12 max-w-6xl text-left"
      />
      <p className="mx-auto mt-4 max-w-3xl text-center text-sm text-gray-500 dark:text-gray-400">
        {c.note}
      </p>
    </section>
  );
}
