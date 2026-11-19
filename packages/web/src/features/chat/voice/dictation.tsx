/**
 * Dictation into the composer's draft. The hook returns two pieces the composer places:
 *
 * - `trigger`, the record button, which stands directly before Send for the whole dictation —
 *   the microphone at rest, the finish square while recording, a spinner while the microphone
 *   opens or the recording is transcribed and polished — so the toolbar's right group keeps its
 *   width and Send never moves;
 * - `strip`, which takes the place of the toolbar's left group while a dictation runs: the cancel
 *   control, then the elapsed time and the level meter, or the step that is running.
 *
 * `active` is true from the first press until the text is inserted or the dictation is cancelled;
 * the composer holds Send and Enter for that time. Esc cancels through the shared Escape stack,
 * so a dialog or menu opened over the composer closes first and the recording goes on.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ICONS,
  MicrophoneMeter,
  RecordButton,
  ToolbarTrigger,
  toastError,
  toastInfo,
  useEscLayer,
  useMicrophoneLevels,
} from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../../lib/api-error";
import { S } from "../../../lib/strings";
import { polishVoice, runVoice } from "../../../api/project-capabilities";
import { hasBoundCapability } from "../../../lib/bound-capability";
import { captureSpeech, recordingData } from "./recording";
import { useVoice } from "./voice-scope";

type Phase = "idle" | "permission" | "recording" | "transcribing" | "polishing";

/** The meter of one recording: the shared readout fed by this stream's levels. */
function DictationMeter({ stream, context }: { stream: MediaStream; context?: AudioContext }) {
  const levels = useMicrophoneLevels(stream, context);
  return (
    <MicrophoneMeter
      {...levels}
      labels={{
        level: S.voice.inputLevel,
        quiet: S.voice.quiet,
        sound: S.voice.soundDetected,
        recording: S.voice.recording,
      }}
    />
  );
}

export function useDictation({
  insert,
  disabled,
}: {
  insert: (text: string) => void;
  disabled: boolean;
}) {
  const scope = useVoice();
  const canDictate = hasBoundCapability(scope?.settings, "s2t");
  const [phase, setPhase] = useState<Phase>("idle");
  const [microphone, setMicrophone] = useState<{
    stream: MediaStream;
    context?: AudioContext;
  } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
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
    setMicrophone(null);
    setPhase("idle");
  }, []);
  const dismiss = useCallback(() => {
    returnFocus.current = true;
    cancel();
  }, [cancel]);
  useLayoutEffect(() => {
    if (phase === "idle" && returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [phase]);
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
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel]);
  useEscLayer(phase !== "idle", dismiss);
  async function record() {
    if (!scope?.active || !canDictate || job.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toastError(S.voice.unsupported);
      return;
    }
    scope.stop();
    const task = new AbortController();
    job.current = task;
    setPhase("permission");
    try {
      const atStart = await scope.readCurrent(task.signal);
      if (!atStart || !hasBoundCapability(atStart, "s2t")) return;
      const supported =
        atStart.dictationFormat === "audio/wav"
          ? typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined"
          : typeof MediaRecorder !== "undefined";
      if (!supported) {
        toastError(S.voice.unsupported);
        return;
      }
      const blob = await captureSpeech(
        task.signal,
        (stop, stream, context) => {
          finish.current = stop;
          setMicrophone({ stream, context });
          setPhase("recording");
        },
        atStart.dictationFormat,
      );
      task.signal.throwIfAborted();
      finish.current = null;
      setMicrophone(null);
      if (!blob.size) {
        toastInfo(S.voice.empty);
        return;
      }
      setPhase("transcribing");
      const latest = await scope.readCurrent(task.signal);
      if (!latest || !hasBoundCapability(latest, "s2t")) return;
      if (latest.dictationFormat && latest.dictationFormat !== blob.type) {
        toastInfo(S.voice.modelChanged);
        return;
      }
      const audio = await recordingData(blob);
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
      if (latest.voicePolish.enabled && hasBoundCapability(latest, "t2t")) {
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
        setMicrophone(null);
        setPhase("idle");
      }
    }
  }
  if (!canDictate) return { trigger: null, strip: null, active: false };
  const recording = phase === "recording";
  const trigger = (
    <RecordButton
      ref={button}
      state={phase === "idle" ? "idle" : recording ? "recording" : "waiting"}
      label={phase === "idle" ? S.voice.record : recording ? S.voice.finish : S.voice[phase]}
      disabled={disabled}
      onClick={() => {
        if (phase === "idle") void record();
        else finish.current?.();
      }}
    />
  );
  if (phase === "idle") return { trigger, strip: null, active: false };
  return {
    trigger,
    active: true,
    strip: (
      <div role="group" aria-label={S.voice.record} className="flex min-w-0 items-center gap-1">
        <ToolbarTrigger glyph={ICONS.cross} ariaLabel={S.voice.cancel} onClick={dismiss} />
        {recording && microphone ? (
          <DictationMeter {...microphone} />
        ) : (
          <span role="status" className="truncate whitespace-nowrap px-1 text-xs text-fg-muted">
            {S.voice[phase]}
          </span>
        )}
      </div>
    ),
  };
}
