const MAX_BYTES = 20 * 1024 * 1024;
const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

/** Resolves when the recorder stops. Aborting always releases tracks, including a permission grant that arrives late. */
export async function captureSpeech(
  signal: AbortSignal,
  started: (finish: () => void, stream: MediaStream) => void,
): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  try {
    signal.throwIfAborted();
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
    release();
  }
}
/** Decode the recorder's WebM or MP4 at 16 kHz, then downmix to a single signed PCM channel. */
async function speechWave(recording: Blob, signal: AbortSignal): Promise<Blob> {
  const rate = 16000;
  const input = await recording.arrayBuffer();
  signal.throwIfAborted();
  const decoder = new OfflineAudioContext(1, 1, rate);
  const audio = await decoder.decodeAudioData(input).catch(() => {
    throw new Error("recording_failed");
  });
  signal.throwIfAborted();
  const bytes = audio.length * 2;
  if (bytes + 44 > MAX_BYTES) throw new RangeError("audio_size");
  const wave = new ArrayBuffer(44 + bytes);
  const view = new DataView(wave);
  view.setUint32(0, 0x52494646); // RIFF
  view.setUint32(4, 36 + bytes, true);
  view.setUint32(8, 0x57415645); // WAVE
  view.setUint32(12, 0x666d7420); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461); // data
  view.setUint32(40, bytes, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, n) =>
    audio.getChannelData(n),
  );
  for (let i = 0; i < audio.length; i++) {
    let value = 0;
    for (const channel of channels) value += channel[i]!;
    const sample = Math.max(-1, Math.min(1, value / channels.length));
    view.setInt16(44 + 2 * i, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([wave], { type: "audio/wav" });
}

export async function recordingData(
  recording: Blob,
  format: "audio/wav" | undefined,
  signal: AbortSignal,
) {
  const blob = format === "audio/wav" ? await speechWave(recording, signal) : recording;
  signal.throwIfAborted();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  return { data, mimeType: blob.type.split(";")[0]! };
}
