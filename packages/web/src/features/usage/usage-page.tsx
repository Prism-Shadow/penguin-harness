/**
 * Cost and usage center:
 * top filters for Agent / Model + a date-range preset (trailing last hour /
 * last 24 hours, calendar 7/30/90 days, or a custom pair of date inputs) + a
 * time-series precision (minute / hour / day / week / month, constrained by
 * the preset — controls have no external title, the explanation is written
 * into the dropdown options themselves);
 * three summary cards (today / last 7 days / cumulative, each stat on its own row);
 * time-series charts over the shared range and precision — the full-width
 * requests + success-rate combo (bars on the left axis, the rate line on a
 * right 0–100% axis, dimension/entity controls in the card header), then
 * Token buckets (stacked bars + a dashed cache-hit-rate curve in front) and
 * cost (line + points + area) side by side. Charts always fit their card —
 * nothing scrolls; below them is a full-width "errors" panel (stats + a paged
 * errors table). Currency follows the user's settings.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import type {
  ModelRefDto,
  UsageBucket,
  UsageGranularity,
  UsageResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatMoney, humanizeTokens } from "../../lib/format";
import { catalogEntryFor } from "@prismshadow/penguin-core/model-catalog";
import { useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TrendChart } from "./trend-chart";
import {
  RequestsChart,
  RequestsControls,
  TokenBarChart,
  TokenLegend,
  type RequestsDimension,
  type RequestsEntity,
  type TokenLegendKey,
} from "./usage-charts";
import {
  coerceGranularity,
  presetGranularities,
  presetRange,
  presetTsWindow,
  rangeDays,
  type RangePreset,
} from "./usage-controls";
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
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
        {label}
        {sup && <sup className="ml-px">*</sup>}
      </span>
      <span className={`min-w-0 truncate font-mono text-sm font-semibold tabular-nums ${tone}`}>
        {value}
      </span>
    </div>
  );
}

/** Usage summary card: a title + Token / request count / cost each on their own row. */
function SummaryCard({
  title,
  bucket,
  currency,
}: {
  title: string;
  bucket: UsageBucket;
  currency: "USD" | "CNY";
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <div className="space-y-0.5">
        <SummaryRow label={S.usage.tokens} value={humanizeTokens(bucket.total)} />
        <SummaryRow label={S.usage.requests} value={String(bucket.requests)} muted />
        {/* The unpriced-records asterisk sits on the word "cost" (superscript), keeping the number clean and readable; see the footer for the explanation */}
        <SummaryRow
          label={S.common.cost}
          value={formatMoney(bucket.cost, currency)}
          sup={bucket.hasUncosted}
        />
      </div>
    </div>
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
    <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
        {extra}
      </div>
      {children}
    </div>
  );
}

export function UsagePage() {
  useDocumentTitle(S.usage.title);
  const { currency } = useTheme();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;

  // ?agentId= deep link (from the Agents page's "cost" entry point): the URL
  // parameter is the single source of truth for this filter — including
  // clearing it (/usage?agentId=A → clicking nav to /usage doesn't remount,
  // so the filter must be reset); manually changing the filter doesn't write
  // back to the URL (consistent with the existing convention that the model
  // / date filters likewise don't enter the URL — the effect never overrides a manual selection when the parameter is unchanged).
  const [searchParams] = useSearchParams();
  const paramAgentId = searchParams.get("agentId");
  const [agentFilter, setAgentFilter] = useState<string>(paramAgentId ?? "");
  // Model filtering is a **paired reference** (the same model_id can coexist
  // under multiple providers); the dropdown's option value uses the
  // candidate's index rather than a concatenated string — the reference is always passed as a pair, never concatenated into an id.
  const [modelFilter, setModelFilter] = useState<ModelRefDto | null>(null);
  useEffect(() => {
    setAgentFilter(paramAgentId ?? "");
  }, [paramAgentId]);
  // Date range: a trailing window (last hour / last 24 hours), a calendar
  // preset (7/30/90 days), or a custom from/to pair — plus the time-series
  // precision. A range change keeps the precision when the new preset still
  // offers it, otherwise snaps to the preset's default.
  const [preset, setPreset] = useState<RangePreset>("7d");
  const [from, setFrom] = useState(() => presetRange("7d", new Date()).from);
  const [to, setTo] = useState(() => presetRange("7d", new Date()).to);
  const [granularity, setGranularity] = useState<UsageGranularity>("day");
  const applyRange = (nextPreset: RangePreset, nextFrom: string, nextTo: string) => {
    setPreset(nextPreset);
    setFrom(nextFrom);
    setTo(nextTo);
    setGranularity((g) => coerceGranularity(g, nextPreset, rangeDays(nextFrom, nextTo)));
  };
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The legend / control state that lives in the card headers (ChartCard's
  // extra) while the marks live inside the cards, lifted to this level.
  const [tokenBucket, setTokenBucket] = useState<TokenLegendKey | null>(null);
  const [reqDim, setReqDim] = useState<RequestsDimension>("agent");
  const [reqEntity, setReqEntity] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
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
        granularity,
        ...(agentFilter ? { agentId: agentFilter } : {}),
        ...(modelFilter ? { provider: modelFilter.provider, modelId: modelFilter.modelId } : {}),
      });
      setData(res);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [
    projectId,
    preset,
    from,
    to,
    granularity,
    agentFilter,
    modelFilter?.provider,
    modelFilter?.modelId,
  ]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  // The error panel pages against this filter and depends on the object's identity, so it is
  // built once per filter value rather than fresh on every render — a new object each render
  // would refetch the current page on any unrelated state change (hovering a chart bucket).
  // The model filter is deliberately absent: it never applied to errors.
  const errorFilters = useMemo(
    () => ({ from, to, ...(agentFilter ? { agentId: agentFilter } : {}) }),
    [from, to, agentFilter],
  );

  if (!projectId) return null;

  // Model filter candidates and the currently selected item's index (the option value uses the index, avoiding concatenating an id as the key).
  const modelOptions = data?.models ?? [];
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
    (summary?.total.hasUncosted ?? false);

  // Precision choices follow the selected preset/range; the requests chart's
  // entity list follows its dimension toggle (its controls live in the card
  // header, so both are built here).
  const gOptions = presetGranularities(preset, rangeDays(from, to));
  const entityOptions: RequestsEntity[] = !data
    ? []
    : reqDim === "agent"
      ? data.byAgentSeries.map((s) => ({
          label: s.agentId,
          requests: s.requests,
          completed: s.completed,
          denominator: s.denominator,
        }))
      : data.byModelSeries.map((s) => ({
          label: catalogEntryFor(s.provider, s.modelId)?.displayName ?? s.modelId,
          requests: s.requests,
          completed: s.completed,
          denominator: s.denominator,
        }));
  // Self-healing selection: a stale index (the entity list shrank under a new
  // filter or dimension) falls back to "all" instead of a blank dropdown.
  const reqSelected =
    reqEntity !== "" && Number(reqEntity) < entityOptions.length ? Number(reqEntity) : null;
  const granularityLabel = (g: UsageGranularity): string => {
    if (g === "minute") return S.usage.granularityMinute;
    if (g === "hour") return S.usage.granularityHour;
    if (g === "day") return S.usage.granularityDay;
    if (g === "week") return S.usage.granularityWeek;
    return S.usage.granularityMonth;
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Top filters: controls have no external title (the explanation is written into the "all …" option), so they're baseline-centered with the page title */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{S.usage.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
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
                    {catalogEntryFor(m.provider, m.modelId)?.displayName ?? m.modelId}
                  </option>
                ))}
              </Select>
            </div>
            {/* Date range: trailing windows and quick presets, with "custom" revealing the two date inputs */}
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
              /* A dash between the two inputs stands in for a "from/to" label */
              <div className="flex items-center gap-1.5">
                <Input
                  size="sm"
                  type="date"
                  aria-label={S.usage.from}
                  value={from}
                  onChange={(e) => applyRange("custom", e.target.value, to)}
                />
                <span className="shrink-0 text-gray-400" aria-hidden>
                  –
                </span>
                <Input
                  size="sm"
                  type="date"
                  aria-label={S.usage.to}
                  value={to}
                  onChange={(e) => applyRange("custom", from, e.target.value)}
                />
              </div>
            )}
            {/* Time-series precision, constrained by the range (see granularityOptions) */}
            <div className="w-20">
              <Select
                size="sm"
                value={granularity}
                aria-label={S.usage.granularityLabel}
                onChange={(e) => setGranularity(e.target.value as UsageGranularity)}
              >
                {gOptions.map((g) => (
                  <option key={g} value={g}>
                    {granularityLabel(g)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>

        {/* Summary cards (today / last 7 days / cumulative) */}
        {data ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryCard title={S.usage.today} bucket={data.summary.today} currency={currency} />
            <SummaryCard title={S.usage.last7d} bucket={data.summary.last7d} currency={currency} />
            <SummaryCard title={S.usage.total} bucket={data.summary.total} currency={currency} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        )}

        {/* Time-series charts, all over the shared range + precision: the
            full-width requests + success-rate combo, then Token buckets +
            cache hit rate and cost side by side. Charts always fit their card — nothing scrolls. */}
        {data ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* The controls/legends live in the card headers, the marks inside the cards: that state is lifted to this level to be shared */}
            <div className="lg:col-span-2">
              <ChartCard
                title={S.usage.chartRequests}
                extra={
                  <RequestsControls
                    dim={reqDim}
                    onDim={(d) => {
                      setReqDim(d);
                      setReqEntity("");
                    }}
                    entities={entityOptions}
                    entity={reqSelected === null ? "" : reqEntity}
                    onEntity={setReqEntity}
                  />
                }
              >
                <RequestsChart
                  series={data.series}
                  entities={entityOptions}
                  selected={reqSelected}
                  granularity={data.granularity}
                />
              </ChartCard>
            </div>
            <ChartCard
              title={S.usage.chartTokenTrend}
              extra={<TokenLegend active={tokenBucket} onHover={setTokenBucket} />}
            >
              <TokenBarChart
                series={data.series}
                granularity={data.granularity}
                legend={tokenBucket}
              />
            </ChartCard>
            <ChartCard title={S.usage.chartCostTrend}>
              <TrendChart series={data.series} granularity={data.granularity} currency={currency} />
            </ChartCard>
          </div>
        ) : (
          <Skeleton className="h-64" />
        )}

        {/* Errors (a single full-width panel: stats + a recent-errors table) */}
        {data && (
          <ChartCard title={S.usage.errors}>
            <ErrorsPanel errors={data.errors} projectId={projectId} filters={errorFilters} />
          </ChartCard>
        )}

        {hasUncostedRows && <p className="text-xs text-gray-400">{S.usage.uncostedNote}</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
