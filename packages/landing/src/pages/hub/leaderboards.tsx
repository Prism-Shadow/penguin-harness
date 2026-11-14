/** The leaderboards: penguin-harness-benchmark's, or the placeholder that stands in for them. */
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { CardFact, HubCard } from "../../components/hub/hub-card";
import { HubTile } from "../../components/hub/hub-icon";
import { HubList } from "../../components/hub/hub-list";
import type { HubFacet } from "../../components/hub/hub-list";
import { useDocumentMeta } from "../../lib/document-meta";
import { leaderboards } from "../../lib/hub/data";
import { formatDay, titleOf } from "../../lib/hub/text";
import type { LeaderboardSummary } from "../../lib/hub/types";
import { BENCHMARK_REPO_URL } from "../../lib/links";
import { KIND_TONE } from "../../lib/hub/tones";
import { S } from "../../lib/strings";

export function LeaderboardsPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(S.hub.pageTitle(S.hub.leaderboards.title), S.hub.leaderboards.description);
  const facets: HubFacet<LeaderboardSummary>[] = [
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
          lead={<HubTile tone={KIND_TONE.leaderboard} glyph="trophy" />}
          facts={[
            <CardFact glyph="user">{board.author.name}</CardFact>,
            <CardFact glyph="barChart">{S.hub.leaderboards.entryCount(board.entryCount)}</CardFact>,
            <CardFact glyph="target">
              {S.hub.leaderboards.benchmarkCount(board.benchmarkCount)}
            </CardFact>,
            <CardFact glyph="calendar">{formatDay(board.updated, locale)}</CardFact>,
          ]}
        />
      )}
    />
  );
}
