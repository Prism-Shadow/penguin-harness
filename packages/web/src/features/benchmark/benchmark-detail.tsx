/**
 * One Benchmark's detail: title and description, the case list, a Score-only chart grouped
 * into series by each Evaluation's model ID and thinking level, and the evaluation table with
 * separate model ID and thinking-level columns. Rows expand to the evaluation summary and
 * per-case scores, and Case rows further expand to the raw results of each Run with its
 * Session id. A case opens the case browser in a dialog. The page decides where this sits
 * (a right pane or the whole width) and keys it by Benchmark, so expand state never lingers
 * across Benchmarks.
 */
import { useEffect, useState } from "react";
import type {
  BenchmarkCaseScore,
  BenchmarkCaseSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { Chevron } from "../../components/ui/chevron";
import { EmptyState } from "../../components/ui/empty-state";
import { Modal } from "../../components/ui/modal";
import { NEUTRAL_SERIES, seriesColor } from "../../lib/category-colors";
import { lineSegments, makeRangeGeom, segmentPath } from "../usage/chart-geom";
import { ChartFrame, useChartWidth } from "../usage/chart-svg";
import { modelSeries, scoreScale, scoreValues, seriesValues } from "./benchmark-metrics";
import type { EvaluationSeries } from "./benchmark-metrics";
import { BenchmarkCaseBrowser } from "./benchmark-case-browser";

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

/** Session id, for correlating a Run with what the side panel shows: identification only, reading a Trace is the side panel's job. */
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
        {error && <p className={`px-3 py-2 text-xs ${toneInk.danger}`}>{error}</p>}
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

export function BenchmarkDetail({
  projectId,
  agentId,
  benchmark: bm,
}: {
  projectId: string;
  agentId: string;
  benchmark: BenchmarkSummary;
}) {
  const { currency } = useTheme();
  const [caseStatements, setCaseStatements] = useState<BenchmarkCaseSummary[] | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);

  useEffect(() => {
    setCaseStatements(null);
    setCaseError(null);
    setOpenCaseId(null);
    let cancelled = false;
    api
      .listBenchmarkCases(projectId, agentId, bm.id)
      .then((data) => {
        if (!cancelled) setCaseStatements(data.cases);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCaseError(apiErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, bm.id]);

  // The Scoreboard append order is the evaluation sequence. Preserve it even when a malformed
  // timestamp would otherwise reorder Agent versions; the detail table shows that sequence newest first.
  const evaluations = [...bm.evaluations];
  const caseTitles = new Map(caseStatements?.map((item) => [item.id, item.title]) ?? []);
  const openCase = caseStatements?.find((item) => item.id === openCaseId) ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Runtime belongs to each Evaluation and is shown in the detail table. */}
      <div>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h1 className="min-w-0 truncate text-lg font-semibold">{bm.title}</h1>
          <span className="text-xs text-gray-500">
            {S.benchmark.caseCount(bm.caseCount)} · {S.benchmark.runsPerCase(bm.runs ?? 1)}
          </span>
        </div>
        {bm.description && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{bm.description}</p>
        )}
      </div>

      <CasesSection cases={caseStatements} error={caseError} onOpenCase={setOpenCaseId} />

      {evaluations.length === 0 ? (
        <EmptyState title={S.benchmark.noEvaluations} description={S.benchmark.noEvaluationsHint} />
      ) : (
        <>
          <TrendSection evaluations={evaluations} />

          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">{S.benchmark.evaluations}</p>
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
            agentId={agentId}
            benchmarkId={bm.id}
            caseSummary={openCase}
          />
        </Modal>
      )}
    </div>
  );
}
