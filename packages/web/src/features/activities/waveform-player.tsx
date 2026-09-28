/**
 * A speech clip with its shape drawn above it. The picture is geometry rather than an
 * icon, so it draws itself on a canvas, like the app's other charts.
 *
 * Nothing is fetched until the author asks: narration lists can be long, and decoding
 * every clip on mount would pull the whole activity's audio down to render a page. The
 * native player underneath owns playback and keyboard control, so the canvas never has
 * to reimplement either; it adds seeking by position and a place to see where the words
 * are. When decoding is unavailable or fails, the player stays and only the picture is
 * missing, which is said rather than left blank.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { usePrefersReducedMotion } from "../../components/ui/use-reduced-motion";
import {
  clipTime,
  encodeWav,
  normalizePeaks,
  playedFraction,
  remainingLength,
  removeRange,
  selectionBetween,
  seekTime,
  selectionFromDrag,
  wavSampleRate,
  waveformPeaks,
} from "./waveform";
import { toneInk } from "../../lib/tone";

const COLUMN_WIDTH = 3;
const COLUMN_GAP = 1;
/** Resolution the decoded clip is stored at, finer than any column count drawn. */
const ENVELOPE_COLUMNS = 2000;

export function WaveformPlayer({
  src,
  label,
  /** Drawn straight away, for the one clip an author is working on. */
  autoLoad = false,
  onTrim,
  onDecoded,
  onTime,
}: {
  src: string;
  label: string;
  autoLoad?: boolean;
  /**
   * Offered the clip with a selected stretch removed, as a WAV file, to store and bind in
   * place of this one. Absent where the clip cannot be replaced, which leaves no trimming.
   */
  onTrim?: (wav: Uint8Array) => Promise<void>;
  /** Told the clip's length in seconds once it is decoded, so a caller need not measure it again. */
  onDecoded?: (seconds: number) => void;
  /** Told where playback is, in seconds, as it plays and after a seek (word highlighting). */
  onTime?: (seconds: number) => void;
}) {
  // Read at decode time, so a new callback each render never restarts the decode.
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Always mounted, unlike the canvas, so there is something to measure before the
  // first draw and something to watch when the workbench is resized.
  const boxRef = useRef<HTMLDivElement>(null);
  // The decoded envelope at a fixed resolution, re-bucketed to whatever width the
  // canvas actually has. Keeping it means a resize never re-fetches or re-decodes.
  const [envelope, setEnvelope] = useState<number[] | null>(null);
  const [width, setWidth] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [requested, setRequested] = useState(autoLoad);
  const [failed, setFailed] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  // A trim: a stretch dragged across the waveform, played on its own or cut out.
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);
  const stopAt = useRef<number | null>(null);
  // Playing what a trim would keep jumps over the selection.
  const skip = useRef<{ start: number; end: number } | null>(null);
  // A selection made from the keyboard: Enter marks where it starts, then where it ends.
  const [mark, setMark] = useState<number | null>(null);

  useEffect(() => {
    setEnvelope(null);
    setPeaks(null);
    setFailed(false);
    setPosition(0);
    setDuration(0);
    setRequested(autoLoad);
    setSelection(null);
    setTrimError(null);
  }, [src, autoLoad]);

  // Measure the box, and keep measuring it: the workbench is a resizable two-column
  // layout, and a waveform drawn for a stale width leaves an empty remainder.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setWidth(box.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Re-bucket the stored envelope whenever the width changes. Cheap: no decode, no fetch.
  useEffect(() => {
    if (!envelope) return;
    const columns = Math.max(1, Math.floor(width / (COLUMN_WIDTH + COLUMN_GAP)));
    setPeaks(normalizePeaks(waveformPeaks(Float32Array.from(envelope), columns)));
  }, [envelope, width]);

  useEffect(() => {
    if (!requested || envelope || failed) return;
    let cancelled = false;
    // decodeAudioData wants the whole clip, so this runs once per clip and never per frame.
    void (async () => {
      try {
        // Safari still exposes the prefixed constructor only.
        const Context =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) throw new Error("no audio context");
        const response = await fetch(src, { credentials: "same-origin" });
        if (!response.ok) throw new Error(String(response.status));
        const context = new Context();
        try {
          const decoded = await context.decodeAudioData(await response.arrayBuffer());
          if (cancelled) return;
          // Stored at a resolution finer than any column count the layout will ask for.
          setEnvelope(waveformPeaks(decoded.getChannelData(0), ENVELOPE_COLUMNS));
          setDuration(decoded.duration);
          onDecodedRef.current?.(decoded.duration);
        } finally {
          void context.close();
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested, envelope, failed, src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !peaks?.length) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    // currentColor is not available to canvas, so the two inks are read from the element.
    const styles = getComputedStyle(canvas);
    const played = styles.getPropertyValue("color");
    // Not the background: bars in the canvas's own background colour would be invisible.
    const rest = styles.getPropertyValue("caret-color");
    // The selection's ink is the border colour, which the canvas carries but never draws.
    const selected = styles.getPropertyValue("border-top-color");
    const boundary = playedFraction(position, duration) * peaks.length;
    const [from, to] = selection
      ? [
          playedFraction(selection.start, duration) * peaks.length,
          playedFraction(selection.end, duration) * peaks.length,
        ]
      : [-1, -1];
    for (const [index, peak] of peaks.entries()) {
      const bar = Math.max(1, peak * (height - 2));
      context.fillStyle = index >= from && index < to ? selected : index < boundary ? played : rest;
      context.fillRect(index * (COLUMN_WIDTH + COLUMN_GAP), (height - bar) / 2, COLUMN_WIDTH, bar);
    }
  }, [peaks, position, duration, selection]);

  function offset(clientX: number): { x: number; width: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, width: rect.width };
  }

  function playSelection() {
    const audio = audioRef.current;
    if (!audio || !selection) return;
    skip.current = null;
    audio.currentTime = selection.start;
    stopAt.current = selection.end;
    void audio.play();
  }

  function playRemaining() {
    const audio = audioRef.current;
    if (!audio || !selection) return;
    stopAt.current = null;
    skip.current = selection;
    audio.currentTime = selection.start > 0 ? 0 : selection.end;
    void audio.play();
  }

  async function removeSelection() {
    if (!selection || !onTrim) return;
    setTrimming(true);
    setTrimError(null);
    try {
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Context) throw new Error(S.activities.waveformTrim.noAudio);
      const response = await fetch(src, { credentials: "same-origin" });
      if (!response.ok) throw new Error(S.activities.waveformTrim.fetchFailed(response.status));
      const bytes = await response.arrayBuffer();
      const rate = wavSampleRate(new Uint8Array(bytes));
      const context = rate ? new Context({ sampleRate: rate }) : new Context();
      try {
        const decoded = await context.decodeAudioData(bytes);
        const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
          decoded.getChannelData(index),
        );
        const kept = removeRange(channels, decoded.sampleRate, selection.start, selection.end);
        await onTrim(encodeWav(kept, decoded.sampleRate));
        setSelection(null);
      } finally {
        void context.close();
      }
    } catch (error) {
      setTrimError(error instanceof Error ? error.message : String(error));
    } finally {
      setTrimming(false);
    }
  }

  function seek(clientX: number) {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio || !duration) return;
    const rect = canvas.getBoundingClientRect();
    audio.currentTime = seekTime(clientX - rect.left, rect.width, duration);
  }

  return (
    <div ref={boxRef} className="space-y-1">
      {peaks?.length ? (
        <div
          role="slider"
          tabIndex={0}
          aria-label={`${S.activities.waveform}: ${label}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={`${clipTime(position)} / ${clipTime(duration)}`}
          onPointerDown={(event) => {
            if (onTrim) dragFrom.current = event.clientX;
          }}
          onPointerUp={(event) => {
            const from = dragFrom.current;
            dragFrom.current = null;
            const at = offset(event.clientX);
            const start = from === null ? null : offset(from);
            const range = at && start ? selectionFromDrag(start.x, at.x, at.width, duration) : null;
            if (range) setSelection(range);
            else seek(event.clientX);
          }}
          aria-description={onTrim ? S.activities.waveformTrim.keys : undefined}
          onKeyDown={(event) => {
            const audio = audioRef.current;
            if (!audio) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
              event.preventDefault();
              // Fine steps while trimming, where a tenth of a second matters.
              const step = onTrim && !event.shiftKey ? 0.1 : 1;
              audio.currentTime = Math.min(
                duration,
                Math.max(0, audio.currentTime + (event.key === "ArrowRight" ? step : -step)),
              );
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              audio.currentTime = event.key === "Home" ? 0 : duration;
            } else if (onTrim && event.key === "Enter") {
              event.preventDefault();
              if (mark === null) setMark(audio.currentTime);
              else {
                const range = selectionBetween(mark, audio.currentTime);
                if (range) setSelection(range);
                setMark(null);
              }
            } else if (onTrim && event.key === "Escape" && (selection || mark !== null)) {
              event.preventDefault();
              event.stopPropagation();
              setSelection(null);
              setMark(null);
            }
          }}
          className="w-full cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-gray-400/40"
        >
          <canvas
            ref={canvasRef}
            aria-hidden
            // The canvas reads its inks off itself, from properties it never draws with:
            // text for played, caret for the rest, border for a selection.
            className="block h-12 w-full border-brand-500 caret-gray-300 text-gray-900 dark:border-brand-300 dark:caret-gray-700 dark:text-gray-100"
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {!requested ? (
            <Button size="sm" onClick={() => setRequested(true)}>
              {S.activities.showWaveform}
            </Button>
          ) : failed ? (
            <p role="status" className="text-xs text-gray-500">
              {S.activities.waveformUnavailable}
            </p>
          ) : (
            <p role="status" className="text-xs text-gray-500">
              {S.activities.waveformLoading}
            </p>
          )}
        </div>
      )}
      <audio
        ref={audioRef}
        aria-label={label}
        controls
        preload="none"
        src={src}
        className="w-full"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && !duration) setDuration(value);
        }}
        onTimeUpdate={(event) => {
          // Playing a selection stops at its end, or it would run on into what is kept.
          if (stopAt.current !== null && event.currentTarget.currentTime >= stopAt.current) {
            stopAt.current = null;
            event.currentTarget.pause();
          }
          const skipping = skip.current;
          if (
            skipping &&
            event.currentTarget.currentTime >= skipping.start &&
            event.currentTarget.currentTime < skipping.end
          )
            event.currentTarget.currentTime = skipping.end;
          // Reduced motion keeps the picture still; the native player still reads out time.
          if (!reducedMotion) setPosition(event.currentTarget.currentTime);
          onTime?.(event.currentTarget.currentTime);
        }}
        onSeeked={(event) => {
          setPosition(event.currentTarget.currentTime);
          onTime?.(event.currentTarget.currentTime);
        }}
      />
      {duration > 0 && (
        <p className="text-xs text-gray-500">
          {clipTime(position)} / {clipTime(duration)}
        </p>
      )}
      {onTrim && peaks?.length ? (
        selection ? (
          <div className="flex flex-wrap items-center gap-2">
            <span aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
              {S.activities.waveformTrim.selected(
                clipTime(selection.start),
                clipTime(selection.end),
              )}
              {" · "}
              {S.activities.waveformTrim.remains(clipTime(remainingLength(duration, selection)))}
            </span>
            <Button size="sm" variant="ghost" onClick={playSelection} disabled={trimming}>
              {S.activities.waveformTrim.play}
            </Button>
            <Button size="sm" variant="ghost" onClick={playRemaining} disabled={trimming}>
              {S.activities.waveformTrim.playRemaining}
            </Button>
            <Button size="sm" onClick={() => void removeSelection()} disabled={trimming}>
              {trimming ? S.activities.waveformTrim.working : S.activities.waveformTrim.remove}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelection(null)}
              disabled={trimming}
            >
              {S.activities.waveformTrim.clear}
            </Button>
          </div>
        ) : mark !== null ? (
          <p aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
            {S.activities.waveformTrim.marked(clipTime(mark))}
          </p>
        ) : (
          <p className="text-xs text-gray-500">{S.activities.waveformTrim.hint}</p>
        )
      ) : null}
      {trimError && (
        <p role="alert" className={`text-xs ${toneInk.danger}`}>
          {S.activities.waveformTrim.failed(trimError)}
        </p>
      )}
    </div>
  );
}
