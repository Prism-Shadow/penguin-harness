import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  CheckIcon,
  CloseIcon,
  GlyphIcon,
  ICONS,
  Spinner,
  toastError,
  toastInfo,
} from "@prismshadow/penguin-ui";
import { apiErrorText } from "../../../lib/api-error";
import { S } from "../../../lib/strings";
import { hasBoundCapability, polishVoice, runVoice } from "../../../api/project-capabilities";
import { captureSpeech, recordingData } from "./recording";
import { useVoice } from "./voice-scope";
import { MicrophoneMeter } from "./microphone-meter";

type Phase = "idle" | "permission" | "recording" | "transcribing" | "polishing";
export function useDictation({
  insert,
  disabled,
}: {
  insert: (text: string) => void;
  disabled: boolean;
}) {
  const scope = useVoice();
  const canDictate = hasBoundCapability(scope?.settings, "stt");
  const [phase, setPhase] = useState<Phase>("idle");
  const [microphone, setMicrophone] = useState<{
    stream: MediaStream;
    context?: AudioContext;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
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
      trigger.current?.focus();
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
    const escape = (e: KeyboardEvent) => {
      if (job.current && e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancel);
    };
  }, [cancel, dismiss]);
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
      if (!atStart || !hasBoundCapability(atStart, "stt")) return;
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
      if (!latest || !hasBoundCapability(latest, "stt")) return;
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
        setMicrophone(null);
        setPhase("idle");
      }
    }
  }
  if (!canDictate) return { trigger: null, toolbar: null };
  if (phase === "idle")
    return {
      toolbar: null,
      trigger: (
        <button
          type="button"
          ref={trigger}
          aria-label={S.voice.record}
          data-tooltip={S.voice.record}
          disabled={disabled}
          onClick={() => void record()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-muted hover:text-fg disabled:opacity-50"
        >
          <GlyphIcon d={ICONS.microphone} size={18} />
        </button>
      ),
    };
  return {
    trigger: null,
    toolbar: (
      <div role="group" aria-label={S.voice.record} className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-10 shrink-0"
          autoFocus
          onClick={dismiss}
          aria-label={S.voice.cancel}
          leading={<CloseIcon size={13} />}
        >
          {S.common.cancel}
        </Button>
        <div className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-control bg-fill-neutral px-1 py-1">
          {phase === "recording" && microphone ? (
            <>
              <MicrophoneMeter {...microphone} />
              <Button
                variant="primary"
                size="sm"
                className="min-h-9 shrink-0 [--ui-accent:var(--ui-tone-success-emphasis)] [--ui-accent-fg:var(--ui-tone-success-emphasis-fg)]"
                aria-label={S.voice.finish}
                onClick={() => finish.current?.()}
                leading={<CheckIcon size={14} />}
              >
                <span className="@xs:hidden">{S.voice.finishCompact}</span>
                <span className="hidden @xs:inline">{S.voice.finishShort}</span>
              </Button>
            </>
          ) : (
            <span
              role="status"
              className="flex min-w-0 items-center gap-2 py-1 text-sm text-fg-muted"
            >
              <span aria-hidden>
                <Spinner size="sm" label={S.voice[phase]} />
              </span>
              {S.voice[phase]}
            </span>
          )}
        </div>
      </div>
    ),
  };
}
