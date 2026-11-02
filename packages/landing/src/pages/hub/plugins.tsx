/** The plugin library: every package under the repository's plugins/, read at build time. */
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { HubCard } from "../../components/hub/hub-card";
import { HubIcon } from "../../components/hub/hub-icon";
import { HubList } from "../../components/hub/hub-list";
import type { HubFacet } from "../../components/hub/hub-list";
import { useDocumentMeta } from "../../lib/document-meta";
import { plugins } from "../../lib/hub/data";
import { pick, titleOf } from "../../lib/hub/text";
import type { PluginSummary } from "../../lib/hub/types";
import { PLUGINS_SOURCE } from "../../lib/links";
import { S } from "../../lib/strings";

const CATEGORY_ORDER = [
  "rsi",
  "office-productivity",
  "software-development",
  "ai-app-development",
  "sandbox",
  "other",
];

const categoryLabel = (id: string) => S.hub.plugins.categories[id] ?? id;

/** Position in CATEGORY_ORDER; an unknown category sorts with "other". */
const rank = (category: string) => {
  const index = CATEGORY_ORDER.indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length - 1 : index;
};

export function PluginsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(S.hub.pageTitle(S.hub.plugins.title), S.hub.plugins.description);
  const facets: HubFacet<PluginSummary>[] = [
    {
      id: "category",
      label: S.hub.plugins.facetCategory,
      values: (plugin) => [CATEGORY_ORDER.includes(plugin.category) ? plugin.category : "other"],
      valueLabel: categoryLabel,
      order: CATEGORY_ORDER,
    },
    {
      id: "contents",
      label: S.hub.plugins.facetContents,
      values: (plugin) =>
        [
          plugin.skillCount > 0 && "skills",
          plugin.hookCount > 0 && "hooks",
          plugin.workbenchCount > 0 && "workbenches",
        ].filter((value): value is string => Boolean(value)),
      valueLabel: (value) =>
        S.hub.plugins.contents[value as keyof typeof S.hub.plugins.contents] ?? value,
      order: ["skills", "hooks", "workbenches"],
    },
    {
      id: "author",
      label: S.hub.plugins.facetAuthor,
      values: (plugin) => (plugin.author ? [plugin.author.name] : []),
      valueLabel: (value) => value,
    },
  ];
  return (
    <HubList
      title={S.hub.plugins.title}
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
          id: "category",
          label: S.hub.plugins.facetCategory,
          compare: (a, b) =>
            rank(a.category) - rank(b.category) ||
            titleOf(locale, a).localeCompare(titleOf(locale, b), locale),
        },
      ]}
      renderItem={(plugin) => (
        <HubCard
          to={`/plugins/${plugin.id}`}
          lead={<HubIcon src={plugin.icon} />}
          title={titleOf(locale, plugin)}
          summary={pick(locale, plugin.short, plugin.shortZh)}
          facts={[
            ...(plugin.author ? [plugin.author.name] : []),
            categoryLabel(plugin.category),
            `v${plugin.version}`,
          ]}
        />
      )}
    />
  );
}
