/**
 * Benchmark page (read-only display):
 * the left directory lists Benchmarks grouped by Agent (the scoreboard is only fetched once
 * expanded); the right side shows the selected Benchmark's title info, a Score-only chart grouped
 * into series by each Evaluation's model ID and thinking level, and an evaluation detail table
 * with separate model ID and thinking-level columns. Rows expand to show the evaluation summary
 * and per-case scores, and Case rows further expand to show the raw results of each Run with a
 * Session link.
 * With a ?agentId= deep link, only the target Agent is expanded by default.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type {
  BenchmarkCaseScore,
  BenchmarkCaseSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useDocumentTitle } from "../../lib/use-document-title";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { agentDisplayName, useProject } from "../../state/project";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Chevron } from "../../components/ui/chevron";
import { Truncated } from "../../components/ui/truncated";
import { EmptyState } from "../../components/ui/empty-state";
import { Modal } from "../../components/ui/modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { NEUTRAL_SERIES, seriesColor } from "../../lib/category-colors";
import { lineSegments, makeRangeGeom, segmentPath } from "../usage/chart-geom";
import { ChartFrame, useChartWidth } from "../usage/chart-svg";
import { modelSeries, scoreScale, scoreValues, seriesValues } from "./benchmark-metrics";
import type { EvaluationSeries } from "./benchmark-metrics";
import { BenchmarkCaseBrowser } from "./benchmark-case-browser";

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
      .catch((e: unknown) => setError(apiErrorText(e)));
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

/**
 * Score-over-time line chart. Scores remain valid on 0..100, while the visible y-axis is padded
 * around the observed range and clamped to those limits. Evaluations remain grouped by model ID
 * and thinking level so a runtime change stays visible without adding other metric modes.
 */
function ScoreTrendChart({
  evaluations,
  series,
}: {
  evaluations: BenchmarkEvaluation[];
  series: EvaluationSeries[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();

  const values = scoreValues(evaluations);
  const scale = scoreScale(values);
  const geom = makeRangeGeom(evaluations.length, scale.min, scale.max, width);
  const dates = evaluations.map((e) => formatDateTime(e.time));

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={formatScore}
          dates={dates}
          hover={hover}
          onHover={setHover}
          yTicks={scale.ticks}
          bubble={(i) => {
            const e = evaluations[i]!;
            const v = values[i] ?? null;
            return (
              <>
                <p className="text-gray-400">{formatDateTime(e.time)}</p>
                <p className="font-mono">
                  {v === null ? "—" : formatScore(v)}
                  {e.version !== undefined && (
                    <span className="ml-1.5 text-gray-400">v{e.version}</span>
                  )}
                </p>
                <p className="font-mono text-gray-400">
                  {e.modelId} · {e.thinkingLevel}
                </p>
              </>
            );
          }}
        >
          {series.map((s, si) => {
            const segments = lineSegments(seriesValues(evaluations, s));
            return (
              <g
                key={s.key === "" ? "unlabeled" : s.key}
                className={(s.modelId ? seriesColor(si) : NEUTRAL_SERIES).text}
              >
                {segments.map((seg, k) => {
                  return (
                    <g key={k}>
                      {seg.length > 1 && (
                        <path
                          d={segmentPath(geom, seg)}
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
 * Score chart + runtime legend. Provider is deliberately not part of chart identity.
 */
function TrendSection({ evaluations }: { evaluations: BenchmarkEvaluation[] }) {
  const series = modelSeries(evaluations);
  const labelOf = (s: EvaluationSeries): string => {
    if (!s.modelId) return S.benchmark.legendUnlabeled;
    return s.thinkingLevel ? `${s.modelId} · ${s.thinkingLevel}` : s.modelId;
  };
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-500">
        {S.benchmark.trendTitle(S.benchmark.colScore)}
      </p>
      {series.length >= 2 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((s, i) => (
            <span
              key={s.key === "" ? "unlabeled" : s.key}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"
            >
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-sm ${(s.modelId ? seriesColor(i) : NEUTRAL_SERIES).swatch}`}
              />
              <span className="font-mono">{labelOf(s)}</span>
            </span>
          ))}
        </div>
      )}
      <ScoreTrendChart evaluations={evaluations} series={series} />
    </div>
  );
}

const CELL = "px-3 py-2";

/** One evaluation record: main row + a sub-table of per-Case scores that expands on click. */
function EvaluationRow({
  evaluation,
  caseTitles,
  onOpenCase,
  currency,
}: {
  evaluation: BenchmarkEvaluation;
  caseTitles: ReadonlyMap<string, string>;
  onOpenCase: (caseId: string) => void;
  currency: Currency;
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
          {evaluation.modelId}
        </td>
        <td className={`${CELL} font-mono text-xs text-gray-500 dark:text-gray-400`}>
          {evaluation.thinkingLevel}
        </td>
        <td className={`${CELL} font-mono text-xs font-semibold tabular-nums`}>
          {formatScore(evaluation.score)}
        </td>
        <td className={`${CELL} font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400`}>
          {formatMoney(evaluation.cost, currency)}
        </td>
        <td className={`${CELL} font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400`}>
          {evaluation.durationMs !== undefined ? humanizeDuration(evaluation.durationMs) : "—"}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-gray-100 last:border-b-0 dark:border-gray-800/60">
          <td colSpan={7} className="bg-gray-50/80 px-3 py-2 dark:bg-gray-950/40">
            {/* Evaluation summary title and body are displayed separately when present. */}
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
                  <CaseRow
                    key={c.case}
                    caseScore={c}
                    title={caseTitles.get(c.case)}
                    onOpenCase={caseTitles.has(c.case) ? onOpenCase : undefined}
                    currency={currency}
                  />
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Session id, for correlating a Run with what the side panel shows. It used to deep-link into the
 * Traces page; reading a Trace is now the side panel's job alone, so this is identification only.
 */
function SessionCell({ sessionId }: { sessionId?: string }) {
  if (!sessionId) return <span className="text-gray-400">—</span>;
  return (
    <span className="font-mono text-gray-600 dark:text-gray-300" title={sessionId}>
      {sessionId}
    </span>
  );
}

/**
 * Score row for one Case: stored Case averages are authoritative. Expanding shows raw Run
 * results; the UI never recomputes averages.
 */
function CaseRow({
  caseScore: c,
  title,
  onOpenCase,
  currency,
}: {
  caseScore: BenchmarkCaseScore;
  title?: string;
  onOpenCase?: (caseId: string) => void;
  currency: Currency;
}) {
  const [open, setOpen] = useState(false);
  const runs = c.runs;
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer text-xs transition-colors duration-150 hover:bg-gray-100/70 dark:hover:bg-gray-800/40"
      >
        <td className="px-2 py-1">
          <span className="flex items-start gap-1.5">
            <Chevron open={open} size={12} className="text-gray-400" />
            <span className="min-w-0">
              {onOpenCase ? (
                <button
                  type="button"
                  className="block text-left font-medium text-gray-800 hover:underline dark:text-gray-200"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenCase(c.case);
                  }}
                >
                  {title ?? c.case}
                </button>
              ) : (
                <span className="block font-medium text-gray-800 dark:text-gray-200">
                  {title ?? c.case}
                </span>
              )}
              {title && title !== c.case && (
                <span className="block font-mono text-[11px] text-gray-400">{c.case}</span>
              )}
            </span>
          </span>
        </td>
        <td className="px-2 py-1 font-mono tabular-nums">{formatScore(c.score)}</td>
        <td className="px-2 py-1 font-mono tabular-nums text-gray-500 dark:text-gray-400">
          {formatMoney(c.cost, currency)}
        </td>
        <td className="px-2 py-1 font-mono tabular-nums text-gray-500 dark:text-gray-400">
          {c.durationMs !== undefined ? humanizeDuration(c.durationMs) : "—"}
        </td>
        <td className="px-2 py-1">
          <span className="text-gray-400">—</span>
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
            <td className="px-2 py-1 font-mono tabular-nums">{formatMoney(run.cost, currency)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">
              {run.durationMs !== undefined ? humanizeDuration(run.durationMs) : "—"}
            </td>
            <td className="px-2 py-1">
              <SessionCell {...(run.sessionId ? { sessionId: run.sessionId } : {})} />
            </td>
          </tr>
        ))}
    </>
  );
}

function CasesSection({
  cases,
  error,
  onOpenCase,
}: {
  cases: BenchmarkCaseSummary[] | null;
  error: string | null;
  onOpenCase: (caseId: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-500">{S.benchmark.cases}</p>
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {error && <p className="px-3 py-2 text-xs text-red-500">{error}</p>}
        {!cases && !error && <p className="px-3 py-2 text-xs text-gray-400">{S.common.loading}</p>}
        {cases?.map((item) => {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenCase(item.id)}
              className="flex w-full items-center gap-3 border-b border-gray-100 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-gray-50 dark:border-gray-800/70 dark:hover:bg-gray-800/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">
                  {item.title}
                </span>
                <span className="block truncate font-mono text-[11px] text-gray-400">
                  {item.id}
                </span>
              </span>
              {/* Styled as the quiet gray action the Workspace download link is, not as a
                  link: the row itself is the button, so an accent-colored label here read as
                  a second, separately clickable target. Hover feedback comes from the row. */}
              <span className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                {S.benchmark.viewCase}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BenchmarkPage() {
  useDocumentTitle(S.benchmark.title);
  const { currentProject, agents, agentsLoading } = useProject();
  const { currency } = useTheme();
  const projectId = currentProject?.projectId ?? null;
  // ?agentId= deep link (entered from the "Benchmark" tab on the Agent settings page): only the target Agent is expanded by default.
  const [searchParams] = useSearchParams();
  const focusAgentId = searchParams.get("agentId");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [caseStatements, setCaseStatements] = useState<BenchmarkCaseSummary[] | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  // Clear the selection when the Project changes.
  useEffect(() => {
    setSelection(null);
  }, [projectId]);

  useEffect(() => {
    setCaseStatements(null);
    setCaseError(null);
    setOpenCaseId(null);
    if (!projectId || !selection) return;
    let cancelled = false;
    api
      .listBenchmarkCases(projectId, selection.agentId, selection.benchmark.id)
      .then((data) => {
        if (!cancelled) setCaseStatements(data.cases);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCaseError(apiErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, selection]);

  if (!projectId) return null;

  const bm = selection?.benchmark ?? null;
  // The Scoreboard append order is the evaluation sequence. Preserve it even when a malformed
  // timestamp would otherwise reorder Agent versions; the detail table shows that sequence newest first.
  const evaluations = bm ? [...bm.evaluations] : [];
  const caseTitles = new Map(caseStatements?.map((item) => [item.id, item.title]) ?? []);
  const openCase = caseStatements?.find((item) => item.id === openCaseId) ?? null;

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
            {/* Runtime belongs to each Evaluation and is shown in the detail table. */}
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h1 className="min-w-0 truncate text-lg font-semibold">{bm.title}</h1>
                <span className="text-xs text-gray-500">{S.benchmark.caseCount(bm.caseCount)}</span>
              </div>
              {bm.description && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{bm.description}</p>
              )}
            </div>

            <CasesSection cases={caseStatements} error={caseError} onOpenCase={setOpenCaseId} />

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
                    <table className="w-full min-w-[720px] text-left text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                          <th className="px-3 py-2.5">{S.common.time}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colVersion}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colModel}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colThinkingLevel}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colScore}</th>
                          <th className="px-3 py-2.5">{S.common.cost}</th>
                          <th className="px-3 py-2.5">{S.benchmark.colDuration}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...evaluations].reverse().map((ev, i) => (
                          <EvaluationRow
                            key={i}
                            evaluation={ev}
                            caseTitles={caseTitles}
                            onOpenCase={setOpenCaseId}
                            currency={currency}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {openCase && (
              <Modal
                open
                title={openCase.title}
                widthClass="sm:max-w-6xl"
                onClose={() => setOpenCaseId(null)}
              >
                <BenchmarkCaseBrowser
                  projectId={projectId}
                  agentId={selection.agentId}
                  benchmarkId={bm.id}
                  caseSummary={openCase}
                />
              </Modal>
            )}
          </div>
        ) : (
          <EmptyState title={S.benchmark.selectBenchmark} />
        )}
      </section>
    </div>
  );
}
