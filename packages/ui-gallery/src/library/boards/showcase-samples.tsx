/**
 * The specimens the showcase boards share — 封面陈列 (the app's themes) and 公开站点 (the
 * sites' palette): shipped plugins' icons as the app draws them, the gallery's logo, real
 * screenshots, and the selected carousel's slides built from the active dictionary. Each board
 * brings its own actions and tiles, since a slide's controls and mark are its host's.
 */
import type { ReactNode } from "react";
import {
  Cover,
  ImageIcon,
  coverMotif,
  type CoverHue,
  type CoverMotif,
  type ImageIconSource,
  type ProductShot,
  type ShowcaseSlide,
} from "@prismshadow/penguin-ui";
import ragEnDark from "../../../../../assets/readme/rag-app-en-dark.webp";
import ragEnLight from "../../../../../assets/readme/rag-app-en-light.webp";
import ragZhDark from "../../../../../assets/readme/rag-app-zh-dark.webp";
import ragZhLight from "../../../../../assets/readme/rag-app-zh-light.webp";
import legalEn from "../../../../landing/src/assets/shots/legal-app-en.webp";
import legalZh from "../../../../landing/src/assets/shots/legal-app-zh.webp";
import a2uiIcon from "@penguinharness/a2ui/icon.svg?raw";
import companyIcon from "../../../../../plugins/agent-company/icon.svg?raw";
import browserIcon from "../../../../../plugins/browser-automation/icon.svg?raw";
import dataIcon from "../../../../../plugins/data-analysis/icon.svg?raw";
import goalIcon from "../../../../../plugins/goal/icon.svg?raw";
import humanizerIcon from "@penguinharness/humanizer/icon.svg?raw";
import supportIcon from "../../../../../plugins/penguin-support/icon.svg?raw";
import bentoIcon from "../../../../../plugins/use-bento-slides/icon.svg?raw";
import firecrawlIcon from "@penguinharness/use-firecrawl/icon.svg?raw";
import type { GalleryStrings } from "../../strings";

export const LOGO = `${import.meta.env.BASE_URL}penguin-logo.svg`;

/** A shipped icon as the app draws one: monochrome line art, tinted to the text colour. */
export const plugIcon = (svg: string): ImageIconSource => ({
  url: `data:image/svg+xml,${encodeURIComponent(svg.trim())}`,
  tint: true,
});

/** One shipped plugin per hue, in the order of the hues. */
export const HUE_PLUGINS: Record<CoverHue, { name: string; svg: string }> = {
  blue: { name: "browser-automation", svg: browserIcon },
  violet: { name: "a2ui", svg: a2uiIcon },
  pink: { name: "humanizer", svg: humanizerIcon },
  red: { name: "use-firecrawl", svg: firecrawlIcon },
  orange: { name: "use-bento-slides", svg: bentoIcon },
  amber: { name: "agent-company", svg: companyIcon },
  green: { name: "goal", svg: goalIcon },
  teal: { name: "penguin-support", svg: supportIcon },
  slate: { name: "data-analysis", svg: dataIcon },
};

export const ICONS_BY_PLUGIN = {
  goal: goalIcon,
  support: supportIcon,
  bento: bentoIcon,
  a2ui: a2uiIcon,
} as const;

/** A seed whose generated cover carries `motif` (the motif follows the seed, as a name's does). */
export function seedFor(motif: CoverMotif): string {
  for (let i = 0; ; i++) {
    const seed = `${motif}-${i}`;
    if (coverMotif(seed) === motif) return seed;
  }
}

/** A real picture for the loaded state: a deck the slides plugin made, at the cover's ratio. */
export const deckPicture = (lang: "en" | "zh") => (lang === "zh" ? legalZh : legalEn);

/** Two real screenshots for the product page's gallery, in the reader's language and mode. */
export function sampleShots(
  t: GalleryStrings["library"]["showcase"],
  lang: "en" | "zh",
  dark: boolean,
): ProductShot[] {
  const rag = lang === "zh" ? (dark ? ragZhDark : ragZhLight) : dark ? ragEnDark : ragEnLight;
  return [
    { src: rag, alt: t.shotAnswer, caption: t.shotAnswer },
    { src: deckPicture(lang), alt: t.shotDeck, caption: t.shotDeck },
  ];
}

/** A plugin's mark beside its name: its icon on a small tile, in the ink around it. */
export function LeadTile({ svg }: { svg: string }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-[var(--ui-radius-md)] border border-line text-fg-muted">
      <ImageIcon icon={plugIcon(svg)} size={22} fallback={null} />
    </span>
  );
}

const SLIDE_PLUGINS = [
  { seed: "penguin-support", hue: "teal", svg: supportIcon },
  { seed: "use-bento-slides", hue: "orange", svg: bentoIcon },
  { seed: "goal", hue: "green", svg: goalIcon },
] as const satisfies readonly { seed: string; hue: CoverHue; svg: string }[];

/**
 * The carousel's three slides: generated covers (the second with a real picture, as an authored
 * cover would be), each plugin's tile, its words, and the actions `actions` builds for it. The
 * tile is the host's (`tile`), like the actions: the app's on the theme, a site's on its palette.
 */
export function sampleSlides(
  t: GalleryStrings["library"]["showcase"],
  lang: "en" | "zh",
  actions: (title: string) => ReactNode,
  tile: (svg: string) => ReactNode = (svg) => <LeadTile svg={svg} />,
): ShowcaseSlide[] {
  return t.slides.map((words, i) => {
    const plugin = SLIDE_PLUGINS[i % SLIDE_PLUGINS.length]!;
    const image = i === 1 ? { src: deckPicture(lang) } : null;
    const cover = (rendition: "thumb" | "full") => (
      <Cover
        image={image}
        rendition={rendition}
        seed={plugin.seed}
        hue={plugin.hue}
        icon={plugIcon(plugin.svg)}
        logo={LOGO}
        eager={rendition === "full"}
      />
    );
    return {
      key: plugin.seed,
      cover: cover("full"),
      thumb: cover("thumb"),
      lead: tile(plugin.svg),
      title: words.title,
      tagline: words.tagline,
      description: words.description,
      actions: actions(words.title),
    };
  });
}
