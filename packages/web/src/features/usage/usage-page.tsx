/**
 * Cost and usage center:
 * top filters for Agent / Model + a date range (controls have no external
 * title, the explanation is written into the dropdown options themselves);
 * three summary cards (today / last 7 days / cumulative, each stat on its own row);
 * four business charts arranged two-by-two, each taking half the width — a
 * row of compositional charts (each Agent's call count pie chart, each
 * Model's success rate progress bar), and a row of time series (daily Token
 * three-segment stacked bar, daily cost line + area): Token bar width is
 * fixed at 25px, and it scrolls horizontally within the card when 30 days
 * doesn't fit the half-width; below that is a full-width "errors" panel
 * (stats + a recent-errors table).
 * Currency follows the user's settings; a row with unconfigured pricing shows its cost as "—".
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { ModelRefDto, UsageBucket, UsageResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatMoney, humanizeTokens } from "../../lib/format";
import { catalogEntryFor } from "@prismshadow/penguin-core/model-catalog";
import { useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TrendChart } from "./trend-chart";
import type { TokenBucketKey } from "./chart-geom";
import { AgentPieChart, SuccessBarChart, TokenBarChart, TokenLegend } from "./usage-charts";
import { ErrorsPanel } from "./errors-panel";

function isoDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return isoDate(d);
  });
  const [to, setTo] = useState(() => isoDate(new Date()));
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The bucket currently hovered in the legend: the legend lives in the card
  // header (ChartCard's extra) while the bars live inside the card, so this state is lifted to this level.
  const [tokenBucket, setTokenBucket] = useState<TokenBucketKey | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    try {
      const res = await api.getUsage(projectId, {
        from,
        to,
        // The detail table has been removed, superseded by the charts above; groupBy is still a required query parameter, fixed to group by date.
        groupBy: "date",
        ...(agentFilter ? { agentId: agentFilter } : {}),
        ...(modelFilter ? { provider: modelFilter.provider, modelId: modelFilter.modelId } : {}),
      });
      setData(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : S.common.unknownError);
    }
  }, [projectId, from, to, agentFilter, modelFilter?.provider, modelFilter?.modelId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

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
            {/* Date range: a dash between the two inputs stands in for a "from/to" label */}
            <div className="flex items-center gap-1.5">
              <Input
                size="sm"
                type="date"
                aria-label={S.usage.from}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span className="shrink-0 text-gray-400" aria-hidden>
                –
              </span>
              <Input
                size="sm"
                type="date"
                aria-label={S.usage.to}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
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

        {/* Four business charts two-by-two, each taking half width: a row of
            compositional charts (pie chart / success rate), a row of time
            series (daily Token / daily cost). Token bar width fixed at 25px, scrolls horizontally within the card when 30 days doesn't fit the half-width */}
        {data ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ChartCard title={S.usage.chartAgentCalls}>
              <AgentPieChart data={data.byAgent} />
            </ChartCard>
            <ChartCard title={S.usage.chartSuccessRate}>
              <SuccessBarChart data={data.success} />
            </ChartCard>
            {/* The legend lives in the card header, the bars live inside the card: the hover-linked bucket state is lifted to this level to be shared */}
            <ChartCard
              title={S.usage.chartTokenTrend}
              extra={<TokenLegend active={tokenBucket} onHover={setTokenBucket} />}
            >
              <TokenBarChart trend={data.trend} legend={tokenBucket} />
            </ChartCard>
            <ChartCard title={S.usage.chartCostTrend}>
              <TrendChart points={data.trend} currency={currency} />
            </ChartCard>
          </div>
        ) : (
          <Skeleton className="h-64" />
        )}

        {/* Errors (a single full-width panel: stats + a recent-errors table) */}
        {data && (
          <ChartCard title={S.usage.errors}>
            <ErrorsPanel errors={data.errors} />
          </ChartCard>
        )}

        {hasUncostedRows && <p className="text-xs text-gray-400">{S.usage.uncostedNote}</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
