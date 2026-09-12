/**
 * One evaluation, in a dialog of its own — the same form the case dialog takes, because both
 * are one row of a table opened up rather than a second table unfolded inside the first. It
 * carries what the row could only summarize: the series this score belongs to, the Agent State
 * version it tested (the version no longer splits a series, so this is where a reader finds
 * it), the three stored metrics, the evaluation's own summary, and the per-case scores with the
 * raw result of every Run and the Session it ran in. Nothing here is recomputed: every number
 * is the one the scoreboard stores. Its footer asks the Project's default agent about the
 * result instead of explaining it on screen, since the explanation lives in the Traces.
 */
import { useState } from "react";
import type { BenchmarkCaseScore, BenchmarkEvaluation } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import type { Currency } from "../../state/theme";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { MAGIC_WAND_ICON } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { AskAiModal } from "./ask-ai-modal";
import { evaluationLabel } from "./benchmark-metrics";
import { askEvaluationExamples, askEvaluationTail } from "./benchmark-prompts";
import type { AskEvaluationParams } from "./benchmark-prompts";

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

/** One of the three stored metrics: its name over its value, the Score carrying the weight. */
function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className="min-w-0">
      <span className="block text-[11px] text-gray-500 dark:text-gray-400">{label}</span>
      <span
        className={`block font-mono text-xs tabular-nums ${strong ? "font-semibold" : "text-gray-600 dark:text-gray-300"}`}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * What the "Ask AI" question carries: this evaluation's facts, formatted exactly as the dialog
 * prints them, so the prompt and the screen it was asked from agree on every number.
 */
function askParams(
  benchmarkId: string,
  evaluation: BenchmarkEvaluation,
  labelText: string,
  currency: Currency,
): AskEvaluationParams {
  return {
    benchmarkId,
    time: formatDateTime(evaluation.time),
    label: labelText,
    version: evaluation.version,
    provider: evaluation.provider,
    modelId: evaluation.modelId,
    thinkingLevel: evaluation.thinkingLevel,
    score: formatScore(evaluation.score),
    cost: formatMoney(evaluation.cost, currency),
    duration: humanizeDuration(evaluation.durationMs),
    summaryTitle: evaluation.summaryTitle ?? "",
    summary: evaluation.summary ?? "",
    cases: evaluation.cases.map((c) => ({
      id: c.case,
      score: formatScore(c.score),
      cost: formatMoney(c.cost, currency),
      duration: humanizeDuration(c.durationMs),
      sessionIds: c.runs.map((run) => run.sessionId).filter((id) => id !== ""),
    })),
  };
}

export function EvaluationDetailModal({
  benchmarkId,
  evaluation,
  caseTitles,
  onOpenCase,
  currency,
  onClose,
}: {
  benchmarkId: string;
  evaluation: BenchmarkEvaluation;
  caseTitles: ReadonlyMap<string, string>;
  onOpenCase: (caseId: string) => void;
  currency: Currency;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const label = evaluationLabel(evaluation);
  const labelText = label.unlabeled ? S.benchmark.unlabeled : label.text;

  return (
    <>
      <Modal
        open
        title={S.benchmark.evaluationDetailTitle(formatDateTime(evaluation.time))}
        widthClass="sm:max-w-3xl"
        onClose={onClose}
        footer={
          <>
            <Button size="sm" onClick={onClose}>
              {S.common.close}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
              <GlyphIcon d={MAGIC_WAND_ICON} />
              {S.benchmark.askAi}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Which series this point sits on, and the version it tested: the series label no
              longer carries the version, so this line is where a reader reads it. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={`flex min-w-0 items-center ${ICON_GAP.row}`}>
              {evaluation.agentId && (
                <AgentAvatar
                  id={evaluation.agentId}
                  size={ICON_SIZE.rowLead}
                  className="shrink-0 rounded"
                />
              )}
              <span className="min-w-0 truncate font-mono text-xs text-gray-600 dark:text-gray-300">
                {labelText}
              </span>
            </span>
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">
              v{evaluation.version}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-gray-200 bg-gray-50/80 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/40">
            <Metric label={S.benchmark.colScore} value={formatScore(evaluation.score)} strong />
            <Metric label={S.common.cost} value={formatMoney(evaluation.cost, currency)} />
            <Metric
              label={S.benchmark.colDuration}
              value={humanizeDuration(evaluation.durationMs)}
            />
          </div>

          {/* Evaluation summary title and body are displayed separately when present. */}
          {(evaluation.summaryTitle || evaluation.summary) && (
            <div>
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

          <div>
            <p className="mb-1 text-xs font-semibold text-gray-500">{S.benchmark.cases}</p>
            <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50/80 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                    <th className="px-2 py-1.5 font-medium">{S.benchmark.colCase}</th>
                    <th className="px-2 py-1.5 font-medium">{S.benchmark.colScore}</th>
                    <th className="px-2 py-1.5 font-medium">{S.common.cost}</th>
                    <th className="px-2 py-1.5 font-medium">{S.benchmark.colDuration}</th>
                    <th className="px-2 py-1.5 font-medium">{S.benchmark.colSession}</th>
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
            </div>
          </div>
        </div>
      </Modal>

      {asking && (
        <AskAiModal
          open
          onClose={() => setAsking(false)}
          title={S.benchmark.askEvaluationTitle}
          description={S.benchmark.askEvaluationDescription}
          question={S.benchmark.askEvaluationDefault}
          examples={askEvaluationExamples()}
          tail={askEvaluationTail(askParams(benchmarkId, evaluation, labelText, currency))}
        />
      )}
    </>
  );
}
