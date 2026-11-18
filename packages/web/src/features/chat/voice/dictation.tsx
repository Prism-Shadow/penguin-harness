import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, GlyphIcon, ICONS, Spinner, toastError, toastInfo } from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../../lib/api-error";
import { S } from "../../../lib/strings";
import { hasBoundCapability, polishVoice, runVoice } from "../../../api/project-capabilities";
import { captureSpeech, recordingData } from "./recording";
import { useVoice } from "./voice-scope";

type Phase = "idle" | "permission" | "recording" | "transcribing" | "polishing";
export function Dictation({
  insert,
  disabled,
}: {
  insert: (text: string) => void;
  disabled: boolean;
}) {
  const scope = useVoice();
  const canDictate = hasBoundCapability(scope?.settings, "stt");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const job = useRef<AbortController | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const target = useRef(insert);
  useLayoutEffect(() => {
    target.current = insert;
  }, [insert]);
  const cancel = useCallback(() => {
    job.current?.abort();
    job.current = null;
    finish.current = null;
    setPhase("idle");
  }, []);
  useLayoutEffect(
    () => cancel,
    [scope?.projectId, scope?.server, scope?.sessionId, scope?.active, canDictate, cancel],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancel);
    const escape = (e: KeyboardEvent) => {
      if (job.current && e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel]);
  useEffect(() => {
    if (phase !== "recording") return;
    const start = Date.now();
    setSeconds(0);
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(timer);
  }, [phase]);
  async function record() {
    if (!scope?.active || !canDictate || job.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toastError(S.voice.unsupported);
      return;
    }
    scope.stop();
    const task = new AbortController();
    job.current = task;
    setPhase("permission");
    try {
      if (!hasBoundCapability(await scope.readCurrent(task.signal), "stt")) return;
      const blob = await captureSpeech(task.signal, (stop) => {
        finish.current = stop;
        setPhase("recording");
      });
      task.signal.throwIfAborted();
      finish.current = null;
      if (!blob.size) {
        toastInfo(S.voice.empty);
        return;
      }
      setPhase("transcribing");
      const latest = await scope.readCurrent(task.signal);
      if (!latest || !hasBoundCapability(latest, "stt")) return;
      const audio = await recordingData(blob, latest.dictationFormat, task.signal);
      task.signal.throwIfAborted();
      const result = await runVoice(
        scope.projectId,
        scope.server,
        "stt",
        {
          audio,
          ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
        },
        task.signal,
      );
      task.signal.throwIfAborted();
      let text = result.text?.trim();
      if (!text) {
        toastInfo(S.voice.empty);
        return;
      }
      if (latest.voicePolish.enabled && latest.voicePolish.model) {
        setPhase("polishing");
        try {
          const polished = await polishVoice(
            scope.projectId,
            scope.server,
            text,
            scope.sessionId,
            task.signal,
          );
          if (!polished.text?.trim()) throw new Error("empty");
          text = polished.text.trim();
        } catch (e) {
          if (task.signal.aborted) throw e;
          toastInfo(S.voice.original);
        }
      }
      task.signal.throwIfAborted();
      target.current(text);
    } catch (e) {
      if (!task.signal.aborted) {
        const denied =
          e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
        toastError(
          denied
            ? S.voice.denied
            : e instanceof RangeError
              ? S.voice.tooLarge
              : e instanceof Error && e.message === "recording_failed"
                ? S.voice.recordFailed
                : apiErrorText(e),
        );
      }
    } finally {
      if (job.current === task) {
        job.current = null;
        finish.current = null;
        setPhase("idle");
      }
    }
  }
  if (!canDictate) return null;
  if (phase === "idle")
    return (
      <button
        type="button"
        aria-label={S.voice.record}
        data-tooltip={S.voice.record}
        disabled={disabled}
        onClick={() => void record()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-50"
      >
        <GlyphIcon d={ICONS.microphone} size={18} />
      </button>
    );
  const label = phase === "recording" ? S.voice.finish : S.voice[phase];
  return (
    <div className="flex shrink-0 items-center gap-1" aria-live="polite">
      {phase === "recording" ? (
        <button
          type="button"
          className="flex h-8 items-center gap-1 rounded-md px-1 text-tone-danger-fg"
          aria-label={label}
          data-tooltip={label}
          onClick={() => finish.current?.()}
        >
          <GlyphIcon d={ICONS.stopCircle} size={18} />
          <span aria-hidden className="text-xs tabular-nums">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
        </button>
      ) : (
        <Spinner size="sm" label={label} />
      )}
      <Button size="xs" variant="ghost" onClick={cancel} aria-label={S.voice.cancel}>
        {S.common.cancel}
      </Button>
    </div>
  );
}
