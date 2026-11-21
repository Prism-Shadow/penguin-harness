/**
 * The live readings behind a `MicrophoneMeter`: a short history of input levels from a recording
 * stream, the seconds since it started, and whether a level can be read at all.
 *
 * The analyser only reads the stream the recorder already holds. It is never connected to a
 * speaker, which would feed the microphone back into itself. A recorder that opened its own
 * `AudioContext` (a PCM capture) passes it in and the meter samples through it; otherwise the
 * hook opens one and closes it again when the stream goes.
 *
 * Levels are in dBFS mapped onto 0–100: the useful range for speech is roughly −54 to −6 dBFS,
 * and a linear amplitude would leave a clearly audible speaker barely moving the bars. Under
 * reduced motion (the system's, or the page's `data-motion="reduced"`) the history is sampled
 * slowly and the meter shows words instead of moving bars.
 */
import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../../../motion/use-reduced-motion";

/** How many readings the meter keeps; one bar each. */
export const METER_BARS = 18;

const SILENT: readonly number[] = Array<number>(METER_BARS).fill(0);

export interface MicrophoneLevels {
  /** The most recent readings, oldest first, each 0–100. */
  levels: readonly number[];
  /** Whole seconds since the stream started. */
  seconds: number;
  /** A level can be read: the analyser opened and its context is running. */
  available: boolean;
  /** The meter should show words rather than moving bars. */
  reduceMotion: boolean;
}

export function useMicrophoneLevels(stream: MediaStream, context?: AudioContext): MicrophoneLevels {
  const [levels, setLevels] = useState<readonly number[]>(SILENT);
  const [available, setAvailable] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const reduceMotion =
    usePrefersReducedMotion() ||
    (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced");
  useEffect(() => {
    const start = performance.now();
    const clock = window.setInterval(
      () => setSeconds(Math.floor((performance.now() - start) / 1000)),
      250,
    );
    return () => window.clearInterval(clock);
  }, [stream]);
  useEffect(() => {
    if (typeof AudioContext === "undefined") return;
    let audio: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    let poll: number | undefined;
    try {
      audio = context ?? new AudioContext();
      source = audio.createMediaStreamSource(stream);
      analyser = audio.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const meter = analyser;
      const running = audio;
      void audio.resume().catch(() => {});
      const sample = () => {
        if (running.state !== "running") {
          setAvailable(false);
          return;
        }
        setAvailable(true);
        meter.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) energy += value * value;
        const db = 10 * Math.log10(energy / samples.length);
        const level = Math.round(Math.max(0, Math.min(1, (db + 54) / 48)) * 100);
        setLevels((history) => [...history.slice(1), level]);
      };
      sample();
      poll = window.setInterval(sample, reduceMotion ? 350 : 75);
    } catch {
      // The recorder can still capture sound when this browser cannot open an analyser.
      setAvailable(false);
    }
    return () => {
      window.clearInterval(poll);
      source?.disconnect();
      analyser?.disconnect();
      if (!context && audio && audio.state !== "closed") void audio.close().catch(() => {});
    };
  }, [stream, context, reduceMotion]);
  return { levels, seconds, available, reduceMotion };
}
