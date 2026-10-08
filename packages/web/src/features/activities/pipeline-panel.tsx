/**
 * Running the stages: a stage picker and Run in the Stages panel, which follows
 * the run. What it follows is the running stage's own Session, so its approvals can be
 * answered where it is shown rather than in a separate chat; once a stage is done, its
 * session stays readable there.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type {
  ActivityRunSummary,
  PipelineSelection,
  PipelineStep,
  PipelineState,
  PipelineStepState,
  PipelineStepStatus,
} from "@prismshadow/penguin-server/api";
import { Button } from "../../components/ui/button";
import { Chevron } from "../../components/ui/chevron";
import { Select } from "../../components/ui/select";
import { StatusIcon, type RunState } from "../../components/ui/status-icon";
import { humanizeDuration } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { LiveDuration } from "../chat/live-duration";
import { ShowReasoningSwitch } from "./show-reasoning-switch";
import { useShowReasoning } from "./run-log-prefs";
import { S } from "../../lib/strings";
import { toneDot, toneInk, type Tone } from "../../lib/tone";
import { MessageStream } from "../chat/message-stream";
import { useSessionTranscript } from "./use-session-transcript";

/** Stages the server runs itself, clip by clip, with no agent Session to follow. */
const RUN_BY_SERVER: ReadonlySet<PipelineStep> = new Set(["speech", "words", "sounds"]);

const STEP_TONE: Record<PipelineStepStatus, Tone> = {
  pending: "muted",
  running: "busy",
  succeeded: "success",
  skipped: "muted",
  failed: "danger",
  cancelled: "muted",
};

export const PIPELINE_CHOICES: readonly PipelineSelection[] = [
  "all",
  "spec",
  "mediaSpec",
  "media",
  "translations",
  "speech",
  "words",
  "sounds",
  "images",
  "assessment",
  "module",
  "test",
];

function choiceLabel(choice: PipelineSelection) {
  const words = S.activities.studioRun;
  if (choice === "all") return words.all;
  if (choice === "assets") return words.assets;
  return choice === "narration" ? words.narration : words.steps[choice];
}

/** What the run is doing, or how it ended, in one line. */
function summary(pipeline: PipelineState): { text: string; tone: Tone } {
  const words = S.activities.studioRun;
  if (pipeline.status === "running") {
    const step = pipeline.steps.find((entry) => entry.status === "running");
    const label = step ? words.steps[step.step] : words.status.running;
    const count = step?.total ? ` ${words.progress(step.done, step.total)}` : "";
    return { text: `${words.running(label)}${count}`, tone: "busy" };
  }
  if (pipeline.status === "succeeded") return { text: words.finished, tone: "success" };
  if (pipeline.status === "cancelled") return { text: words.stopped, tone: "muted" };
  return { text: words.failed(pipeline.error ?? words.status.failed), tone: "danger" };
}

/** The stage picker and Run, beside the generation agent in Stages. */
export function PipelineControls({
  choice,
  pipeline,
  agentLabel,
  blocked,
  onChoose,
  onRun,
  onStop,
}: {
  choice: PipelineSelection;
  pipeline: PipelineState | null;
  /** The agent the run uses, named in the one line the controls fold to while it runs. */
  agentLabel: string;
  /** Why Run cannot be pressed now, if it cannot. */
  blocked: string | null;
  onChoose: (choice: PipelineSelection) => void;
  onRun: () => void;
  onStop: () => void;
}) {
  const words = S.activities.studioRun;
  // Nothing can be chosen while a run goes on, so the pickers fold to what was chosen.
  if (pipeline?.status === "running")
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 p-3 dark:border-gray-800">
        <p className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
          {words.runningWith(agentLabel, choiceLabel(pipeline.selection))}
        </p>
        <Button size="sm" onClick={onStop}>
          {words.stop}
        </Button>
      </div>
    );
  return (
    <div className="shrink-0 space-y-2 border-t border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select
            size="sm"
            aria-label={words.stage}
            value={choice}
            onChange={(event) => onChoose(event.target.value as PipelineSelection)}
          >
            {PIPELINE_CHOICES.map((entry) => (
              <option key={entry} value={entry}>
                {choiceLabel(entry)}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" variant="primary" onClick={onRun} disabled={!!blocked}>
          {words.run}
        </Button>
      </div>
      {blocked && <p className={`text-xs ${toneInk.attention}`}>{blocked}</p>}
    </div>
  );
}

const STEP_ICON: Partial<Record<PipelineStepStatus, RunState>> = {
  running: "running",
  succeeded: "done",
  failed: "failed",
  cancelled: "stopped",
};

/** When a stage's runs started and, once every one has settled, when the last finished. */
export interface StepSpan {
  startMs: number;
  endMs: number | null;
}

/** A stage's span, read from its runs; null when none of them carries a time. */
export function stepSpan(
  step: Pick<PipelineStepState, "runIds">,
  byRun: ReadonlyMap<string, Pick<ActivityRunSummary, "status" | "createdAt" | "finishedAt">>,
): StepSpan | null {
  const runs = step.runIds.flatMap((id) => byRun.get(id) ?? []);
  const starts = runs.map((run) => Date.parse(run.createdAt)).filter(Number.isFinite);
  if (!starts.length) return null;
  const ends = runs.map((run) => Date.parse(run.finishedAt ?? "")).filter(Number.isFinite);
  const settled = runs.every((run) => run.status !== "running") && ends.length === runs.length;
  return { startMs: Math.min(...starts), endMs: settled ? Math.max(...ends) : null };
}

/** How long a span took, or, while it is live, has taken so far. */
function SpanTime({ span, live }: { span: StepSpan | null; live: boolean }) {
  if (!span || (span.endMs === null && !live)) return null;
  return (
    <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
      {span.endMs !== null ? (
        humanizeDuration(Math.max(0, span.endMs - span.startMs))
      ) : (
        <LiveDuration sinceMs={span.startMs} />
      )}
    </span>
  );
}

/** A step's mark on the stepper's line: the shared run-state icon, or a ring still to come. */
function StepMark({ status }: { status: PipelineStepStatus }) {
  const state = STEP_ICON[status];
  return (
    <span className="mt-[3px] flex size-3.5 shrink-0 items-center justify-center">
      {state ? (
        <StatusIcon state={state} size={14} />
      ) : (
        <span
          aria-hidden
          className="size-3 rounded-full border-[1.5px] border-gray-300 dark:border-gray-700"
        />
      )}
    </span>
  );
}

/** A stage's segment of the progress bar: an empty track until it starts, then its tone. */
function segmentClass(status: PipelineStepStatus): string {
  if (status === "pending") return "bg-gray-200 dark:bg-gray-800";
  if (status === "running") return `${toneDot.busy} animate-pulse`;
  return toneDot[STEP_TONE[status]];
}

/**
 * The thin line from a step's mark down to the next one. Every mark sits 7px below its row's
 * top whatever the row holds, so a line running from under this mark to 7px past this row's
 * end meets the next mark even when a detail line makes this row taller.
 */
export const STEP_LINE =
  "relative after:absolute after:top-[21px] after:bottom-[-7px] after:left-[6.5px] after:w-px after:bg-gray-200 last:after:hidden dark:after:bg-gray-800";

function StepRow({
  step,
  span,
  selected,
  onSelect,
}: {
  step: PipelineStepState;
  span: StepSpan | null;
  selected: boolean;
  /** Show this stage's session below the list; absent when the stage has none. */
  onSelect?: () => void;
}) {
  const words = S.activities.studioRun;
  const tone = STEP_TONE[step.status];
  const label = words.steps[step.step];
  const running = step.status === "running";
  const body = (
    <>
      <StepMark status={step.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-sm ${running ? "font-medium" : ""}`}>
            {label}
          </span>
          {/* A finished stage says so with its tick and its time; the rest say it in words. */}
          {step.status === "succeeded" ? (
            <span className="sr-only">{words.status.succeeded}</span>
          ) : (
            <span className={`shrink-0 text-xs ${toneInk[tone]}`}>
              {step.total > 0 && running
                ? words.progress(step.done, step.total)
                : words.status[step.status]}
            </span>
          )}
          <SpanTime span={span} live={running} />
        </div>
        {step.detail && (
          <p
            className={`truncate text-xs ${step.status === "failed" ? toneInk.danger : "text-gray-500"}`}
            title={step.detail}
          >
            {step.detail}
          </p>
        )}
      </div>
    </>
  );
  return (
    <li className={STEP_LINE}>
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          title={words.showLog(label)}
          onClick={onSelect}
          className={`-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-900 ${
            selected ? "bg-gray-100 dark:bg-gray-900" : ""
          }`}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2.5 py-1">{body}</div>
      )}
    </li>
  );
}

/** Stages with nothing to do, folded into one line; opened, each says why. */
function SkippedSteps({ steps }: { steps: PipelineStepState[] }) {
  const words = S.activities.studioRun;
  if (!steps.length) return null;
  return (
    <details className="py-1.5 text-xs text-gray-500">
      <summary className="cursor-pointer select-none">
        {words.skipped(steps.length)}: {steps.map((step) => words.steps[step.step]).join(", ")}
      </summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {steps.map((step) => (
          <li key={step.step}>
            {words.steps[step.step]}
            {step.note ? ` — ${words.notes[step.note]}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function SessionLog({
  sessionId,
  title,
  live,
  onAddExcerpt,
}: {
  sessionId: string;
  title: string;
  live: boolean;
  onAddExcerpt: (text: string) => void;
}) {
  const words = S.activities.studioRun;
  const transcript = useSessionTranscript(sessionId, live ? "running" : "idle");
  const [showReasoning, setShowReasoning] = useShowReasoning();
  const ctx = useMemo(
    () => ({
      ...transcript.ctx,
      hideReasoning: !showReasoning,
      toolOutputActions: true,
      runLog: true,
    }),
    [transcript.ctx, showReasoning],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        {live && (
          <span
            aria-hidden
            className={`size-1.5 shrink-0 animate-pulse rounded-full ${toneDot.busy}`}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-500">{title}</span>
        <ShowReasoningSwitch checked={showReasoning} onChange={setShowReasoning} />
        <Link
          to={`/chat/${encodeURIComponent(sessionId)}`}
          className="text-brand-600 hover:text-brand-700 dark:text-brand-300"
        >
          {words.openInChat}
        </Link>
      </div>
      {(transcript.error || transcript.stream.error) && (
        <p role="alert" className={`px-4 text-xs ${toneInk.danger}`}>
          {transcript.error ?? transcript.stream.error}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <MessageStream
          items={transcript.items}
          version={transcript.stream.version}
          ctx={ctx}
          older={transcript.older}
          onAddExcerpt={(excerpt) => onAddExcerpt(excerpt.text)}
        />
      </div>
    </div>
  );
}

/**
 * The run panel: every stage with how it went, and one stage's session below. The
 * running stage is followed live; afterwards any stage that ran an agent can be opened.
 */
export function PipelinePanel({
  pipeline,
  runs,
  agentLabel,
  onAddExcerpt,
}: {
  pipeline: PipelineState | null;
  /** The activity's runs, which say which session each stage's run used. */
  runs: ActivityRunSummary[];
  agentLabel: string;
  /** Ask the activity's conversation about part of a stage's transcript. */
  onAddExcerpt: (text: string) => void;
}) {
  const words = S.activities.studioRun;
  const [chosen, setChosen] = useState<{ pipelineId: string; step: PipelineStep } | null>(null);
  // While a run goes on, its finished stages fold into one row unless the author opens them.
  const [showDone, setShowDone] = useState(false);
  const spans = useMemo(() => {
    const byRun = new Map(runs.map((run) => [run.runId, run]));
    return new Map(
      (pipeline?.steps ?? []).map((step) => [step.step, stepSpan(step, byRun)] as const),
    );
  }, [pipeline, runs]);
  const sessions = useMemo(() => {
    const byRun = new Map(runs.map((run) => [run.runId, run.sessionId]));
    const result = new Map<PipelineStep, string>();
    for (const step of pipeline?.steps ?? []) {
      // A media step runs many times; its latest session is the one worth reading.
      const session = [...step.runIds]
        .reverse()
        .map((runId) => byRun.get(runId))
        .find(Boolean);
      if (session) result.set(step.step, session);
    }
    if (pipeline?.status === "running" && pipeline.currentSessionId) {
      const step = pipeline.steps.find((entry) => entry.status === "running");
      if (step) result.set(step.step, pipeline.currentSessionId);
    }
    return result;
  }, [pipeline, runs]);
  if (!pipeline)
    return (
      <div className="space-y-2 p-4 text-sm text-gray-500">
        <p>{words.idle}</p>
        {agentLabel && <p className="text-xs">{words.with(agentLabel)}</p>}
      </div>
    );
  const line = summary(pipeline);
  const running = pipeline.status === "running";
  const runningStep = pipeline.steps.find((entry) => entry.status === "running")?.step;
  // The author's choice in this run, else the running stage, else the last that ran an agent.
  const viewing =
    (chosen?.pipelineId === pipeline.pipelineId && sessions.has(chosen.step)
      ? chosen.step
      : undefined) ??
    (running ? runningStep : undefined) ??
    [...pipeline.steps].reverse().find((entry) => sessions.has(entry.step))?.step;
  const sessionId = viewing ? sessions.get(viewing) : undefined;
  const shown = pipeline.steps.filter((entry) => entry.status !== "skipped");
  const skipped = pipeline.steps.filter((entry) => entry.status === "skipped");
  const done = shown.filter((entry) => entry.status === "succeeded");
  // A finished stage the author is reading stays in view, folded or not.
  const folded =
    running &&
    !showDone &&
    done.length > 1 &&
    !done.some((entry) => entry.step === viewing && chosen?.step === viewing);
  const doneMs = done.reduce((sum, entry) => {
    const span = spans.get(entry.step);
    return span?.endMs != null ? sum + Math.max(0, span.endMs - span.startMs) : sum;
  }, 0);
  const started = Date.parse(pipeline.startedAt);
  const finished = pipeline.finishedAt ? Date.parse(pipeline.finishedAt) : null;
  const total: StepSpan | null = Number.isFinite(started)
    ? { startMs: started, endMs: finished !== null && Number.isFinite(finished) ? finished : null }
    : null;
  const row = (step: PipelineStepState) => (
    <StepRow
      key={step.step}
      step={step}
      span={spans.get(step.step) ?? null}
      selected={step.step === viewing}
      onSelect={
        sessions.has(step.step)
          ? () => setChosen({ pipelineId: pipeline.pipelineId, step: step.step })
          : undefined
      }
    />
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[50%] shrink-0 space-y-2 overflow-y-auto px-4 pt-3 pb-2">
        <div className="flex items-baseline gap-2 text-xs">
          <p aria-live="polite" className={`min-w-0 flex-1 truncate ${toneInk[line.tone]}`}>
            {line.text}
          </p>
          <span className="shrink-0 text-gray-500 dark:text-gray-400">
            {words.progress(done.length, shown.length)}
          </span>
          <SpanTime span={total} live={running} />
        </div>
        {/* One segment per stage, so how far the run has come reads before any row does. */}
        <div aria-hidden className="flex gap-0.5">
          {shown.map((step) => (
            <span
              key={step.step}
              className={`h-1 flex-1 rounded-full ${segmentClass(step.status)}`}
            />
          ))}
        </div>
        <ol>
          {folded ? (
            <>
              <li className={STEP_LINE}>
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={() => setShowDone(true)}
                  className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded px-2 py-1 text-left text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-900"
                >
                  <StepMark status="succeeded" />
                  <span className="min-w-0 flex-1 truncate">{words.doneFold(done.length)}</span>
                  <Chevron
                    open={false}
                    size={ICON_SIZE.chevronDense}
                    className="mt-1 text-gray-400"
                  />
                  {doneMs > 0 && (
                    <span className="shrink-0 font-mono text-xs tabular-nums text-gray-500 dark:text-gray-400">
                      {humanizeDuration(doneMs)}
                    </span>
                  )}
                </button>
              </li>
              {shown.filter((step) => step.status !== "succeeded").map(row)}
            </>
          ) : (
            shown.map(row)
          )}
        </ol>
        {running && showDone && done.length > 1 && (
          <button
            type="button"
            aria-expanded
            onClick={() => setShowDone(false)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <Chevron open size={ICON_SIZE.chevronDense} />
            {words.doneFold(done.length)}
          </button>
        )}
        <SkippedSteps steps={skipped} />
      </div>
      {viewing && sessionId ? (
        <SessionLog
          key={sessionId}
          sessionId={sessionId}
          title={words.steps[viewing]}
          live={running && sessionId === pipeline.currentSessionId}
          onAddExcerpt={onAddExcerpt}
        />
      ) : running ? (
        <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-gray-800">
          {runningStep && RUN_BY_SERVER.has(runningStep)
            ? words.runByServer
            : words.waitingForSession}
        </p>
      ) : null}
    </div>
  );
}
