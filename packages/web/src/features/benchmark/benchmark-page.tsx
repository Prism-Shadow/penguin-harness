/**
 * Benchmark page (read-only display):
 * the left directory lists Benchmarks grouped by Agent (the scoreboard is only fetched once
 * expanded); the right side shows the selected Benchmark's title info, a chart (switches between
 * score / cost / duration metrics on the same time axis; **grouped into series by the model each
 * evaluation carries** — the model isn't part of benchmark_config, each evaluation carries its
 * own — one color per series plus a legend, with older untagged records shown as a gray series;
 * missing values are skipped points, breaking the line; reuses the usage center's ChartFrame
 * coordinate system) and an evaluation detail table (includes a model column; rows expand to
 * show the evaluation summary — title and body shown separately — and per-case scores, and case
 * rows further expand to show the raw results of each run, with a Session link straight to that
 * Session's trace observability).
 * With a ?agentId= deep link, only the target Agent is expanded by default.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type {
  BenchmarkCaseScore,
  BenchmarkEvaluation,
  BenchmarkSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { agentDisplayName, useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Chevron } from "../../components/ui/chevron";
import { Segmented } from "../../components/ui/segmented";
import { Truncated } from "../../components/ui/truncated";
import { EmptyState } from "../../components/ui/empty-state";
import { SkeletonList } from "../../components/ui/skeleton";
import { providerInfo } from "@prismshadow/penguin-core/model-catalog";
import { seriesColor } from "../../lib/category-colors";
import { makeGeom } from "../usage/chart-geom";
import { ChartFrame, useChartWidth } from "../usage/chart-svg";
import {
  lineSegments,
  metricMax,
  metricValues,
  modelSeries,
  seriesValues,
} from "./benchmark-metrics";
import type { BenchmarkMetric, EvaluationSeries } from "./benchmark-metrics";

interface Selection {
  agentId: string;
  benchmark: BenchmarkSummary;
}

/** Expandable tree node for a single Agent (benchmarks are only fetched once expanded; same shape as the AgentNode on the trace observability page). */
function AgentNode({
  projectId,
  agentId,
  name,
  defaultOpen,
  selection,
  onSelect,
}: {
  projectId: string;
  agentId: string;
  name: string;
  /** Whether initially expanded: all expanded when there's no deep link; only the target Agent expanded with a ?agentId= deep link. */
  defaultOpen: boolean;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [benchmarks, setBenchmarks] = useState<BenchmarkSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || benchmarks) return;
    api
      .listBenchmarks(projectId, agentId)
      .then((data) => setBenchmarks(data.benchmarks))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : S.common.unknownError));
  }, [open, benchmarks, projectId, agentId]);

  return (
    <li className="pt-2.5">
      <div className="flex items-center px-1 pb-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? S.nav.collapseGroup : S.nav.expandGroup}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-0.5 text-left transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50"
        >
          <AgentAvatar id={agentId} name={name} size={18} className="shrink-0 rounded" />
          <span className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {name}
          </span>
          <Chevron open={open} size={12} className="text-gray-400" />
          <span className="min-w-0 flex-1" />
        </button>
      </div>
      {open && (
        <div className="anim-fade">
          {error && <p className="px-2.5 py-1 text-xs text-red-500">{error}</p>}
          {!benchmarks && !error && (
            <p className="px-2.5 py-1 text-xs text-gray-400">{S.common.loading}</p>
          )}
          {benchmarks && benchmarks.length === 0 && (
            <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
              {S.benchmark.emptyAgent}
            </p>
          )}
          <ul className="space-y-0.5">
            {benchmarks?.map((b) => {
              const active = selection?.agentId === agentId && selection.benchmark.id === b.id;
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => onSelect({ agentId, benchmark: b })}
                    className={`flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left transition-colors duration-150 ${
                      active
                        ? "bg-gray-200/70 dark:bg-gray-800"
                        : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
                    }`}
                  >
                    <Truncated
                      text={b.title}
                      className={`min-w-0 flex-1 text-sm ${
                        active
                          ? "font-medium text-gray-900 dark:text-gray-100"
                          : "text-gray-700 dark:text-gray-300"
                      }`}
                    />
                    <span className="shrink-0 font-mono text-[11px] text-gray-400">
                      {b.caseCount}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

/** Display label for a metric (shared by the Segmented options and the chart title; S is a live binding, must be read during render). */
function metricLabel(metric: BenchmarkMetric): string {
  return metric === "score"
    ? S.benchmark.colScore
    : metric === "cost"
      ? S.common.cost
      : S.benchmark.colDuration;
}

/** Display format for a metric value (shared by y-axis ticks and the tooltip): score / cost / duration each have their own formatting rule. */
function formatMetric(metric: BenchmarkMetric, v: number): string {
  return metric === "score"
    ? formatScore(v)
    : metric === "cost"
      ? formatMoney(v)
      : humanizeDuration(v);
}

/**
 * Metric-over-time line chart (cloned from the usage center's TrendChart: area + line + data
 * points, sharing the ChartFrame coordinate system). **Grouped into series** by the model each
 * evaluation carries: one color per series (SERIES_COLORS is a fixed color sequence, color
 * follows the model; older records with no model tag get a gray series), all series share the
 * same time axis and y-axis range. Missing values within a series (indices outside this series,
 * or cost / durationMs not recorded) are **skipped points** — lineSegments splits the
 * value-bearing indices into segments, drawing area + line + data points within each segment and
 * breaking between segments (a single-point segment draws only a point). ChartFrame's x-axis
 * labels take slice(5) of dates: passing `yyyy-MM-dd HH:mm` displays as `MM-dd HH:mm`. A single
 * evaluation is still drawn; no evaluations falls back to an empty state.
 */
function MetricTrendChart({
  evaluations,
  series,
  metric,
}: {
  evaluations: BenchmarkEvaluation[];
  series: EvaluationSeries[];
  metric: BenchmarkMetric;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();

  const values = metricValues(evaluations, metric);
  const geom = makeGeom(evaluations.length, metricMax(values), width);
  const dates = evaluations.map((e) => formatDateTime(e.time));
  const baseY = geom.y(0);

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => formatMetric(metric, v)}
          dates={dates}
          hover={hover}
          onHover={setHover}
          bubble={(i) => {
            const e = evaluations[i]!;
            const v = values[i] ?? null;
            return (
              <>
                <p className="text-gray-400">{formatDateTime(e.time)}</p>
                <p className="font-mono">
                  {v === null ? "—" : formatMetric(metric, v)}
                  {e.version !== undefined && (
                    <span className="ml-1.5 text-gray-400">v{e.version}</span>
                  )}
                </p>
                {e.modelId && <p className="font-mono text-gray-400">{e.modelId}</p>}
              </>
            );
          }}
        >
          {series.map((s, si) => {
            const segments = lineSegments(seriesValues(evaluations, s, metric));
            return (
              <g
                key={s.key === "" ? "unlabeled" : s.key}
                className={s.modelId ? seriesColor(si).text : "text-gray-400 dark:text-gray-500"}
              >
                {segments.map((seg, k) => {
                  const line = seg
                    .map((p, j) => `${j === 0 ? "M" : "L"}${geom.x(p.index)},${geom.y(p.value)}`)
                    .join(" ");
                  const area = `${line} L${geom.x(seg[seg.length - 1]!.index)},${baseY} L${geom.x(seg[0]!.index)},${baseY} Z`;
                  return (
                    <g key={k}>
                      {/* Area fill: line closed to the baseline, low opacity reinforces the trend's sense of "volume" (no area for single-point segments) */}
                      {seg.length > 1 && (
                        <path
                          d={area}
                          className="fill-current"
                          stroke="none"
                          opacity={hover !== null ? 0.06 : 0.1}
                        />
                      )}
                      {seg.length > 1 && (
                        <path
                          d={line}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          opacity={hover !== null ? 0.35 : 1}
                        />
                      )}
                      {seg.map((p) => (
                        <circle
                          key={p.index}
                          cx={geom.x(p.index)}
                          cy={geom.y(p.value)}
                          r={hover === p.index ? 4 : 2.5}
                          className="fill-current"
                          opacity={hover !== null && hover !== p.index ? 0.25 : 1}
                        />
                      ))}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </ChartFrame>
      )}
    </div>
  );
}

/**
 * Chart section: title (follows metric) + metric switch (score / cost / duration, segmented
 * control) + model legend (only shown with >=2 series; a single series' identity is carried by
 * the detail table's model column and the hover tooltip instead) + the line chart. When the same
 * modelId coexists across providers, the legend appends the provider's display name to
 * disambiguate. Mounted under a keyed container per Benchmark: switching Benchmarks resets back
 * to "score".
 */
function TrendSection({ evaluations }: { evaluations: BenchmarkEvaluation[] }) {
  const [metric, setMetric] = useState<BenchmarkMetric>("score");
  const series = modelSeries(evaluations);
  const ids = series.map((s) => s.modelId).filter((v): v is string => v !== undefined);
  const dupIds = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  const labelOf = (s: EvaluationSeries): string => {
    if (!s.modelId) return S.benchmark.legendUnlabeled;
    if (!dupIds.has(s.modelId)) return s.modelId;
    const provider = s.provider ? (providerInfo(s.provider)?.label ?? s.provider) : "";
    return provider ? `${s.modelId} · ${provider}` : s.modelId;
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500">
          {S.benchmark.trendTitle(metricLabel(metric))}
        </p>
        <div className="w-44 shrink-0">
          <Segmented
            options={[
              { value: "score", label: metricLabel("score") },
              { value: "cost", label: metricLabel("cost") },
              { value: "duration", label: metricLabel("duration") },
            ]}
            value={metric}
            onChange={setMetric}
          />
        </div>
      </div>
      {series.length >= 2 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((s, i) => (
            <span
              key={s.key === "" ? "unlabeled" : s.key}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"
              title={s.provider ? (providerInfo(s.provider)?.label ?? s.provider) : undefined}
            >
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-sm ${
                  s.modelId ? seriesColor(i).swatch : "bg-gray-400 dark:bg-gray-500"
                }`}
              />
              <span className="font-mono">{labelOf(s)}</span>
            </span>
          ))}
        </div>
      )}
      <MetricTrendChart evaluations={evaluations} series={series} metric={metric} />
    </div>
  );
}

const CELL = "px-3 py-2";

/** One evaluation record: main row (time/version/total score/cost/duration) + a sub-table of per-case scores that expands on click. */
function EvaluationRow({
  agentId,
  evaluation,
}: {
  agentId: string;
  evaluation: BenchmarkEvaluation;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
      >
        <td className={CELL}>
          <span className="flex items-center gap-1.5 text-xs">
            <Chevron open={open} size={12} className="text-gray-400" />
            {formatDateTime(evaluation.time)}
          </span>
        </td>
        <td className={`${CELL} font-mono text-xs text-gray-500 dark:text-gray-400`}>
          {evaluation.version !== undefined ? `v${evaluation.version}` : "—"}
        </td>
        <td
          className={`${CELL} max-w-40 truncate font-mono text-xs text-gray-500 dark:text-gray-400`}
          title={evaluation.provider}
        >
          {evaluation.modelId ?? "—"}
        </td>
        <td className={`${CELL} font-mono text-xs font-semibold tabular-nums`}>
          {formatScore(evaluation.score)}
        </td>
        <td className={`${CELL} font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400`}>
          {formatMoney(evaluation.cost)}
        </td>
        <td className={`${CELL} font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400`}>
          {evaluation.durationMs !== undefined ? humanizeDuration(evaluation.durationMs) : "—"}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-gray-100 last:border-b-0 dark:border-gray-800/60">
          <td colSpan={6} className="bg-gray-50/80 px-3 py-2 dark:bg-gray-950/40">
            {/* Evaluation summary (title + body shown separately; the generating side always
                writes both, but the display side tolerates missing values — with an old-style
                single-paragraph summary only, it's still shown as usual, prefixed with the
                "Evaluation Summary" label). */}
            {(evaluation.summaryTitle || evaluation.summary) && (
              <div className="mb-2">
                {evaluation.summaryTitle ? (
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                    {evaluation.summaryTitle}
                  </p>
                ) : (
                  <p className="text-xs font-semibold text-gray-500">{S.benchmark.summaryLabel}</p>
                )}
                {evaluation.summary && (
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-gray-600 dark:text-gray-300">
                    {evaluation.summary}
                  </p>
                )}
              </div>
            )}
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-gray-500">
                  <th className="px-2 py-1 font-medium">{S.benchmark.colCase}</th>
                  <th className="px-2 py-1 font-medium">{S.benchmark.colScore}</th>
                  <th className="px-2 py-1 font-medium">{S.common.cost}</th>
                  <th className="px-2 py-1 font-medium">{S.benchmark.colDuration}</th>
                  <th className="px-2 py-1 font-medium">{S.benchmark.colSession}</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.cases.map((c) => (
                  <CaseRow key={c.case} agentId={agentId} caseScore={c} />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

/** Session deep link: jumps straight to that Session's trace observability (?sessionId= auto-selects it, instead of stopping at the Agent group). */
function SessionLink({ agentId, sessionId }: { agentId: string; sessionId?: string }) {
  if (!sessionId) return <span className="text-gray-400">—</span>;
  return (
    <Link
      to={`/traces?agentId=${encodeURIComponent(agentId)}&sessionId=${encodeURIComponent(sessionId)}`}
      className="font-mono text-gray-600 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 dark:text-gray-300 dark:decoration-gray-600 dark:hover:text-gray-100"
      title={sessionId}
    >
      {sessionId}
    </Link>
  );
}

/**
 * Score row for one case: the case-level metrics = the average of its runs (already computed by
 * the server, trust its values). With runs[] present, the row can expand to show the raw results
 * of each run (#index + score / cost / duration / Session link); with the old format lacking
 * runs, it's not expandable and the case-level single Session link is used as before.
 */
function CaseRow({ agentId, caseScore: c }: { agentId: string; caseScore: BenchmarkCaseScore }) {
  const [open, setOpen] = useState(false);
  const runs = c.runs ?? [];
  const expandable = runs.length > 0;
  return (
    <>
      <tr
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        className={`text-xs ${expandable ? "cursor-pointer transition-colors duration-150 hover:bg-gray-100/70 dark:hover:bg-gray-800/40" : ""}`}
      >
        <td className="px-2 py-1 font-mono">
          <span className="flex items-center gap-1.5">
            {expandable && <Chevron open={open} size={12} className="text-gray-400" />}
            {c.case}
          </span>
        </td>
        <td className="px-2 py-1 font-mono tabular-nums">{formatScore(c.score)}</td>
        <td className="px-2 py-1 font-mono tabular-nums text-gray-500 dark:text-gray-400">
          {formatMoney(c.cost)}
        </td>
        <td className="px-2 py-1 font-mono tabular-nums text-gray-500 dark:text-gray-400">
          {c.durationMs !== undefined ? humanizeDuration(c.durationMs) : "—"}
        </td>
        <td className="px-2 py-1">
          <SessionLink agentId={agentId} {...(c.sessionId ? { sessionId: c.sessionId } : {})} />
        </td>
      </tr>
      {open &&
        runs.map((run, i) => (
          <tr key={i} className="text-xs text-gray-500 dark:text-gray-400">
            {/* Indented run index row: #1, #2, ... (case-level metrics are their average) */}
            <td className="py-1 pl-7 pr-2 font-mono">
              {S.benchmark.colRun} #{i + 1}
            </td>
            <td className="px-2 py-1 font-mono tabular-nums">{formatScore(run.score)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{formatMoney(run.cost)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">
              {run.durationMs !== undefined ? humanizeDuration(run.durationMs) : "—"}
            </td>
            <td className="px-2 py-1">
              <SessionLink
                agentId={agentId}
                {...(run.sessionId ? { sessionId: run.sessionId } : {})}
              />
            </td>
          </tr>
        ))}
    </>
  );
}

export function BenchmarkPage() {
  useDocumentTitle(S.benchmark.title);
  const { currentProject, agents, agentsLoading } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // ?agentId= deep link (entered from the "Benchmark" tab on the Agent settings page): only the target Agent is expanded by default.
  const [searchParams] = useSearchParams();
  const focusAgentId = searchParams.get("agentId");
  const [selection, setSelection] = useState<Selection | null>(null);

  // Clear the selection when the Project changes.
  useEffect(() => {
    setSelection(null);
  }, [projectId]);

  if (!projectId) return null;

  const bm = selection?.benchmark ?? null;
  // Chart uses ascending time order (the scoreboard is already ordered, this sort is defensive); the detail table shows newest first.
  const evaluations = bm ? [...bm.evaluations].sort((a, b) => a.time.localeCompare(b.time)) : [];

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Directory tree: Agent -> Benchmark (left column on >=md; collapsible top area on <md) */}
      <aside className="max-h-52 shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 px-1 py-2 md:max-h-none md:w-72 md:border-b-0 md:border-r dark:border-gray-800 dark:bg-gray-900">
        <p className="px-3 pb-1 text-xs font-bold uppercase tracking-wide text-gray-500">
          {S.benchmark.title}
        </p>
        {agentsLoading ? (
          <SkeletonList rows={4} />
        ) : (
          <ul>
            {agents.map((a) => (
              <AgentNode
                key={a.agentId}
                projectId={projectId}
                agentId={a.agentId}
                name={agentDisplayName(a)}
                defaultOpen={focusAgentId === null || focusAgentId === a.agentId}
                selection={selection}
                onSelect={setSelection}
              />
            ))}
          </ul>
        )}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-3 md:p-4">
        {selection && bm ? (
          // Changing the key on Benchmark switch resets expand state (a detail row's open doesn't linger across Benchmarks).
          <div key={`${selection.agentId}/${bm.id}`} className="mx-auto max-w-4xl space-y-4">
            {/* Title row: title + case count (the model isn't part of config — each evaluation
                carries its own, see the chart legend and the detail table's model column) +
                description */}
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h1 className="min-w-0 truncate text-lg font-semibold">{bm.title}</h1>
                <span className="text-xs text-gray-500">{S.benchmark.caseCount(bm.caseCount)}</span>
              </div>
              {bm.description && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{bm.description}</p>
              )}
            </div>

            {evaluations.length === 0 ? (
              <EmptyState title={S.benchmark.noEvaluations} />
            ) : (
              <>
                <TrendSection evaluations={evaluations} />

                <div>
                  <p className="mb-1 text-xs font-semibold text-gray-500">
                    {S.benchmark.evaluations}
                  </p>
                  <div className="overflow-x-auto overflow-y-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                          <th className="px-3 py-2.5">{S.common.time}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colVersion}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colModel}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colScore}</th>
                          <th className="px-3 py-2.5">{S.common.cost}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colDuration}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...evaluations].reverse().map((ev, i) => (
                          <EvaluationRow key={i} agentId={selection.agentId} evaluation={ev} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <EmptyState title={S.benchmark.selectBenchmark} />
        )}
      </section>
    </div>
  );
}
