import { capturePcm } from "./pcm-recording";

const MAX_BYTES = 20 * 1024 * 1024;
const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

/** Resolves when the recorder stops. Aborting always releases tracks, including a permission grant that arrives late. */
export async function captureSpeech(
  signal: AbortSignal,
  started: (finish: () => void, stream: MediaStream, context?: AudioContext) => void,
  format?: "audio/wav",
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  signal.addEventListener("abort", release, { once: true });
  try {
    signal.throwIfAborted();
    if (format === "audio/wav") return await capturePcm(stream, signal, MAX_BYTES, started);
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
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
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
      };
      try {
        recorder.start(1000);
        started(stop, stream);
      } catch (e) {
        detach();
        reject(e);
      }
    });
  } finally {
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
