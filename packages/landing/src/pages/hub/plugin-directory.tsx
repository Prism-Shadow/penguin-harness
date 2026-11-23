/** Search, sort and filter the complete directory after the featured carousel opens. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router";
import {
  CoverCard,
  ShowcaseGrid,
  ShowcaseLayoutToggle,
  useShowcaseLayout,
  useSiteLocale,
} from "@prismshadow/penguin-ui/site";
import { HubTag } from "../../components/hub/hub-icon";
import { HubList } from "../../components/hub/hub-list";
import type { HubFacet } from "../../components/hub/hub-list";
import { PluginCover, useEntryLink } from "../../components/hub/market";
import { recallScroll } from "../../lib/hub/back";
import { market, plugins } from "../../lib/hub/data";
import { pick, plainText, titleOf } from "../../lib/hub/text";
import type { PluginSummary } from "../../lib/hub/types";
import { S } from "../../lib/strings";

const CATEGORY_ORDER = [
  "rsi",
  "office-productivity",
  "software-development",
  "ai-app-development",
  "learning-life",
  "utilities",
  "entertainment",
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

export default function PluginDirectory() {
  const { locale } = useSiteLocale();
  const [layout, chooseLayout] = useShowcaseLayout("penguin.pluginsLayout");
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

  return (
    <HubList
      title={t.title}
      className="pt-0"
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
      controls={
        // The site mounts no tooltip layer: the icons' names show as native titles.
        <ShowcaseLayoutToggle
          className="site-ui"
          nativeTooltips
          value={layout}
          onChange={chooseLayout}
          labels={{ group: t.layoutLabel, cards: t.cardsLayout, list: t.listLayout }}
        />
      }
      wrapList={(cards) => <PluginGrid layout={layout} cards={cards} />}
      renderItem={(plugin) => <PluginCard plugin={plugin} />}
    />
  );
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

const CARD_BATCH = 6;

/** Mount covers as readers approach them. Queries and facets always see every record. */
function PluginGrid({
  layout,
  cards,
}: {
  layout: ReturnType<typeof useShowcaseLayout>[0];
  cards: ReactNode[];
}) {
  const location = useLocation();
  const arrival = useNavigationType();
  const [limit, setLimit] = useState(() =>
    recallScroll(location.key) ? cards.length : CARD_BATCH,
  );
  const more = useRef<HTMLButtonElement>(null);
  const hasMore = limit < cards.length;
  useLayoutEffect(() => {
    const y = recallScroll(location.key);
    if (arrival === "POP" && y !== undefined) window.scrollTo(0, y);
  }, [location.key, arrival]);
  useEffect(() => {
    const target = more.current;
    if (!target || !hasMore || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setLimit((limit) => limit + CARD_BATCH);
      },
      { rootMargin: "160px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [limit, hasMore]);
  return (
    <>
      <ShowcaseGrid layout={layout} className="site-ui">
        {cards.slice(0, limit)}
      </ShowcaseGrid>
      {hasMore && (
        <button
          ref={more}
          type="button"
          onClick={() => setLimit(limit + CARD_BATCH)}
          className="mt-4 rounded-md px-3 py-2 text-sm text-gray-700 hover:underline dark:text-gray-300"
        >
          {S.nav.more}
        </button>
      )}
    </>
  );
}
