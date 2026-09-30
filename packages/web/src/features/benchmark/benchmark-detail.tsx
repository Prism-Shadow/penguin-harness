/**
 * One Benchmark's detail: case counts and description, the case list, a Score-only chart grouped
 * into series by each Evaluation's label — the tested Agent, the model and the thinking level —
 * and the evaluation table, which spells that label out across its Agent, version, model and
 * thinking-level columns. A row there opens that evaluation in a dialog, a case opens the case
 * browser in another, and either dialog can hand what it shows to an agent as a question. This
 * is the body of the Benchmark's own page (the title lives in that page's header), which mounts
 * it once its Benchmark has been read, so nothing stays open from the Benchmark before it. The
 * Benchmark is the merge of every machine holding it: a row names the machine its round was read
 * from when there is more than one, and a case's files come from the machine that listed it.
 */
import { useEffect, useState } from "react";
import type { BenchmarkCaseSummary, BenchmarkEvaluation } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Button,
  Card,
  ChartFrame,
  ChartLine,
  ChartPoint,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Legend,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  makeRangeGeom,
  segmentPoints,
  useChartWidth,
} from "@prismshadow/penguin-ui";
import type { ChartPaint } from "@prismshadow/penguin-ui";
import type { MergedBenchmark, MergedCase } from "../../lib/benchmark-merge";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import { NEUTRAL_SERIES } from "../../lib/category-colors";
import { AskAiModal } from "./ask-ai-modal";
import { BenchmarkCaseBrowser } from "./benchmark-case-browser";
import { fetchBenchmarkCases } from "./benchmark-sources";
import {
  evaluationLabel,
  labelSeries,
  scoreScale,
  scoreValues,
  seriesPoints,
} from "./benchmark-metrics";
import type { EvaluationSeries } from "./benchmark-metrics";
import { askCaseExamples, askCaseTail } from "./benchmark-prompts";
import type { AskCaseParams } from "./benchmark-prompts";
import { EvaluationDetailModal } from "./evaluation-detail-modal";

/** A score series' paint: palette slot i, or the neutral for the evaluations with no label. */
const scoreSeriesPaint = (s: EvaluationSeries, i: number): ChartPaint =>
  s.unlabeled ? { ink: NEUTRAL_SERIES.text, swatch: NEUTRAL_SERIES.swatch } : { series: i };

/**
 * Score-over-time line chart: one x slot per evaluation in scoreboard order, labeled with its
 * timestamp. Scores remain valid on 0..100, while the visible y-axis is padded around the
 * observed range and clamped to those limits. Evaluations are grouped by label, so a change of
 * tested Agent or of runtime starts its own series instead of bending one, while a new Agent
 * State version of the same agent continues the line and names its version in the bubble. Each
 * series is one line through its own points (seriesPoints): the slots other series hold in
 * between do not break it.
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
            const points = seriesPoints(evaluations, s);
            const paint = scoreSeriesPaint(s, si);
            return (
              <g key={s.unlabeled ? "unlabeled" : s.key}>
                {points.length > 1 && (
                  <ChartLine
                    points={segmentPoints(geom, points)}
                    paint={paint}
                    opacity={hover !== null ? 0.35 : 1}
                  />
                )}
                {points.map((p) => (
                  <ChartPoint
                    key={p.index}
                    cx={geom.x(p.index)}
                    cy={geom.y(p.value)}
                    paint={paint}
                    grow={hover === p.index}
                    opacity={hover !== null && hover !== p.index ? 0.25 : 1}
                  />
                ))}
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
        <Legend
          items={series.map((s, i) => ({
            key: s.unlabeled ? "unlabeled" : s.key,
            label: labelOf(s),
            paint: scoreSeriesPaint(s, i),
            shape: "block" as const,
          }))}
          mono
          className="mb-1.5"
        />
      )}
      <ScoreTrendChart evaluations={evaluations} series={series} />
    </div>
  );
}

/** One evaluation record: a clickable row; the detail it used to unfold is a dialog of its own. */
function EvaluationRow({
  evaluation,
  machineName,
  onOpen,
  currency,
}: {
  evaluation: BenchmarkEvaluation;
  /**
   * The ssh alias of the machine whose scoreboard recorded this round, when the Benchmark is
   * held in more than one place — otherwise null, and nothing is said. A row read without
   * knowing where it ran is a row that cannot be reproduced.
   */
  machineName: string | null;
  onOpen: () => void;
  currency: Currency;
}) {
  return (
    <TableRow onClick={onOpen} className="cursor-pointer">
      <TableCell>
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
        {machineName !== null && (
          <span className="ml-1.5 font-mono text-xs text-gray-400 dark:text-gray-500">
            {S.chat.machineTag(machineName)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs text-gray-500 dark:text-gray-400">
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
      </TableCell>
      <TableCell className="font-mono text-xs text-gray-500 dark:text-gray-400">
        {evaluation.version !== undefined ? `v${evaluation.version}` : "—"}
      </TableCell>
      <TableCell
        className="max-w-40 truncate font-mono text-xs text-gray-500 dark:text-gray-400"
        data-tooltip={evaluation.provider}
        data-tooltip-content="code"
      >
        {evaluation.modelId}
      </TableCell>
      <TableCell className="font-mono text-xs text-gray-500 dark:text-gray-400">
        {evaluation.thinkingLevel}
      </TableCell>
      {/* Figures, but left-aligned under their headers like every other column here. */}
      <TableCell align="left" numeric className="font-mono text-xs font-semibold">
        {formatScore(evaluation.score)}
      </TableCell>
      <TableCell
        align="left"
        numeric
        className="font-mono text-xs text-gray-500 dark:text-gray-400"
      >
        {formatMoney(evaluation.cost, currency)}
      </TableCell>
      <TableCell
        align="left"
        numeric
        className="font-mono text-xs text-gray-500 dark:text-gray-400"
      >
        {evaluation.durationMs !== undefined ? humanizeDuration(evaluation.durationMs) : "—"}
      </TableCell>
    </TableRow>
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
      <Card padding="none">
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
                <span className="block truncate font-mono text-xs text-gray-400">{item.id}</span>
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
      </Card>
    </div>
  );
}

export function BenchmarkDetail({
  projectId,
  benchmark: bm,
  machineNameOf,
}: {
  projectId: string;
  benchmark: MergedBenchmark;
  /** The ssh alias of a machine, or null for this server. */
  machineNameOf: (machineId: string | null) => string | null;
}) {
  const { currency } = useTheme();
  const [caseStatements, setCaseStatements] = useState<MergedCase[] | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const machinesKey = bm.machineIds.map((machineId) => machineId ?? "").join(",");
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
    fetchBenchmarkCases(projectId, bm)
      .then((cases) => {
        if (!cancelled) setCaseStatements(cases);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCaseError(apiErrorText(error));
      });
    return () => {
      cancelled = true;
    };
    // The machines are part of what the read asks; the key keeps a re-render from re-asking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, bm.id, machinesKey]);

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
            <Table tableClassName="min-w-[820px]">
              <TableHead>
                <TableHeaderCell>{S.common.time}</TableHeaderCell>
                <TableHeaderCell>{S.benchmark.agentColumn}</TableHeaderCell>
                <TableHeaderCell>{S.benchmark.colVersion}</TableHeaderCell>
                <TableHeaderCell>{S.benchmark.colModel}</TableHeaderCell>
                <TableHeaderCell>{S.benchmark.colThinkingLevel}</TableHeaderCell>
                <TableHeaderCell>{S.benchmark.colScore}</TableHeaderCell>
                <TableHeaderCell>{S.common.cost}</TableHeaderCell>
                <TableHeaderCell>{S.benchmark.colDuration}</TableHeaderCell>
              </TableHead>
              <TableBody>
                {/* Newest first on screen, while the index stays the scoreboard position the
                    dialog is opened by. */}
                {evaluations
                  .map((ev, index) => ({ ev, index }))
                  .reverse()
                  .map(({ ev, index }) => (
                    <EvaluationRow
                      key={index}
                      evaluation={ev}
                      machineName={bm.machineIds.length > 1 ? machineNameOf(ev.machineId) : null}
                      onOpen={() => setOpenEvaluationIndex(index)}
                      currency={currency}
                    />
                  ))}
              </TableBody>
            </Table>
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
              <GlyphIcon d={ICONS.wand} />
              {S.benchmark.askAi}
            </Button>
          }
        >
          <BenchmarkCaseBrowser
            projectId={projectId}
            benchmarkId={bm.id}
            caseSummary={openCase}
            machineId={openCase.machineId}
          />
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
