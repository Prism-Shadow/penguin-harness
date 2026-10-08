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
import { Select } from "../../components/ui/select";
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
  blocked,
  onChoose,
  onRun,
  onStop,
}: {
  choice: PipelineSelection;
  pipeline: PipelineState | null;
  /** Why Run cannot be pressed now, if it cannot. */
  blocked: string | null;
  onChoose: (choice: PipelineSelection) => void;
  onRun: () => void;
  onStop: () => void;
}) {
  const words = S.activities.studioRun;
  const running = pipeline?.status === "running";
  return (
    <div className="shrink-0 space-y-2 border-t border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Select
            size="sm"
            aria-label={words.stage}
            value={choice}
            disabled={running}
            onChange={(event) => onChoose(event.target.value as PipelineSelection)}
          >
            {PIPELINE_CHOICES.map((entry) => (
              <option key={entry} value={entry}>
                {choiceLabel(entry)}
              </option>
            ))}
          </Select>
        </div>
        {running ? (
          <Button size="sm" onClick={onStop}>
            {words.stop}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onRun} disabled={!!blocked}>
            {words.run}
          </Button>
        )}
      </div>
      {!running && blocked && <p className={`text-xs ${toneInk.attention}`}>{blocked}</p>}
    </div>
  );
}

function StepRow({
  step,
  selected,
  onSelect,
}: {
  step: PipelineStepState;
  selected: boolean;
  /** Show this stage's session below the list; absent when the stage has none. */
  onSelect?: () => void;
}) {
  const words = S.activities.studioRun;
  const tone = STEP_TONE[step.status];
  const label = words.steps[step.step];
  const body = (
    <>
      <span
        aria-hidden
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${toneDot[tone]} ${
          step.status === "running" ? "animate-pulse" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
          <span className={`shrink-0 text-xs ${toneInk[tone]}`}>
            {step.total > 0 && step.status === "running"
              ? words.progress(step.done, step.total)
              : words.status[step.status]}
          </span>
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
    <li>
      {onSelect ? (
        <button
          type="button"
          aria-pressed={selected}
          title={words.showLog(label)}
          onClick={onSelect}
          className={`-mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-900 ${
            selected ? "bg-gray-100 dark:bg-gray-900" : ""
          }`}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2 py-1.5">{body}</div>
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
    () => ({ ...transcript.ctx, hideReasoning: !showReasoning, toolOutputActions: true }),
    [transcript.ctx, showReasoning],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="max-h-[50%] shrink-0 overflow-y-auto px-4 pt-3 pb-2">
        <p aria-live="polite" className={`text-xs ${toneInk[line.tone]}`}>
          {line.text}
        </p>
        <ol className="mt-1 divide-y divide-gray-100 dark:divide-gray-900">
          {shown.map((step) => (
            <StepRow
              key={step.step}
              step={step}
              selected={step.step === viewing}
              onSelect={
                sessions.has(step.step)
                  ? () => setChosen({ pipelineId: pipeline.pipelineId, step: step.step })
                  : undefined
              }
            />
          ))}
        </ol>
        <SkippedSteps steps={skipped} />
      </div>
      {viewing && sessionId ? (
        <SessionLog
          key={sessionId}
          sessionId={sessionId}
          title={viewing === runningStep ? words.live : words.steps[viewing]}
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
