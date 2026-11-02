/** The leaderboards: penguin-harness-benchmark's, or the placeholder that stands in for them. */
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { HubCard } from "../../components/hub/hub-card";
import { HubList } from "../../components/hub/hub-list";
import type { HubFacet } from "../../components/hub/hub-list";
import { useDocumentMeta } from "../../lib/document-meta";
import { leaderboards } from "../../lib/hub/data";
import { formatDay, titleOf } from "../../lib/hub/text";
import type { ChartKind, LeaderboardSummary } from "../../lib/hub/types";
import { BENCHMARK_REPO_URL } from "../../lib/links";
import { S } from "../../lib/strings";

const KINDS: ChartKind[] = ["table", "pareto", "waffle"];

export function LeaderboardsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(S.hub.pageTitle(S.hub.leaderboards.title), S.hub.leaderboards.description);
  const facets: HubFacet<LeaderboardSummary>[] = [
    {
      id: "chart",
      label: S.hub.leaderboards.facetChart,
      values: (board) => board.kinds,
      valueLabel: (value) => S.hub.leaderboards.charts[value as ChartKind] ?? value,
      order: KINDS,
    },
    {
      id: "author",
      label: S.hub.leaderboards.facetAuthor,
      values: (board) => [board.author.name],
      valueLabel: (value) => value,
    },
  ];
  return (
    <HubList
      title={S.hub.leaderboards.title}
      source={{ href: BENCHMARK_REPO_URL, label: "Prism-Shadow/penguin-harness-benchmark" }}
      items={leaderboards}
      keyOf={(board) => board.id}
      texts={(board) => [board.id, board.title, board.titleZh, board.author.name]}
      facets={facets}
      sorts={[
        {
          id: "updated",
          label: S.hub.sortLatest,
          compare: (a, b) => b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id),
        },
        {
          id: "name",
          label: S.hub.sortName,
          compare: (a, b) => titleOf(locale, a).localeCompare(titleOf(locale, b), locale),
        },
      ]}
      renderItem={(board) => (
        <HubCard
          to={`/leaderboards/${board.id}`}
          title={titleOf(locale, board)}
          summary={board.kinds
            .map((kind) => S.hub.leaderboards.charts[kind])
            .join(S.hub.listSeparator)}
          facts={[
            board.author.name,
            S.hub.leaderboards.entryCount(board.entryCount),
            S.hub.leaderboards.benchmarkCount(board.benchmarkCount),
            S.hub.updatedOn(formatDay(board.updated, locale)),
          ]}
        />
      )}
    />
  );
}
