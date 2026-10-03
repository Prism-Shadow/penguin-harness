/**
 * One evaluation, in a dialog of its own — the same form the case dialog takes, because both
 * are one row of a table opened up rather than a second table unfolded inside the first. It
 * carries what the row could only summarize: the series this score belongs to, the Agent State
 * version it tested (the version no longer splits a series, so this is where a reader finds
 * it), the three stored metrics, the evaluation's own summary, and the per-case scores with the
 * raw result of every Run, each Run a link to the Session it ran in — or, for a Session that is
 * archived and so in no sidebar, a note naming it and where to find it. Nothing here is
 * recomputed: every number
 * is the one the scoreboard stores. Its footer asks the Project's default agent about the
 * result instead of explaining it on screen, since the explanation lives in the Traces.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import type { BenchmarkCaseScore, BenchmarkEvaluation } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  Button,
  Chevron,
  CopyButton,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Modal,
  toastError,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { SettingsDialog } from "../settings";
import { formatDateTime, formatMoney, formatScore, humanizeDuration } from "../../lib/format";
import type { Currency } from "../../state/theme";
import { AskAiModal } from "./ask-ai-modal";
import { evaluationLabel } from "./benchmark-metrics";
import { askEvaluationExamples, askEvaluationTail } from "./benchmark-prompts";
import type { AskEvaluationParams } from "./benchmark-prompts";

/** How agent-evaluation records a Harbor trial in a run's `session_id`: it is no Session. */
const TRIAL_PREFIX = "harbor:";

/** The trial a run's id names, or null for a Session id. */
export function harborTrialName(sessionId: string): string | null {
  return sessionId.startsWith(TRIAL_PREFIX) ? sessionId.slice(TRIAL_PREFIX.length) : null;
}

/**
 * A run's label — "Run #N" under its Case. A run in a Session is a link to that Session
 * (`onOpen` decides what opening means: the Session may be archived). A run recorded as a Harbor
 * trial is no Session the app can open, so it stays text with a button that copies the trial's
 * name — the directory to look for under the Benchmark's `.jobs/`; a run with no id is text.
 */
export function RunLabel({
  index,
  sessionId,
  onOpen,
}: {
  /** 1-based, as the label reads. */
  index: number;
  sessionId?: string;
  onOpen: (sessionId: string) => void;
}) {
  const label = `${S.benchmark.colRun} #${index}`;
  if (!sessionId) return <span>{label}</span>;
  const trial = harborTrialName(sessionId);
  if (trial !== null) {
    return (
      <span className="inline-flex items-center gap-1">
        {label}
        <CopyButton text={trial} label={S.benchmark.copyTrialName} size="sm" className="shrink-0" />
      </span>
    );
  }
  return (
    <button
      type="button"
      data-tooltip={S.benchmark.runOpenSession}
      data-tooltip-extra
      onClick={() => onOpen(sessionId)}
      className="text-link underline-offset-2 transition-colors duration-150 hover:text-link-hover hover:underline"
    >
      {label}
    </button>
  );
}

/**
 * Score row for one Case: stored Case averages are authoritative. Expanding shows raw Run
 * results; the UI never recomputes averages.
 */
function CaseRow({
  caseScore: c,
  title,
  currency,
  onOpenRun,
}: {
  caseScore: BenchmarkCaseScore;
  title?: string;
  currency: Currency;
  onOpenRun: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const runs = c.runs;
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-default text-xs transition-colors duration-150 hover:bg-gray-100/70 dark:hover:bg-gray-800/40"
      >
        <td className="px-2 py-1">
          <span className="flex items-start gap-1.5">
            <Chevron open={open} size={12} className="text-gray-400" />
            <span className="min-w-0">
              <span className="block font-medium text-gray-800 dark:text-gray-200">
                {title ?? c.case}
              </span>
              {title && title !== c.case && (
                <span className="block font-mono text-xs text-gray-400">{c.case}</span>
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
      </tr>
      {open &&
        runs.map((run, i) => (
          <tr key={i} className="text-xs text-gray-500 dark:text-gray-400">
            {/* Indented run row: Run #1, #2, ... (the case's metrics are their average), each
                opening the Session it ran in. */}
            <td className="py-1 pl-7 pr-2 font-mono">
              <RunLabel
                index={i + 1}
                {...(run.sessionId ? { sessionId: run.sessionId } : {})}
                onOpen={onOpenRun}
              />
            </td>
            <td className="px-2 py-1 font-mono tabular-nums">{formatScore(run.score)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">{formatMoney(run.cost, currency)}</td>
            <td className="px-2 py-1 font-mono tabular-nums">
              {run.durationMs !== undefined ? humanizeDuration(run.durationMs) : "—"}
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
      <span className="block text-xs text-gray-500 dark:text-gray-400">{label}</span>
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
  currency,
  onClose,
}: {
  benchmarkId: string;
  evaluation: BenchmarkEvaluation;
  caseTitles: ReadonlyMap<string, string>;
  currency: Currency;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  /** The archived Session a run link was pressed for: no sidebar lists it, so it is named here. */
  const [archivedRun, setArchivedRun] = useState<{ sessionId: string; title: string } | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  /**
   * A run link: the Session opens in the chat page, unless it is archived — then a note names it
   * (title and ID) and points to Settings › Archived chats, where it is listed. Read at click
   * time, so the answer is the Session's state now, not when the dialog opened.
   */
  const openRun = async (sessionId: string) => {
    try {
      const { session } = await api.getSession(sessionId);
      if (session.archived) {
        setArchivedRun({ sessionId, title: session.title ?? "" });
        return;
      }
      onClose();
      navigate(`/chat/${encodeURIComponent(sessionId)}`);
    } catch (e) {
      toastError(apiErrorText(e));
    }
  };
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
              <GlyphIcon d={ICONS.wand} />
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
                  </tr>
                </thead>
                <tbody>
                  {evaluation.cases.map((c) => (
                    <CaseRow
                      key={c.case}
                      caseScore={c}
                      title={caseTitles.get(c.case)}
                      currency={currency}
                      onOpenRun={(id) => void openRun(id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Modal>

      {archivedRun !== null && (
        <Modal
          open
          title={S.benchmark.runArchivedTitle}
          widthClass="sm:max-w-md"
          onClose={() => setArchivedRun(null)}
          footer={
            <>
              <Button size="sm" onClick={() => setArchivedRun(null)}>
                {S.common.close}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setArchiveOpen(true)}>
                {S.benchmark.runArchivedOpen}
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg">{S.benchmark.runArchivedBody}</p>
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-fg-muted">{S.benchmark.runArchivedSessionTitle}</dt>
            <dd className="min-w-0 break-words text-fg">
              {archivedRun.title || S.benchmark.runSessionUntitled}
            </dd>
            <dt className="text-fg-muted">{S.benchmark.runArchivedSessionId}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 break-all font-mono text-fg">{archivedRun.sessionId}</span>
              <CopyButton
                text={archivedRun.sessionId}
                label={S.benchmark.runArchivedCopyId}
                size="sm"
                className="shrink-0"
              />
            </dd>
          </dl>
        </Modal>
      )}
      <SettingsDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} section="archived" />

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
