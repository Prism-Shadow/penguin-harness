/**
 * One Benchmark's detail: case counts and description, the case list, a Score-only chart grouped
 * into series by each Evaluation's label — the tested Agent, the model and the thinking level —
 * and the evaluation table, which spells that label out across its Agent, version, model and
 * thinking-level columns. A row there opens that evaluation in a dialog, a case opens the case
 * browser in another, and either dialog can hand what it shows to an agent as a question. This
 * is the body of the Benchmark's own page (the title lives in that page's header), which mounts
 * it once its Benchmark has been read, so nothing stays open from the Benchmark before it.
 */
import { useEffect, useState } from "react";
import type {
  BenchmarkCaseSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { NEUTRAL_SERIES, seriesColor } from "../../lib/category-colors";
import { lineSegments, makeRangeGeom, segmentPath } from "../usage/chart-geom";
import { ChartFrame, useChartWidth } from "../usage/chart-svg";
import { AskAiModal } from "./ask-ai-modal";
import { BenchmarkCaseBrowser } from "./benchmark-case-browser";
import {
  evaluationLabel,
  labelSeries,
  scoreScale,
  scoreValues,
  seriesValues,
} from "./benchmark-metrics";
import type { EvaluationSeries } from "./benchmark-metrics";
import { askCaseExamples, askCaseTail } from "./benchmark-prompts";
import type { AskCaseParams } from "./benchmark-prompts";
import { EvaluationDetailModal } from "./evaluation-detail-modal";

/**
 * Score-over-time line chart: one x slot per evaluation in scoreboard order, labeled with its
 * timestamp. Scores remain valid on 0..100, while the visible y-axis is padded around the
 * observed range and clamped to those limits. Evaluations are grouped by label, so a change of
 * tested Agent or of runtime starts its own series instead of bending one, while a new Agent
 * State version of the same agent continues the line and names its version in the bubble.
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
            // Time, then the score with the Agent State version that earned it, then the series
            // label, spelled by the same helper the legend reads. A version is a point on a
            // series rather than a series of its own, so this bubble is where it is read.
            const label = evaluationLabel(e);
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
                  {label.unlabeled ? S.benchmark.unlabeled : label.text}
                </p>
              </>
            );
          }}
        >
          {series.map((s, si) => {
            const segments = lineSegments(seriesValues(evaluations, s));
            return (
              <g
                key={s.unlabeled ? "unlabeled" : s.key}
                className={(s.unlabeled ? NEUTRAL_SERIES : seriesColor(si)).text}
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
 * Score chart + label legend. The legend prints the three parts a series is keyed by: the
 * tested Agent, the model and the thinking level. The version a point tested is not one of
 * them — it stands in that point's bubble and in the evaluation table's own column.
 */
function TrendSection({ evaluations }: { evaluations: BenchmarkEvaluation[] }) {
  const series = labelSeries(evaluations);
  const labelOf = (s: EvaluationSeries): string => (s.unlabeled ? S.benchmark.unlabeled : s.text);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-500">
        {S.benchmark.trendTitle(S.benchmark.colScore)}
      </p>
      {series.length >= 2 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {series.map((s, i) => (
            <span
              key={s.unlabeled ? "unlabeled" : s.key}
              className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400"
            >
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-sm ${(s.unlabeled ? NEUTRAL_SERIES : seriesColor(i)).swatch}`}
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

/** One evaluation record: a clickable row; the detail it used to unfold is a dialog of its own. */
function EvaluationRow({
  evaluation,
  onOpen,
  currency,
}: {
  evaluation: BenchmarkEvaluation;
  onOpen: () => void;
  currency: Currency;
}) {
  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-gray-100 transition-colors duration-150 last:border-b-0 hover:bg-gray-50 dark:border-gray-800/60 dark:hover:bg-gray-800/40"
    >
      <td className={CELL}>
        {/* The row is what a mouse clicks, and this is the same target for a keyboard: a table
            row cannot be a button, so the cell that names the record carries the real one. */}
        <button
          type="button"
          className="text-xs hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {formatDateTime(evaluation.time)}
        </button>
      </td>
      <td className={`${CELL} text-xs text-gray-500 dark:text-gray-400`}>
        {evaluation.agentId ? (
          <span className="flex items-center gap-1.5">
            <AgentAvatar
              id={evaluation.agentId}
              size={ICON_SIZE.rowLead}
              className="shrink-0 rounded"
            />
            <span className="min-w-0 truncate font-mono">{evaluation.agentId}</span>
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
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
  );
}

/**
 * What the case question carries beyond the ids: the two material paths follow from the ids
 * themselves, so all this adds is how the newest evaluation scored this case and which Session
 * each of its runs ran in. Null when no evaluation has scored it — a Benchmark can be read
 * before it has ever been run.
 */
function caseAskParams(
  benchmarkId: string,
  caseId: string,
  evaluations: readonly BenchmarkEvaluation[],
): AskCaseParams {
  const newest = evaluations[evaluations.length - 1];
  const scored = newest?.cases.find((c) => c.case === caseId);
  return {
    benchmarkId,
    caseId,
    latest:
      newest !== undefined && scored !== undefined
        ? {
            time: formatDateTime(newest.time),
            score: formatScore(scored.score),
            runs: scored.runs.map((run) => ({
              score: formatScore(run.score),
              sessionId: run.sessionId,
            })),
          }
        : null,
  };
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
  benchmark: bm,
}: {
  projectId: string;
  benchmark: BenchmarkSummary;
}) {
  const { currency } = useTheme();
  const [caseStatements, setCaseStatements] = useState<BenchmarkCaseSummary[] | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  /** Which evaluation's dialog is open, as a position in scoreboard order. */
  const [openEvaluationIndex, setOpenEvaluationIndex] = useState<number | null>(null);
  /** The case whose Ask AI dialog is open; kept as an id so it cannot outlive its case dialog. */
  const [askingCaseId, setAskingCaseId] = useState<string | null>(null);

  useEffect(() => {
    setCaseStatements(null);
    setCaseError(null);
    setOpenCaseId(null);
    setOpenEvaluationIndex(null);
    setAskingCaseId(null);
    let cancelled = false;
    api
      .listBenchmarkCases(projectId, bm.id)
      .then((data) => {
        if (!cancelled) setCaseStatements(data.cases);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCaseError(apiErrorText(error));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, bm.id]);

  // The Scoreboard append order is the evaluation sequence. Preserve it even when a malformed
  // timestamp would otherwise reorder Agent versions; the detail table shows that sequence newest first.
  const evaluations = [...bm.evaluations];
  const caseTitles = new Map(caseStatements?.map((item) => [item.id, item.title]) ?? []);
  const openCase = caseStatements?.find((item) => item.id === openCaseId) ?? null;
  const openEvaluation =
    openEvaluationIndex === null ? null : (evaluations[openEvaluationIndex] ?? null);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* The tested Agent and the runtime belong to each Evaluation and are shown in the detail
          table, not here: this Benchmark's cases are the same set whoever is being scored. */}
      <div>
        <p className="text-xs text-gray-500">
          {S.benchmark.caseCount(bm.caseCount)} · {S.benchmark.runsPerCase(bm.runs ?? 1)}
        </p>
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
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                    <th className="px-3 py-2.5">{S.common.time}</th>
                    <th className="px-3 py-2.5">{S.benchmark.agentColumn}</th>
                    <th className="px-3 py-2.5">{S.benchmark.colVersion}</th>
                    <th className="px-3 py-2.5">{S.benchmark.colModel}</th>
                    <th className="px-3 py-2.5">{S.benchmark.colThinkingLevel}</th>
                    <th className="px-3 py-2.5">{S.benchmark.colScore}</th>
                    <th className="px-3 py-2.5">{S.common.cost}</th>
                    <th className="px-3 py-2.5">{S.benchmark.colDuration}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Newest first on screen, while the index stays the scoreboard position the
                      dialog is opened by. */}
                  {evaluations
                    .map((ev, index) => ({ ev, index }))
                    .reverse()
                    .map(({ ev, index }) => (
                      <EvaluationRow
                        key={index}
                        evaluation={ev}
                        onOpen={() => setOpenEvaluationIndex(index)}
                        currency={currency}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {openEvaluation && (
        <EvaluationDetailModal
          benchmarkId={bm.id}
          evaluation={openEvaluation}
          caseTitles={caseTitles}
          onOpenCase={setOpenCaseId}
          currency={currency}
          onClose={() => setOpenEvaluationIndex(null)}
        />
      )}
      {openCase && (
        <Modal
          open
          title={openCase.title}
          widthClass="sm:max-w-6xl"
          onClose={() => {
            setOpenCaseId(null);
            setAskingCaseId(null);
          }}
          footer={
            <Button size="sm" variant="secondary" onClick={() => setAskingCaseId(openCase.id)}>
              <GlyphIcon d={MAGIC_WAND_ICON} />
              {S.benchmark.askAi}
            </Button>
          }
        >
          <BenchmarkCaseBrowser projectId={projectId} benchmarkId={bm.id} caseSummary={openCase} />
        </Modal>
      )}
      {openCase && askingCaseId === openCase.id && (
        <AskAiModal
          open
          onClose={() => setAskingCaseId(null)}
          title={S.benchmark.askCaseTitle}
          description={S.benchmark.askCaseDescription}
          question={S.benchmark.askCaseDefault}
          examples={askCaseExamples()}
          tail={askCaseTail(caseAskParams(bm.id, openCase.id, evaluations))}
        />
      )}
    </div>
  );
}
