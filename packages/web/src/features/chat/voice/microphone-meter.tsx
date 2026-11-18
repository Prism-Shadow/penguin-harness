import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";

const BARS = 18;
const silent = Array<number>(BARS).fill(0);

/** A short history of microphone levels. The analyser only reads from the stream used by
 * the recorder; connecting it to a speaker would feed the microphone back into itself. */
export function MicrophoneMeter({
  stream,
  context: captureContext,
}: {
  stream: MediaStream;
  context?: AudioContext;
}) {
  const [levels, setLevels] = useState(silent);
  const [available, setAvailable] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const reduceMotion =
    usePrefersReducedMotion() || document.documentElement.dataset.motion === "reduced";
  useEffect(() => {
    const start = performance.now();
    const clock = window.setInterval(
      () => setSeconds(Math.floor((performance.now() - start) / 1000)),
      250,
    );
    return () => window.clearInterval(clock);
  }, []);
  useEffect(() => {
    if (typeof AudioContext === "undefined") return;
    let audio: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let poll: number | undefined;
    try {
      audio = captureContext ?? new AudioContext();
      source = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter = analyser;
      const context = audio;
      void audio.resume().catch(() => {});
      const sample = () => {
        if (context.state !== "running") {
          setAvailable(false);
          return;
        }
        setAvailable(true);
        meter.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) energy += value * value;
        // The useful speech range is roughly -54 to -6 dBFS. Linear amplitude would make
        // a clearly audible speaker barely move the bars.
        const db = 10 * Math.log10(energy / samples.length);
        const level = Math.round(Math.max(0, Math.min(1, (db + 54) / 48)) * 100);
        setLevels((history) => [...history.slice(1), level]);
      };
      sample();
      poll = window.setInterval(sample, reduceMotion ? 350 : 75);
    } catch {
      // The recorder can still capture sound if this browser cannot open an analyser.
      setAvailable(false);
    }
    return () => {
      window.clearInterval(poll);
      source?.disconnect();
      analyser?.disconnect();
      if (!captureContext && audio && audio.state !== "closed") void audio.close().catch(() => {});
    };
  }, [stream, reduceMotion, captureContext]);
  const current = levels.at(-1) ?? 0;
  return (
    <div className="inline-flex min-w-0 items-center justify-center gap-1.5 overflow-hidden px-1">
      <span aria-hidden className="hidden shrink-0 text-xs tabular-nums text-fg-muted @md:inline">
        {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
      </span>
      {available ? (
        <div
          role="meter"
          aria-label={S.voice.inputLevel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={current}
          aria-valuetext={current > 0 ? S.voice.soundDetected : S.voice.quiet}
          className={`flex h-5 min-w-0 items-center justify-center text-tone-success-fg ${reduceMotion ? "w-auto" : "w-10 @md:w-14"}`}
        >
          {reduceMotion ? (
            <span className="truncate text-xs text-fg-muted">
              {current > 0 ? S.voice.soundDetected : S.voice.quiet}
            </span>
          ) : (
            <svg aria-hidden viewBox="0 0 90 28" className="block h-5 w-full" fill="currentColor">
              {levels.map((value, index) => {
                const height = 3 + (value / 100) * 23;
                return (
                  <rect
                    key={index}
                    x={5 * index + 1}
                    y={(28 - height) / 2}
                    width={3}
                    height={height}
                    rx={1.5}
                  />
                );
              })}
            </svg>
          )}
        </div>
      ) : (
        <span className="truncate text-xs text-fg-muted">{S.voice.recording}</span>
      )}
    </div>
  );
}
