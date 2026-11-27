/**
 * Cost and usage center:
 * top filters for Agent / Model + a date-range preset (trailing last hour /
 * last 24 hours, calendar 7/30/90 days, or a custom range, whose two dates are picked in the
 * range picker that shows beside it only then);
 * the range alone decides the time-series precision, so there is no second
 * control for it (controls have no external title — the explanation is
 * written into the dropdown options themselves);
 * three summary cards (today / last 7 days / cumulative, each stat on its own row);
 * the Token figures count chat turns only: a tool request a plugin made (an image, a
 * transcription, a search) is a request and a cost like any other, but its Tokens are MMSP's
 * units, so the cards carry its count and cost on a row of its own and a "Tool requests" card
 * below the charts lists them by what they were for — both only while the range has any;
 * a 2x2 grid of time-series charts over the shared range and precision —
 * requests + success rate broken down by Agent and, beside it, the same by
 * Model (requests stacked on the left axis, one rate line per entity on a
 * right 0–100% axis), then Token buckets (stacked bars + a dashed
 * cache-hit-rate curve in front) and cost (line + points + area). Charts
 * always fit their card — nothing scrolls; below them is a full-width
 * "errors" panel (stats + a paged errors table). Currency follows the user's
 * settings.
 *
 * Every chart draws the same buckets: compactSeries runs **once**, here, and
 * all four are fed its result, so the grid keeps one shared x axis. It drops
 * only the buckets where nothing at all was recorded — emptiness is a
 * property of the interval, not of one entity in it, so a bucket any entity
 * ran in stays and the idle entities show their zeros and dashes there. The
 * per-entity counts arrive index-aligned with `series`, so they are
 * re-indexed through the same `kept` list (compactCounts); one list for all
 * of them is what keeps an entity's history from sliding onto the wrong
 * intervals. Each chart marks the skipped intervals on its own axis.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import type {
  ModelRefDto,
  UsageBucket,
  UsageResponse,
  UsageToolRow,
} from "@prismshadow/penguin-server/api";
import {
  Card,
  CardHeader,
  DateRangeField,
  PageFrame,
  PageHeader,
  Select,
  Skeleton,
  TodoNotice,
  Waiting,
} from "@prismshadow/penguin-ui";
import * as api from "@prismshadow/penguin-web/internal";
import {
  S,
  useDocumentTitle,
  useUpdateBadges,
  dismissTodo,
  refreshProjectTodos,
  formatMoney,
  humanizeTokens,
  scoped,
  scopedValue,
  type Scoped,
  useOpenedInProject,
  useProject,
  useTheme,
  compactCounts,
  compactSeries,
  isoDate,
  presetDefaultGranularity,
  presetRange,
  presetTsWindow,
  rangeDays,
  type EntityCounts,
  type RangePreset,
  failureNode,
} from "@prismshadow/penguin-web/internal";
import { catalogEntryFor, providerInfo } from "@prismshadow/penguin-server/model-catalog";
import { TrendChart } from "./trend-chart";
import { RequestsChart, TokenBarChart, TokenLegend, type TokenLegendKey } from "./usage-charts";
import { ErrorsPanel } from "./errors-panel";

/** A summary card's stat row: name on the left, value on the right — each item on its own row, so a narrow card no longer crams them into one wrapping line. */
function SummaryRow({
  label,
  value,
  muted,
  sup,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Show a superscript marker (the cost row's "includes unpriced records" asterisk sits next to the **name**, not stuck after the number). */
  sup?: boolean;
}) {
  const tone = muted ? "text-gray-500 dark:text-gray-400" : "text-gray-900 dark:text-gray-100";
  return (
    <div data-slot="row" className="flex items-baseline justify-between gap-2">
      <span data-slot="label" className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
        {label}
        {sup && <sup className="ml-px">*</sup>}
      </span>
      <span
        data-slot="figure"
        className={`min-w-0 truncate font-mono text-sm font-semibold tabular-nums ${tone}`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Usage summary card: a title + Token / request count / cost each on their own row. It carries
 * the `ui-ledger` hook, its rows the `row` slot, each a `label` beside its `figure`, so a theme
 * may set the three cards apart as a ledger of their own. `showTools` adds the row of tool
 * requests (their count and cost, both already inside Requests and Cost); the page passes the
 * same answer to all three cards so their rows stay level.
 */
function SummaryCard({
  title,
  bucket,
  currency,
  showTools,
}: {
  title: string;
  bucket: UsageBucket;
  currency: "USD" | "CNY";
  showTools: boolean;
}) {
  return (
    <Card className="ui-ledger">
      <CardHeader title={title} />
      <div className="space-y-1">
        <SummaryRow label={S.usage.tokens} value={humanizeTokens(bucket.total)} />
        <SummaryRow label={S.usage.requests} value={String(bucket.requests)} muted />
        {showTools && (
          <SummaryRow
            label={S.usage.toolRequestsIncluded}
            // No tool request costs nothing; the dash is for tool requests that ran unpriced.
            value={`${bucket.toolRequests} · ${formatMoney(
              bucket.toolRequests === 0 ? 0 : bucket.toolCost,
              currency,
            )}`}
            muted
          />
        )}
        {/* The unpriced-records asterisk sits on the word "cost" (superscript), keeping the number clean and readable; see the footer for the explanation */}
        <SummaryRow
          label={S.common.cost}
          value={formatMoney(bucket.cost, currency)}
          sup={bucket.hasUncosted}
        />
      </div>
    </Card>
  );
}

/**
 * A purpose (`<package>:<operation>`) as a row names it: the operation, and the package it came
 * from without its npm scope.
 */
function toolPurposeLabel(purpose: string): { operation: string; source: string } {
  const cut = purpose.lastIndexOf(":");
  if (cut <= 0) return { operation: purpose, source: "" };
  const pkg = purpose.slice(0, cut);
  return { operation: purpose.slice(cut + 1), source: pkg.slice(pkg.lastIndexOf("/") + 1) };
}

/** The tool requests by purpose, one ruled line each: what they were for, how many, and their cost. */
function ToolRequestsList({ tools, currency }: { tools: UsageToolRow[]; currency: "USD" | "CNY" }) {
  return (
    // Fixed layout: the two figures keep their width and the purpose takes the rest of the row.
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col />
        <col className="w-28" />
        <col className="w-32" />
      </colgroup>
      <thead>
        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
          <th className="pb-1 font-normal">{S.usage.toolColumn}</th>
          <th className="pb-1 text-right font-normal">{S.usage.requests}</th>
          <th className="pb-1 text-right font-normal">{S.common.cost}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {tools.map((t) => {
          const { operation, source } = toolPurposeLabel(t.purpose);
          return (
            <tr key={t.purpose} data-tooltip={t.purpose}>
              <td className="truncate py-1.5 pr-3">
                <span className="text-gray-900 dark:text-gray-100">{operation}</span>
                {source && (
                  <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{source}</span>
                )}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">{t.requests}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {formatMoney(t.cost, currency)}
                {t.hasUncosted && <sup className="ml-px">*</sup>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Chart card container: title + content (bounded height, avoiding stretching the whole page and triggering extra scroll). */
function ChartCard({
  title,
  extra,
  children,
}: {
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} actions={extra} />
      {children}
    </Card>
  );
}

/**
 * The range the dashboard last read: the preset and the bounds it resolved to at load time —
 * the two trailing presets add their instant pair (see `loaded` in the page).
 */
interface LoadedRange {
  preset: RangePreset;
  from: string;
  to: string;
  fromTs?: string;
  toTs?: string;
}

/** The `?agentId=` deep link as a filter of the Project the page was opened in; none without either. */
function linkedAgentFilter(
  agentId: string | null,
  projectId: string | null,
): Scoped<string> | null {
  return agentId === null || agentId === "" || projectId === null
    ? null
    : scoped(projectId, agentId);
}

export function UsagePage() {
  useDocumentTitle(S.usage.title);
  const { currency } = useTheme();
  const { currentProject } = useProject();
  /** The Cost Center trail's raised badge, or undefined — the errors panel's notice clears it. */
  const todo = useUpdateBadges().todos.errors;
  const projectId = currentProject?.projectId ?? null;

  // ?agentId= deep link (from the Agents page's "cost" entry point): the URL
  // parameter is the single source of truth for this filter — including
  // clearing it (/usage?agentId=A → clicking nav to /usage doesn't remount,
  // so the filter must be reset); manually changing the filter doesn't write
  // back to the URL (consistent with the existing convention that the model
  // / date filters likewise don't enter the URL — the effect never overrides a manual selection when the parameter is unchanged).
  const [searchParams] = useSearchParams();
  const paramAgentId = searchParams.get("agentId");
  // The filter names an Agent of the Project it was chosen in — the deep link's belongs to the
  // Project the page was opened in — and is read only under that Project (lib/project-scope.ts):
  // after a Project switch the page is unfiltered, rather than asking the new Project about an
  // Agent of the old one.
  const openedIn = useOpenedInProject(projectId);
  const [agentFilterRead, setAgentFilterRead] = useState<Scoped<string> | null>(() =>
    linkedAgentFilter(paramAgentId, openedIn),
  );
  // The deep link is applied again when it changes, and once the Project it belongs to is known
  // — in the render that sees the change, so no read goes out with the filter it replaces.
  const [linkSeen, setLinkSeen] = useState({ paramAgentId, openedIn });
  if (linkSeen.paramAgentId !== paramAgentId || linkSeen.openedIn !== openedIn) {
    setLinkSeen({ paramAgentId, openedIn });
    setAgentFilterRead(linkedAgentFilter(paramAgentId, openedIn));
  }
  const agentFilter = scopedValue(agentFilterRead, projectId) ?? "";
  const setAgentFilter = (agentId: string) =>
    setAgentFilterRead(agentId === "" || projectId === null ? null : scoped(projectId, agentId));
  // Model filtering is a **paired reference** (the same model_id can coexist
  // under multiple providers); the dropdown's option value uses the
  // candidate's index rather than a concatenated string — the reference is always passed as a pair, never concatenated into an id.
  const [modelFilter, setModelFilter] = useState<ModelRefDto | null>(null);
  // Date range: a trailing window (last hour / last 24 hours), a calendar
  // preset (7/30/90 days), or a custom from/to pair — plus the time-series
  // precision. A range change keeps the precision when the new preset still
  // offers it, otherwise snaps to the preset's default.
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [from, setFrom] = useState(() => presetRange("7d", new Date()).from);
  const [to, setTo] = useState(() => presetRange("7d", new Date()).to);
  const applyRange = (nextPreset: RangePreset, nextFrom: string, nextTo: string) => {
    setPreset(nextPreset);
    setFrom(nextFrom);
    setTo(nextTo);
  };
  /** The dashboard's answer, tagged with the Project it was read for. */
  const [dataRead, setData] = useState<Scoped<UsageResponse> | null>(null);
  const data = scopedValue(dataRead, projectId);
  /**
   * The range the dashboard actually READ, which is not always the one the picker holds. A
   * trailing preset computes its window at load time and deliberately leaves `from`/`to` on
   * whatever the last calendar preset put there, so the two diverge the moment "last hour" is
   * chosen. The error panel pages against this range and, for an owner, DELETES against it —
   * so it has to be the range whose rows are on screen, never the stale pair behind them. The
   * memo below reads its primitives one by one so it holds its identity across a reload that
   * changes nothing (the panel's fetch effect depends on that identity).
   */
  const [loaded, setLoaded] = useState<LoadedRange>(() => ({ preset, from, to }));
  const [error, setError] = useState<ReactNode>(null);
  // The legend / control state that lives in the card headers (ChartCard's
  // extra) while the marks live inside the cards, lifted to this level.
  const [tokenBucket, setTokenBucket] = useState<TokenLegendKey | null>(null);

  /** Dashboard reads so far: only the newest one's answer is applied. */
  const asked = useRef(0);
  const load = useCallback(async () => {
    if (!projectId) return;
    const ask = ++asked.current;
    // The notice must acknowledge the errors fetched for this visit, not the timestamp
    // cached when the app started; otherwise those errors return as unread after a reload.
    refreshProjectTodos(projectId);
    setError(null);
    try {
      // The trailing presets recompute their window at load time, so a reload
      // keeps trailing "now"; the calendar presets use the stored date pair.
      const range =
        preset === "1h" || preset === "1d" ? presetTsWindow(preset, new Date()) : { from, to };
      const res = await api.getUsage(projectId, {
        ...range,
        // The detail table has been removed, superseded by the charts above; groupBy is still a required query parameter, fixed to group by date.
        groupBy: "date",
        // The range picks the precision — there is no separate control, and this
        // is the only place the choice is made (see presetDefaultGranularity).
        granularity: presetDefaultGranularity(preset, rangeDays(from, to)),
        ...(agentFilter ? { agentId: agentFilter } : {}),
        ...(modelFilter ? { provider: modelFilter.provider, modelId: modelFilter.modelId } : {}),
      });
      // A late answer — for the Project just left, or for filters changed since — is dropped.
      if (ask !== asked.current) return;
      setData(scoped(projectId, res));
      setLoaded({ preset, ...range });
    } catch (e) {
      if (ask === asked.current) {
        setError(failureNode(e, { what: "the Cost Center could not be loaded" }));
      }
    }
  }, [projectId, preset, from, to, agentFilter, modelFilter?.provider, modelFilter?.modelId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // The error panel pages against this filter and depends on the object's identity, so it is
  // built once per filter value rather than fresh on every render — a new object each render
  // would refetch the current page on any unrelated state change (hovering a chart bucket).
  // Built from the range the dashboard read (see `loaded`), not from the picker's state: the
  // panel's rows, its later pages and its clear all have to name one same set. The model
  // filter is deliberately absent: it never applied to errors.
  const errorFilters = useMemo(
    () => ({
      from: loaded.from,
      to: loaded.to,
      ...(loaded.fromTs !== undefined && loaded.toTs !== undefined
        ? { fromTs: loaded.fromTs, toTs: loaded.toTs }
        : {}),
      ...(agentFilter ? { agentId: agentFilter } : {}),
    }),
    [loaded.from, loaded.to, loaded.fromTs, loaded.toTs, agentFilter],
  );

  if (!projectId) return null;

  // Model filter candidates and the currently selected item's index (the option value uses the index, avoiding concatenating an id as the key).
  const modelOptions = data?.models ?? [];
  // A model is named by its catalog name; where two providers sell one name, the provider joins
  // it, so the filter and the requests chart never show two identical labels.
  const modelName = (ref: ModelRefDto) =>
    catalogEntryFor(ref.provider, ref.modelId)?.displayName ?? ref.modelId;
  const refs = new Map<string, ModelRefDto>();
  for (const ref of [...modelOptions, ...(data?.byModelSeries ?? [])]) {
    refs.set(`${ref.provider}\u0000${ref.modelId}`, ref);
  }
  const nameCount = new Map<string, number>();
  for (const ref of refs.values()) {
    const name = modelName(ref);
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const modelLabel = (ref: ModelRefDto) => {
    const name = modelName(ref);
    return (nameCount.get(name) ?? 0) > 1
      ? S.models.modelInGroup(name, providerInfo(ref.provider)?.label ?? ref.provider)
      : name;
  };
  const selectedModelIndex = modelFilter
    ? modelOptions.findIndex(
        (m) => m.provider === modelFilter.provider && m.modelId === modelFilter.modelId,
      )
    : -1;
  const modelFilterIndex = selectedModelIndex >= 0 ? String(selectedModelIndex) : "";

  const summary = data?.summary;
  const hasUncostedRows =
    (summary?.today.hasUncosted ?? false) ||
    (summary?.last7d.hasUncosted ?? false) ||
    (summary?.total.hasUncosted ?? false) ||
    (data?.tools ?? []).some((t) => t.hasUncosted);
  const showTools =
    summary !== undefined &&
    [summary.today, summary.last7d, summary.total].some((b) => b.toolRequests > 0);

  // One compaction for the whole page (see the file header): every chart draws
  // these buckets, and every per-entity series is re-indexed through the same
  // kept list, so nothing can drift out of alignment with the axis.
  const plotted = compactSeries(data?.series ?? []);
  // The two requests charts each get one dimension's entity list, already
  // sorted by total requests descending and arriving index-aligned with the
  // full `series` (the server's contract) — compactCounts moves it onto the
  // drawn buckets; the charts fold their own tails.
  const agentEntities: EntityCounts[] = (data?.byAgentSeries ?? []).map((s) => ({
    label: s.agentId,
    ...compactCounts(s, plotted.kept),
  }));
  const modelEntities: EntityCounts[] = (data?.byModelSeries ?? []).map((s) => ({
    label: modelLabel(s),
    ...compactCounts(s, plotted.kept),
  }));
  return (
    <PageFrame contentClassName="space-y-4">
      {/* The filters are the header's actions: they carry no external title (the explanation is
          written into the "all …" option), so they sit centred on the title row. */}
      <PageHeader
        title={S.usage.title}
        actions={
          <>
            <div className="w-32">
              <Select
                size="sm"
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="">{S.usage.filterAllAgents}</option>
                {/* The deep-linked agent must still show as the selected option even if it has no usage records yet (not in agentIds) */}
                {agentFilter && !(data?.agentIds ?? []).includes(agentFilter) && (
                  <option value={agentFilter}>{agentFilter}</option>
                )}
                {(data?.agentIds ?? []).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-32">
              <Select
                size="sm"
                value={modelFilterIndex}
                onChange={(e) => {
                  const i = e.target.value;
                  setModelFilter(i === "" ? null : (modelOptions[Number(i)] ?? null));
                }}
              >
                <option value="">{S.usage.filterAllModels}</option>
                {modelOptions.map((m, i) => (
                  <option key={`${m.provider}:${m.modelId}`} value={String(i)}>
                    {modelLabel(m)}
                  </option>
                ))}
              </Select>
            </div>
            {/* Date range: the trailing windows, the calendar presets, and "custom", which reveals
                the range field */}
            <div className="w-28">
              <Select
                size="sm"
                value={preset}
                aria-label={S.usage.rangeLabel}
                onChange={(e) => {
                  const next = e.target.value as RangePreset;
                  if (next === "7d" || next === "30d" || next === "90d") {
                    const r = presetRange(next, new Date());
                    applyRange(next, r.from, r.to);
                  } else {
                    // Trailing windows compute their bounds at load time; custom keeps the dates already picked.
                    applyRange(next, from, to);
                  }
                }}
              >
                <option value="1h">{S.usage.rangeHour}</option>
                <option value="1d">{S.usage.rangeDay}</option>
                <option value="7d">{S.usage.range7d}</option>
                <option value="30d">{S.usage.range30d}</option>
                <option value="90d">{S.usage.range90d}</option>
                <option value="custom">{S.usage.rangeCustom}</option>
              </Select>
            </div>
            {preset === "custom" && (
              /* The custom range's two dates, shown only while the range is the custom one: a
                 preset names its own span in the Select, so it has nothing to pick here. As wide
                 as its two full dates in the theme's face, which differs from theme to theme,
                 and narrower only when the row has no room. */
              <div className="max-w-full">
                <DateRangeField
                  size="sm"
                  aria-label={S.usage.rangeDates}
                  required
                  from={from}
                  to={to}
                  max={isoDate(new Date())}
                  onChange={(range) => applyRange("custom", range.from, range.to)}
                />
              </div>
            )}
          </>
        }
      />

      {/* Last stop on the Cost Center trail, in the one shape all four dismissible trails
          use: directly under the title, not down against the errors table. It counts the
          probe's own trailing window (use-project-todos.ts), which is not the filters above
          it, so it states what the badge is about rather than what any one panel is showing.
          "Read", not "done" — nothing is being updated here, the user has simply looked, and
          this is the one of the four that offers no bulk action: a past error cannot be
          updated, so the block renders the dismiss control alone. */}
      {todo && (
        <TodoNotice
          text={S.todo.unexpectedErrors(todo.count)}
          dismissLabel={S.todo.markRead}
          onDismiss={() => dismissTodo(projectId, "errors", todo.signature)}
        />
      )}

      {/* Summary cards (today / last 7 days / cumulative) */}
      {data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            title={S.usage.today}
            bucket={data.summary.today}
            currency={currency}
            showTools={showTools}
          />
          <SummaryCard
            title={S.usage.last7d}
            bucket={data.summary.last7d}
            currency={currency}
            showTools={showTools}
          />
          <SummaryCard
            title={S.usage.total}
            bucket={data.summary.total}
            currency={currency}
            showTools={showTools}
          />
        </div>
      ) : (
        <Waiting className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </Waiting>
      )}

      {/* Time-series charts, all over the shared range + precision: requests +
          success rate by Agent and by Model on the first row, Token buckets +
          cache hit rate and cost on the second. Charts always fit their card — nothing scrolls. */}
      {data ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ChartCard title={S.usage.chartRequestsByAgent}>
            <RequestsChart
              label={S.usage.chartRequestsByAgent}
              series={plotted.points}
              entities={agentEntities}
              granularity={data.granularity}
              breaks={plotted.breaks}
            />
          </ChartCard>
          <ChartCard title={S.usage.chartRequestsByModel}>
            <RequestsChart
              label={S.usage.chartRequestsByModel}
              series={plotted.points}
              entities={modelEntities}
              granularity={data.granularity}
              breaks={plotted.breaks}
            />
          </ChartCard>
          {/* The Token legend lives in its card header while its marks live inside the card, so that state is lifted to this level */}
          <ChartCard
            title={S.usage.chartTokenTrend}
            extra={<TokenLegend active={tokenBucket} onHover={setTokenBucket} />}
          >
            <TokenBarChart
              label={S.usage.chartTokenTrend}
              series={plotted.points}
              granularity={data.granularity}
              legend={tokenBucket}
              breaks={plotted.breaks}
            />
          </ChartCard>
          <ChartCard title={S.usage.chartCostTrend}>
            <TrendChart
              label={S.usage.chartCostTrend}
              series={plotted.points}
              granularity={data.granularity}
              currency={currency}
              breaks={plotted.breaks}
            />
          </ChartCard>
        </div>
      ) : (
        <Waiting>
          <Skeleton className="h-64" />
        </Waiting>
      )}

      {/* Tool requests over the selected range, by what they were for (only while there are any) */}
      {data && data.tools.length > 0 && (
        <ChartCard title={S.usage.toolRequests}>
          <ToolRequestsList tools={data.tools} currency={currency} />
        </ChartCard>
      )}

      {/* Errors (a single full-width panel: stats + a recent-errors table) */}
      {data && (
        <ChartCard title={S.usage.errors}>
          <ErrorsPanel
            errors={data.errors}
            projectId={projectId}
            filters={errorFilters}
            preset={loaded.preset === "custom" ? undefined : loaded.preset}
            // Clearing the log is a Project-level management operation, gated on the owner
            // by the route; a member reads the panel without the action.
            canClear={currentProject?.role === "owner"}
            // Reload both the table and its notice after clearing the log.
            onCleared={() => {
              void load();
            }}
          />
        </ChartCard>
      )}

      {hasUncostedRows && <p className="text-xs text-gray-400">{S.usage.uncostedNote}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </PageFrame>
  );
}
