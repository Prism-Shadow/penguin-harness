/**
 * The plugin library: every package under the repository's plugins/ and every other plugin the
 * published index lists, read at build time, with the market's curation over them. While nothing
 * narrows the list, the selected carousel heads it (the curation's selected plugins in order; the
 * one that leads turns daily among those it allows to); every plugin is a cover card in a grid,
 * the selected ones first by default. When the market document carries popularity counts, a
 * ranking stands beside the grid (under it on a narrow page), with a Popular board by installs
 * and a Rising one by the last week's, and the list gains a Popular order; without counts there
 * is neither. While the counts are placeholders, the ranking says "Sample data".
 */
import { Link, useLocation } from "react-router";
import {
  CoverCard,
  dayNumber,
  leadIndex,
  ShowcaseCarousel,
  ShowcaseGrid,
  ShowcaseRanking,
  ShowcaseSplit,
  SiteGlyph,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import type { RankingBoard, ShowcaseSlide, SiteLocale } from "@prismshadow/penguin-ui/site";
import { HubTag, HubTile } from "../../components/hub/hub-icon";
import { HubList } from "../../components/hub/hub-list";
import type { HubFacet } from "../../components/hub/hub-list";
import { PluginCover, pluginIcon, PRIMARY_ACTION, useEntryLink } from "../../components/hub/market";
import { useDocumentMeta } from "../../lib/document-meta";
import { listState } from "../../lib/hub/back";
import { market, plugins } from "../../lib/hub/data";
import { pick, plainText, titleOf } from "../../lib/hub/text";
import type { PluginSummary } from "../../lib/hub/types";
import { PLUGINS_SOURCE } from "../../lib/links";
import { pluginTone } from "../../lib/hub/plugin-hue";
import { S } from "../../lib/strings";

const CATEGORY_ORDER = [
  "rsi",
  "office-productivity",
  "software-development",
  "ai-app-development",
  "learning-life",
  "sandbox",
  "other",
];

const categoryLabel = (id: string) => S.hub.plugins.categories[id] ?? id;

/** Position in CATEGORY_ORDER; an unknown category sorts with "other". */
const rank = (category: string) => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length - 1 : index;
};

/** Position in the curation's selected list; an unselected plugin after every selected one. */
const curated = (plugin: PluginSummary) => {
  const index = market.selected.indexOf(plugin.id);
  return index === -1 ? market.selected.length : index;
};

const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));

/** The selected plugins the library carries, in the curation's order. */
const SELECTED = market.selected
  .map((id) => byId.get(id))
  .filter((plugin): plugin is PluginSummary => plugin !== undefined);

/**
 * Whether the market document carries popularity counts. Without them there is no ranking panel
 * and no Popular order. The counts are placeholders until a real source replaces them; while they
 * are, the panel says "Sample data" beside its heading.
 */
const POPULAR = plugins.some((plugin) => plugin.popularity !== undefined);
const SAMPLE = market.popularitySource === "placeholder";

/** A plugin's install count; one the document does not count ranks after every counted one. */
const installs = (plugin: PluginSummary) => plugin.popularity?.installs ?? -1;

/** The plugins the market document counts: the ranking's rows. */
const COUNTED = plugins.filter((plugin) => plugin.popularity !== undefined);

/** The slides allowed to lead the carousel, as indexes into SELECTED, in the curation's turn order. */
const LEADS = market.hero
  .map((id) => SELECTED.findIndex((plugin) => plugin.id === id))
  .filter((index) => index !== -1);

export function PluginsPage() {
  const { locale } = useSiteLocale();
  const location = useLocation();
  const entryLink = useEntryLink();
  useDocumentMeta(S.hub.pageTitle(S.hub.plugins.title), S.hub.plugins.description);
  const t = S.hub.plugins;
  const byTitle = (a: PluginSummary, b: PluginSummary) =>
    titleOf(locale, a).localeCompare(titleOf(locale, b), locale);

  const facets: HubFacet<PluginSummary>[] = [
    {
      id: "category",
      label: t.facetCategory,
      values: (plugin) => [CATEGORY_ORDER.includes(plugin.category) ? plugin.category : "other"],
      valueLabel: categoryLabel,
      order: CATEGORY_ORDER,
    },
    {
      id: "contents",
      label: t.facetContents,
      // A plugin that is not bundled says what it carries in its index keywords instead.
      values: (plugin) =>
        plugin.contents ??
        [
          plugin.skillCount > 0 && "skills",
          plugin.hookCount > 0 && "hooks",
          plugin.workbenchCount > 0 && "workbenches",
        ].filter((value): value is string => Boolean(value)),
      valueLabel: (value) => t.contents[value as keyof typeof t.contents] ?? value,
      order: ["skills", "hooks", "workbenches"],
    },
    {
      id: "author",
      label: t.facetAuthor,
      values: (plugin) => (plugin.author ? [plugin.author.name] : []),
      valueLabel: (value) => value,
    },
  ];

  const slides: ShowcaseSlide[] = SELECTED.map((plugin) => {
    const to = `/plugins/${plugin.id}`;
    const tagline = plainText(pick(locale, plugin.short, plugin.shortZh));
    const description = plainText(pick(locale, plugin.description, plugin.descriptionZh));
    return {
      key: plugin.id,
      cover: <PluginCover plugin={plugin} rendition="full" eager />,
      thumb: <PluginCover plugin={plugin} />,
      lead: <HubTile tone={pluginTone(plugin.id)} icon={pluginIcon(plugin)} glyph="puzzle" />,
      title: titleOf(locale, plugin),
      tagline,
      // A card whose one line is its whole description has nothing more to say here.
      description: description !== tagline ? description : undefined,
      ...entryLink(to),
      actions: (
        <Link to={to} state={listState(location)} className={PRIMARY_ACTION}>
          {t.viewDetails}
        </Link>
      ),
    };
  });

  return (
    <HubList
      title={t.title}
      description={t.description}
      source={{ href: PLUGINS_SOURCE, label: "Prism-Shadow/penguin-harness/plugins" }}
      items={plugins}
      keyOf={(plugin) => plugin.id}
      texts={(plugin) => [
        plugin.id,
        plugin.title,
        plugin.titleZh,
        plugin.short,
        plugin.shortZh,
        plugin.author?.name,
      ]}
      facets={facets}
      sorts={[
        {
          id: "selected",
          label: t.sortSelected,
          compare: (a, b) =>
            curated(a) - curated(b) || rank(a.category) - rank(b.category) || byTitle(a, b),
        },
        ...(POPULAR
          ? [
              {
                id: "popular",
                label: t.sortPopular,
                compare: (a: PluginSummary, b: PluginSummary) =>
                  installs(b) - installs(a) || byTitle(a, b),
              },
            ]
          : []),
        {
          id: "updated",
          label: S.hub.sortLatest,
          // Newest first; a plugin with no update day (none of its parts dated) goes last.
          compare: (a, b) =>
            a.updated === b.updated
              ? byTitle(a, b)
              : a.updated === undefined
                ? 1
                : b.updated === undefined
                  ? -1
                  : b.updated.localeCompare(a.updated),
        },
        { id: "name", label: S.hub.sortName, compare: byTitle },
      ]}
      lead={
        slides.length > 0 ? (
          <ShowcaseCarousel
            className="site-ui"
            slides={slides}
            label={t.selectedPlugins}
            eyebrow={t.selected}
            labels={t.carousel}
            start={leadIndex(slides.length, LEADS, dayNumber(new Date()))}
          />
        ) : undefined
      }
      wrapList={(cards) => (
        <ShowcaseSplit
          className="site-ui"
          aside={
            POPULAR ? (
              <ShowcaseRanking
                title={t.rankingTitle}
                {...(SAMPLE ? { note: t.rankingSample, noteHint: t.rankingSampleHint } : {})}
                boards={rankingBoards(locale, byTitle, entryLink)}
                // The site mounts no tooltip layer: its hover hints are the browser's own.
                hints="title"
              />
            ) : undefined
          }
        >
          <ShowcaseGrid>{cards}</ShowcaseGrid>
        </ShowcaseSplit>
      )}
      renderItem={(plugin) => <PluginCard plugin={plugin} />}
    />
  );
}

/**
 * The ranking's two boards: Popular by install count, Rising by the last week's installs, each
 * row a counted plugin with its cover, name, category and figure (shortened, said in full on
 * hover). The counts are the market document's placeholders until a real source replaces them.
 */
function rankingBoards(
  locale: SiteLocale,
  byTitle: (a: PluginSummary, b: PluginSummary) => number,
  entryLink: ReturnType<typeof useEntryLink>,
): RankingBoard[] {
  const t = S.hub.plugins;
  const tag = locale === "zh" ? "zh-CN" : "en";
  const compact = new Intl.NumberFormat(tag, { notation: "compact", maximumFractionDigits: 1 });
  const board = (
    key: string,
    label: string,
    glyph: "download" | "arrowUpRight",
    figure: (plugin: PluginSummary) => number,
    words: (count: string) => string,
  ): RankingBoard => ({
    key,
    label,
    mark: <SiteGlyph name={glyph} className="h-3.5 w-3.5" />,
    entries: [...COUNTED]
      .sort((a, b) => figure(b) - figure(a) || byTitle(a, b))
      .map((plugin) => ({
        key: plugin.id,
        thumb: <PluginCover plugin={plugin} />,
        title: titleOf(locale, plugin),
        tags: [
          <HubTag key="category" fit title={categoryLabel(plugin.category)}>
            {categoryLabel(plugin.category)}
          </HubTag>,
        ],
        count: compact.format(figure(plugin)),
        countLabel: words(figure(plugin).toLocaleString(tag)),
        ...entryLink(`/plugins/${plugin.id}`),
      })),
  });
  return [
    board("popular", t.popular, "download", (p) => p.popularity?.installs ?? 0, t.installCount),
    board("rising", t.rising, "arrowUpRight", (p) => p.popularity?.weekly ?? 0, t.weeklyCount),
  ];
}

/** One plugin in the grid: its cover, name and one line, its tags, and its package facts. */
function PluginCard({ plugin }: { plugin: PluginSummary }) {
  const { locale } = useSiteLocale();
  const entryLink = useEntryLink();
  const t = S.hub.plugins;
  const facts = [
    plugin.author?.name,
    plugin.version,
    plugin.skillCount > 0 ? t.skillCount(plugin.skillCount) : undefined,
  ].filter((fact): fact is string => fact !== undefined);
  return (
    <CoverCard
      cover={<PluginCover plugin={plugin} />}
      title={titleOf(locale, plugin)}
      description={plainText(pick(locale, plugin.short, plugin.shortZh))}
      tags={[
        ...(plugin.selected ? [<HubTag key="selected">{t.selected}</HubTag>] : []),
        <HubTag key="category">{categoryLabel(plugin.category)}</HubTag>,
      ]}
      meta={facts.join(" · ")}
      {...entryLink(`/plugins/${plugin.id}`)}
    />
  );
}
