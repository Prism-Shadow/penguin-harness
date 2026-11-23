import { capturePcm } from "./pcm-recording";

const MAX_BYTES = 20 * 1024 * 1024;
const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

/** The browser can run an audio worklet: the recording is then 16 kHz PCM WAV (pcm-recording.ts). */
function recordsPcm(): boolean {
  return typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined";
}

/** A lossy encoder can add noise to digital silence. Inspect overlapping windows of
 * the original channels. If sampling is unavailable or misses a window, keep the recording. */
function watchSilence(stream: MediaStream) {
  const tracks = stream.getAudioTracks();
  const channels = tracks[0]?.getSettings().channelCount;
  if (typeof AudioContext === "undefined" || tracks.length !== 1 || !channels) return;
  let context: AudioContext | undefined;
  try {
    const audio = new AudioContext();
    context = audio;
    const source = audio.createMediaStreamSource(stream);
    const split = audio.createChannelSplitter(channels);
    source.connect(split);
    const meters = Array.from({ length: channels }, (_, channel) => {
      const meter = audio.createAnalyser();
      meter.fftSize = 32768;
      split.connect(meter, channel);
      return meter;
    });
    const samples = new Float32Array(meters[0]!.fftSize);
    const windowMs = (samples.length * 1000) / audio.sampleRate;
    let lastRead = performance.now();
    let previousTime = audio.currentTime;
    let observed = false;
    let possible = audio.state === "running";
    // A suspended context cannot account for samples captured by the independent recorder.
    audio.onstatechange = () => {
      if (audio.state !== "running") possible = false;
    };
    const read = () => {
      if (!possible) {
        window.clearInterval(timer);
        return;
      }
      const now = performance.now();
      const time = audio.currentTime;
      if (
        audio.state !== "running" ||
        now - lastRead >= windowMs ||
        (time - previousTime) * 1000 >= windowMs
      ) {
        possible = false;
      } else {
        observed ||= time > previousTime;
        possible = meters.every((meter) => {
          meter.getFloatTimeDomainData(samples);
          return samples.every((value) => value === 0);
        });
      }
      lastRead = now;
      previousTime = time;
      if (!possible) window.clearInterval(timer);
    };
    const timer = window.setInterval(read, windowMs / 2);
    return {
      context: audio,
      silent: () => {
        read();
        return possible && observed;
      },
      close: () => {
        window.clearInterval(timer);
        void audio.close().catch(() => {});
      },
    };
  } catch {
    void context?.close().catch(() => {});
    return;
  }
}

/** This page can record speech at all: a microphone API and a way to encode what it hears. */
export function canRecordSpeech(): boolean {
  return (
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    (recordsPcm() || typeof MediaRecorder !== "undefined")
  );
}

/**
 * Records until `finish` is called and resolves with the recording. It is 16 kHz PCM WAV wherever
 * the browser runs an audio worklet — a format every speech recognizer takes, DeepSeek's (which
 * refuses WebM) included, so nothing depends on which model is bound — and the browser's own
 * MediaRecorder format elsewhere. Aborting always releases the tracks, a permission grant that
 * arrives late included.
 */
export async function captureSpeech(
  signal: AbortSignal,
  started: (finish: () => void, stream: MediaStream, context?: AudioContext) => void,
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  signal.addEventListener("abort", release, { once: true });
  let monitor: ReturnType<typeof watchSilence>;
  try {
    signal.throwIfAborted();
    if (recordsPcm()) return await capturePcm(stream, signal, MAX_BYTES, started);
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    monitor = watchSilence(stream);
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: BlobPart[] = [];
      let size = 0;
      const stop = () => {
        if (recorder.state !== "inactive") recorder.stop();
      };
      const abort = () => {
        stop();
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      const detach = () => signal.removeEventListener("abort", abort);
      recorder.ondataavailable = (e) => {
        size += e.data.size;
        if (size > MAX_BYTES) {
          stop();
          detach();
          reject(new RangeError("audio_size"));
          return;
        }
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onerror = () => {
        detach();
        stop();
        reject(new Error("recording_failed"));
      };
      recorder.onstop = () => {
        detach();
        resolve(
          new Blob(monitor?.silent() ? [] : chunks, {
            type: recorder.mimeType || mimeType || "audio/webm",
          }),
        );
      };
      try {
        recorder.start(1000);
        started(stop, stream, monitor?.context);
      } catch (e) {
        detach();
        reject(e);
      }
    });
  } finally {
    monitor?.close();
    signal.removeEventListener("abort", release);
    release();
  }
}
export async function recordingData(blob: Blob) {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data, mimeType: blob.type.split(";")[0]! };
}
