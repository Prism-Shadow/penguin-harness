/**
 * Running the stages: a stage picker and Run under the hierarchy, and a panel that follows
 * the run. What it follows is the running stage's own Session, so its approvals can be
 * answered where it is shown rather than in a separate chat.
 */
import { useMemo } from "react";
import { Link } from "react-router";
import type {
  PipelineSelection,
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
  "media",
  "translations",
  "speech",
  "images",
  "assessment",
  "module",
];

function choiceLabel(choice: PipelineSelection) {
  const words = S.activities.studioRun;
  if (choice === "all") return words.all;
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

/** The stage picker and Run, at the foot of the hierarchy the stages act on. */
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
  const line = pipeline ? summary(pipeline) : null;
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
      {line && (
        <p
          aria-live="polite"
          className={`truncate text-xs ${toneInk[line.tone]}`}
          title={line.text}
        >
          {line.text}
        </p>
      )}
      {!running && blocked && <p className={`text-xs ${toneInk.attention}`}>{blocked}</p>}
    </div>
  );
}

function StepRow({ step }: { step: PipelineStepState }) {
  const words = S.activities.studioRun;
  const tone = STEP_TONE[step.status];
  return (
    <li className="flex items-start gap-2 py-1.5">
      <span
        aria-hidden
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${toneDot[tone]} ${
          step.status === "running" ? "animate-pulse" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{words.steps[step.step]}</span>
          <span className={`shrink-0 text-xs ${toneInk[tone]}`}>
            {step.total > 0 && step.status === "running"
              ? words.progress(step.done, step.total)
              : words.status[step.status]}
          </span>
        </div>
        {(step.detail || step.note) && (
          <p
            className={`truncate text-xs ${step.status === "failed" ? toneInk.danger : "text-gray-500"}`}
            title={step.detail ?? undefined}
          >
            {step.detail ?? (step.note ? words.notes[step.note] : "")}
          </p>
        )}
      </div>
    </li>
  );
}

function LiveSession({
  sessionId,
  onAddExcerpt,
}: {
  sessionId: string;
  onAddExcerpt: (text: string) => void;
}) {
  const words = S.activities.studioRun;
  const transcript = useSessionTranscript(sessionId, "running");
  const [showReasoning, setShowReasoning] = useShowReasoning();
  const ctx = useMemo(
    () => ({ ...transcript.ctx, hideReasoning: !showReasoning, toolOutputActions: true }),
    [transcript.ctx, showReasoning],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <span className="min-w-0 flex-1 text-xs font-semibold text-gray-500">{words.live}</span>
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

/** The run panel: every step with how it went, and the running step's Session live. */
export function PipelinePanel({
  pipeline,
  agentLabel,
  onAddExcerpt,
}: {
  pipeline: PipelineState | null;
  agentLabel: string;
  /** Ask the activity's conversation about part of a stage's transcript. */
  onAddExcerpt: (text: string) => void;
}) {
  const words = S.activities.studioRun;
  if (!pipeline)
    return (
      <div className="space-y-2 p-4 text-sm text-gray-500">
        <p>{words.idle}</p>
        {agentLabel && <p className="text-xs">{words.with(agentLabel)}</p>}
      </div>
    );
  const line = summary(pipeline);
  const running = pipeline.status === "running";
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pt-3 pb-2">
        <p aria-live="polite" className={`text-xs ${toneInk[line.tone]}`}>
          {line.text}
        </p>
        <ol className="mt-1 divide-y divide-gray-100 dark:divide-gray-900">
          {pipeline.steps.map((step) => (
            <StepRow key={step.step} step={step} />
          ))}
        </ol>
      </div>
      {running &&
        (pipeline.currentSessionId ? (
          <LiveSession
            key={pipeline.currentSessionId}
            sessionId={pipeline.currentSessionId}
            onAddExcerpt={onAddExcerpt}
          />
        ) : (
          <p className="border-t border-gray-200 px-4 py-3 text-xs text-gray-500 dark:border-gray-800">
            {words.waitingForSession}
          </p>
        ))}
    </div>
  );
}
