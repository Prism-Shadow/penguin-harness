/** The benchmarks of penguin-harness-benchmark, read from a fresh clone at build time. */
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import { CardFact, HubCard } from "../../components/hub/hub-card";
import { HubTile } from "../../components/hub/hub-icon";
import { HubList } from "../../components/hub/hub-list";
import type { HubFacet } from "../../components/hub/hub-list";
import { useDocumentMeta } from "../../lib/document-meta";
import { benchmarks, leaderboards } from "../../lib/hub/data";
import { timeoutBucket } from "../../lib/hub/filter";
import { formatDay, titleOf } from "../../lib/hub/text";
import type { BenchmarkSummary } from "../../lib/hub/types";
import { BENCHMARK_REPO_URL } from "../../lib/links";
import { benchmarkTone } from "../../lib/hub/tones";
import { S } from "../../lib/strings";

const TIMEOUT_ORDER = ["short", "hour", "long", "none"];

export function BenchmarksPage() {
  const { locale } = useSiteLocale();
  useDocumentMeta(S.hub.pageTitle(S.hub.benchmarks.title), S.hub.benchmarks.description);
  const facets: HubFacet<BenchmarkSummary>[] = [
    {
      id: "time",
      label: S.hub.benchmarks.facetTimeout,
      values: (benchmark) => [timeoutBucket(benchmark.maxTimeout)],
      valueLabel: (value) => S.hub.benchmarks.timeout[value] ?? value,
      order: TIMEOUT_ORDER,
    },
    {
      id: "board",
      label: S.hub.benchmarks.facetLeaderboard,
      values: (benchmark) =>
        leaderboards.some((board) => board.benchmarks.includes(benchmark.id)) ? ["yes"] : [],
      valueLabel: () => S.hub.benchmarks.onLeaderboard,
    },
    {
      id: "status",
      label: S.hub.benchmarks.facetStatus,
      values: (benchmark) => [benchmark.status],
      valueLabel: (value) => S.hub.status[value] ?? value,
    },
    {
      id: "author",
      label: S.hub.benchmarks.facetAuthor,
      values: (benchmark) => [benchmark.author.name],
      valueLabel: (value) => value,
    },
  ];
  return (
    <HubList
      title={S.hub.benchmarks.title}
      source={{ href: BENCHMARK_REPO_URL, label: "Prism-Shadow/penguin-harness-benchmark" }}
      items={benchmarks}
      keyOf={(benchmark) => benchmark.id}
      texts={(benchmark) => [
        benchmark.id,
        benchmark.title,
        benchmark.titleZh,
        benchmark.description,
        benchmark.descriptionZh,
        benchmark.author.name,
      ]}
      facets={facets}
      sorts={[
        {
          id: "updated",
          label: S.hub.sortLatest,
          compare: (a, b) => b.lastUpdate.localeCompare(a.lastUpdate) || a.id.localeCompare(b.id),
        },
        {
          id: "name",
          label: S.hub.sortName,
          compare: (a, b) => titleOf(locale, a).localeCompare(titleOf(locale, b), locale),
        },
      ]}
      renderItem={(benchmark) => (
        <HubCard
          to={`/benchmarks/${benchmark.id}`}
          title={titleOf(locale, benchmark)}
          lead={<HubTile tone={benchmarkTone(benchmark.id)} glyph="target" />}
          facts={[
            <CardFact glyph="user">{benchmark.author.name}</CardFact>,
            <CardFact glyph="kanban">{S.hub.benchmarks.taskCount(benchmark.taskCount)}</CardFact>,
            <CardFact glyph="calendar">{formatDay(benchmark.lastUpdate, locale)}</CardFact>,
          ]}
        />
      )}
    />
  );
}
