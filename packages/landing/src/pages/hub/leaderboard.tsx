/**
 * One leaderboard. The results panel takes the page's width: its three views of the same entries,
 * one at a time (the choice is `?chart=` in the URL), with a toolbar that filters the entries for
 * every view and picks the ranking's columns. Under it, the calculation with its real values and
 * where they come from; then the facts and the benchmarks it measures on.
 *
 * An entry is named by what the board's entries differ in: the algorithm when they compare
 * algorithms, the harness when they compare harnesses, else the model. Each entry keeps one
 * colour across the views.
 */
import { useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useSiteLocale } from "@prismshadow/penguin-ui/site";
import {
  AuthorName,
  CountTitle,
  HubDetail,
  HubMissing,
  HubPanel,
  HubPending,
  useHubDetail,
} from "../../components/hub/hub-detail";
import { HubTag, HubTile } from "../../components/hub/hub-icon";
import { ExternalLink } from "../../components/external-link";
import { labelsOf } from "../../components/hub/charts/chart-kit";
import { boardColours } from "../../components/hub/charts/entry-colour";
import type { NameOf } from "../../components/hub/charts/entry-name";
import { MethodDetail } from "../../components/hub/charts/method-detail";
import { ParetoChart } from "../../components/hub/charts/pareto-chart";
import {
  BenchmarkName,
  OPTIONAL,
  ScoreTable,
  initialHidden,
} from "../../components/hub/charts/score-table";
import type { Column, NameColumn } from "../../components/hub/charts/score-table";
import { MenuCheck, ToolbarMenu } from "../../components/hub/charts/toolbar-menu";
import { WaffleChart } from "../../components/hub/charts/waffle-chart";
import { useDocumentMeta } from "../../lib/document-meta";
import { benchmarks, plugins } from "../../lib/hub/data";
import { formatDay, titleOf } from "../../lib/hub/text";
import { KIND_TONE } from "../../lib/hub/tones";
import type { ChartKind, LeaderboardDetail, LeaderboardEntry } from "../../lib/hub/types";
import { S } from "../../lib/strings";

const KINDS: ChartKind[] = ["table", "pareto", "waffle"];
const TONE = KIND_TONE.leaderboard;

type FilterKey = "model" | "harness" | "algorithm" | "thinking";
const FILTERS: readonly FilterKey[] = ["algorithm", "harness", "model", "thinking"];

const distinct = (values: readonly string[]): string[] => [...new Set(values)];
const listed = new Set(benchmarks.map((benchmark) => benchmark.id));

export function LeaderboardPage() {
  const { id = "" } = useParams();
  const board = useHubDetail("leaderboard", id);
  if (board === undefined) return <HubPending />;
  if (board === null) return <HubMissing listHref="/leaderboards" />;
  return <LeaderboardView board={board} />;
}

/** The column an entry is named by: the first of algorithm, harness, model its entries differ in. */
function nameColumnOf(entries: readonly LeaderboardEntry[]): NameColumn {
  const varies = (read: (entry: LeaderboardEntry) => string) =>
    distinct(entries.map(read)).length > 1;
  if (varies((entry) => entry.algorithm ?? "")) return "algorithm";
  if (varies((entry) => entry.harness)) return "harness";
  if (varies((entry) => entry.model)) return "model";
  return "algorithm";
}

function LeaderboardView({ board }: { board: LeaderboardDetail }) {
  const t = S.hub.leaderboards;
  const { locale } = useSiteLocale();
  const [params, setParams] = useSearchParams();
  const title = titleOf(locale, board);
  useDocumentMeta(S.hub.pageTitle(title), t.description);
  const kind = KINDS.find((candidate) => candidate === params.get("chart")) ?? KINDS[0]!;

  const pluginTitles = new Map(plugins.map((plugin) => [plugin.id, titleOf(locale, plugin)]));
  const algorithmOf = (entry: LeaderboardEntry) =>
    entry.algorithm ? (pluginTitles.get(entry.algorithm) ?? entry.algorithm) : t.baseline;
  const nameColumn = nameColumnOf(board.entries);
  const nameOf: NameOf = (entry) => ({
    method:
      nameColumn === "algorithm"
        ? algorithmOf(entry)
        : nameColumn === "harness"
          ? entry.harness
          : entry.model,
    model: entry.model,
  });
  const labels = new Map(
    labelsOf(board.entries, nameOf).map((label, i) => [board.entries[i]!.key, label]),
  );
  const labelOf = (entry: LeaderboardEntry) => labels.get(entry.key) ?? nameOf(entry).method;
  const colours = boardColours(board.entries);
  const benchmarkTitles = new Map(board.benchmarks.map((item) => [item.id, titleOf(locale, item)]));
  const benchmarkTitle = (id: string) => benchmarkTitles.get(id) ?? id;
  const benchmarkListed = (id: string) => listed.has(id);

  const [chosen, setChosen] = useState<Partial<Record<FilterKey, readonly string[]>>>({});
  const [hidden, setHidden] = useState<ReadonlySet<Column>>(
    () => new Set(initialHidden(nameColumn)),
  );
  const valueOf: Record<FilterKey, (entry: LeaderboardEntry) => string> = {
    model: (entry) => entry.model,
    harness: (entry) => entry.harness,
    algorithm: algorithmOf,
    thinking: (entry) => entry.thinking,
  };
  const filters = FILTERS.map((key) => ({
    key,
    values: distinct(board.entries.map(valueOf[key]).filter((value) => value !== "")),
  })).filter((filter) => filter.values.length > 1);
  const keep = board.entries.map((entry) =>
    filters.every(({ key }) => {
      const values = chosen[key] ?? [];
      return values.length === 0 || values.includes(valueOf[key](entry));
    }),
  );
  const shown = board.entries.filter((_, i) => keep[i]);
  const grid = { tasks: board.waffle.tasks, rows: board.waffle.rows.filter((_, i) => keep[i]) };
  const active = filters.reduce((sum, { key }) => sum + (chosen[key]?.length ?? 0), 0);

  const toggleChoice = (key: FilterKey, value: string) =>
    setChosen((current) => {
      const values = current[key] ?? [];
      return {
        ...current,
        [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
      };
    });
  const toggleColumn = (column: Column) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });

  const tabs = (
    <div
      role="tablist"
      aria-label={t.chartsLabel}
      className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-800 dark:bg-gray-900"
    >
      {KINDS.map((candidate, index) => (
        <button
          key={candidate}
          type="button"
          role="tab"
          aria-selected={candidate === kind}
          onClick={() =>
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                if (index === 0) next.delete("chart");
                else next.set("chart", candidate);
                return next;
              },
              { replace: true, preventScrollReset: true },
            )
          }
          className={`rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors ${
            candidate === kind
              ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
              : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          }`}
        >
          {t.charts[candidate]}
        </button>
      ))}
    </div>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {tabs}
      {filters.length > 0 && (
        <ToolbarMenu label={t.filter} glyph="slidersHorizontal" count={active}>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {filters.map(({ key, values }) => (
              <div key={key} role="group" aria-label={t.filterLabel(t.filters[key])}>
                <p className="px-2 pt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t.filters[key]}
                </p>
                {values.map((value) => (
                  <MenuCheck
                    key={value}
                    checked={(chosen[key] ?? []).includes(value)}
                    onChange={() => toggleChoice(key, value)}
                  >
                    <span title={value}>{value}</span>
                  </MenuCheck>
                ))}
              </div>
            ))}
          </div>
          {active > 0 && (
            <button
              type="button"
              onClick={() => setChosen({})}
              className="mt-1 w-full rounded-md border-t border-gray-100 px-2 py-1.5 text-left text-brand-700 hover:bg-gray-100 dark:border-gray-800 dark:text-brand-300 dark:hover:bg-gray-800"
            >
              {S.hub.clearFilters}
            </button>
          )}
        </ToolbarMenu>
      )}
      {kind === "table" && (
        <ToolbarMenu label={t.columns} glyph="tiles">
          {OPTIONAL.map((column) => (
            <MenuCheck
              key={column}
              checked={!hidden.has(column)}
              onChange={() => toggleColumn(column)}
            >
              {column === "model" ? t.model : t.columnNames[column]}
            </MenuCheck>
          ))}
        </ToolbarMenu>
      )}
    </div>
  );

  return (
    <HubDetail
      layout="stacked"
      lead={<HubTile tone={TONE} glyph="trophy" size="lg" />}
      title={title}
      sourceUrl={board.sourceUrl}
      tags={
        <>
          <HubTag tone="emerald" glyph="checkCircle">
            {S.hub.status.published}
          </HubTag>
          <HubTag glyph="barChart">{t.entryCount(board.entryCount)}</HubTag>
          <HubTag glyph="target">{t.benchmarkCount(board.benchmarks.length)}</HubTag>
          <HubTag glyph="calendar">{formatDay(board.updated, locale)}</HubTag>
        </>
      }
      facts={[
        { label: S.hub.meta.author, value: <AuthorName author={board.author} /> },
        { label: S.hub.meta.updated, value: formatDay(board.updated, locale) },
        { label: t.entries, value: board.entryCount },
      ]}
      aside={
        <HubPanel
          title={<CountTitle label={t.benchmarks} count={board.benchmarks.length} />}
          glyph="target"
          tone={TONE}
          flush
        >
          <ul className="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            {board.benchmarks.map((item) => (
              <li key={item.id} className="px-4 py-2.5">
                <BenchmarkName
                  id={item.id}
                  title={titleOf(locale, item)}
                  listed={benchmarkListed(item.id)}
                />
              </li>
            ))}
          </ul>
        </HubPanel>
      }
    >
      <HubPanel title={t.results} glyph="barChart" tone={TONE} actions={toolbar}>
        {kind === "table" && (
          <ScoreTable
            entries={shown}
            all={board.entries}
            hidden={hidden}
            nameColumn={nameColumn}
            algorithmOf={algorithmOf}
            colourOf={colours.of}
            benchmarkTitle={benchmarkTitle}
            benchmarkListed={benchmarkListed}
            filtered={active > 0}
            onClearFilters={() => setChosen({})}
          />
        )}
        {kind === "pareto" && (
          <ParetoChart
            entries={shown}
            nameOf={nameOf}
            colourOf={colours.of}
            colourPoints={colours.scatter}
          />
        )}
        {kind === "waffle" && (
          <WaffleChart
            entries={shown}
            grid={grid}
            nameOf={nameOf}
            taskTitles={board.taskTitles}
            benchmarkTitle={benchmarkTitle}
            benchmarkListed={benchmarkListed}
            colourOf={colours.of}
          />
        )}
        {kind !== "table" && shown.length === 0 && (
          <div className="py-10 text-center text-sm text-gray-600 dark:text-gray-400">
            <p>{t.noMatch}</p>
            <button
              type="button"
              onClick={() => setChosen({})}
              className="mt-2 text-brand-700 hover:underline dark:text-brand-300"
            >
              {S.hub.clearFilters}
            </button>
          </div>
        )}
      </HubPanel>
      <HubPanel title={t.method.title} glyph="hash" tone={TONE}>
        <MethodDetail
          entries={board.entries}
          labelOf={labelOf}
          colourOf={colours.of}
          benchmarkTitle={benchmarkTitle}
          benchmarkListed={benchmarkListed}
        />
        <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 border-t border-gray-100 pt-4 text-sm dark:border-gray-800">
          <dt className="text-gray-500 dark:text-gray-400">{t.method.config}</dt>
          <dd className="min-w-0 truncate">
            <ExternalLink
              href={board.sourceUrl}
              className="text-brand-700 hover:underline dark:text-brand-300"
            >
              {board.sourceUrl
                .replace(/^https:\/\/github\.com\/[^/]+\//, "")
                .replace("/blob/main/", "/")}
            </ExternalLink>
          </dd>
          <dt className="text-gray-500 dark:text-gray-400">{t.method.experiments}</dt>
          <dd className="min-w-0 truncate">
            <ExternalLink
              href={board.experimentsUrl}
              className="text-brand-700 hover:underline dark:text-brand-300"
            >
              {board.experimentsUrl
                .replace(/^https:\/\/github\.com\/[^/]+\//, "")
                .replace("/tree/main/", "/")}
            </ExternalLink>
          </dd>
        </dl>
      </HubPanel>
    </HubDetail>
  );
}
