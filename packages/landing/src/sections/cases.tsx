import { AppGenerationDiagram } from "../components/application-diagrams";
import { S } from "../lib/strings";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import type { SiteLocale as Locale } from "@prismshadow/penguin-ui/site";
import { Link } from "react-router";
import { StorySection } from "../components/story-section";
import { DemoVideo } from "../components/demo-video";
import { demoVideoUrl } from "../lib/community-assets";
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
    <StorySection
      id="cases"
      title={c.os}
      intro={c.subtitle}
      action={<Link to="/blog/build-agent-apps-with-workflows">{c.tutorial}</Link>}
    >
      <AppGenerationDiagram />
      <div className="story-evidence">
        <div>
          <h3>{c.change}</h3>
          <blockquote className="mt-4 text-lg leading-7 font-medium text-pretty">
            {c.request}
          </blockquote>
          <p>{c.a2app}</p>
          <p>{c.family}</p>
        </div>
        <figure>
          <DemoVideo src={demo.video} poster={demo.poster} label={c.caption} />
          <figcaption>
            <strong className="block font-semibold">{c.title}</strong> {c.cost}
          </figcaption>
        </figure>
      </div>
    </StorySection>
  );
}
