/**
 * The one-request case, A2APP: a subtitle line saying what A2APP is above the case's own, the
 * request as it was typed, then the recording of the legal app it built, with what five sample
 * reviews cost in model calls under the caption.
 */
import { S } from "../lib/strings";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import { Section } from "../components/section";
import { DemoVideo } from "../components/demo-video";
import { demoVideoUrl } from "../lib/links";
import posterZh from "../assets/shots/legal-app-zh.webp";
import posterEn from "../assets/shots/legal-app-en.webp";

/** The recording and its title-frame poster, per language. */
const DEMO: Record<Locale, { video: string; poster: string }> = {
  zh: { video: demoVideoUrl("legal_app_zh"), poster: posterZh },
  en: { video: demoVideoUrl("legal_app_en"), poster: posterEn },
};

export function Cases() {
  const { locale } = useSiteLocale();
  const demo = DEMO[locale];
  const c = S.cases;

  return (
    <Section id="cases" title={c.title} subtitle={[c.a2app, c.subtitle]}>
      <figure className="mx-auto max-w-5xl">
        <div className="mx-auto mb-5 w-full max-w-4xl rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-left dark:border-gray-800 dark:bg-gray-900">
          <code className="font-mono text-[12px] leading-5 whitespace-pre-wrap text-gray-800 sm:text-[13px] dark:text-gray-200">
            <span className="mr-2 text-gray-400 select-none dark:text-gray-500">&gt;</span>
            {c.prompt}
          </code>
        </div>
        <DemoVideo src={demo.video} poster={demo.poster} label={c.caption} />
        <figcaption className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
          {c.caption}
        </figcaption>
        <p className="mt-2 text-center text-[13px] font-semibold text-brand-700 dark:text-brand-300">
          {c.cost}
        </p>
      </figure>
    </Section>
  );
}
