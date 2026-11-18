import workletUrl from "./pcm-worklet.js?url&no-inline";

const RATE = 16000;

function waveHeader(bytes: number): ArrayBuffer {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const chars = new Uint8Array(header);
  const text = new TextEncoder();
  chars.set(text.encode("RIFF"), 0);
  view.setUint32(4, 36 + bytes, true);
  chars.set(text.encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  chars.set(text.encode("data"), 36);
  view.setUint32(40, bytes, true);
  return header;
}

/** Capture PCM from the same microphone as the meter. A recorder's fragmented MP4 is not
 * independently decodable on all WebKit versions, even when that browser produced it. */
export async function capturePcm(
  stream: MediaStream,
  signal: AbortSignal,
  maxBytes: number,
  started: (stop: () => void, stream: MediaStream, context: AudioContext) => void,
): Promise<Blob> {
  const context = new AudioContext({ sampleRate: RATE });
  const close = () => {
    if (context.state !== "closed") return context.close().catch(() => {});
  };
  signal.addEventListener("abort", close, { once: true });
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: AudioWorkletNode | undefined;
  const stop = () => processor?.port.postMessage("stop");
  const track = stream.getAudioTracks()[0];
  try {
    await context.audioWorklet.addModule(workletUrl);
    signal.throwIfAborted();
    await context.resume();
    signal.throwIfAborted();
    source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "dictation-pcm", {
      channelCount: 1,
      channelCountMode: "explicit",
    });
    processor = node;
    const input = source;
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: ArrayBuffer[] = [];
      let bytes = 0;
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      const fail = () => {
        signal.removeEventListener("abort", abort);
        reject(new Error("recording_failed"));
      };
      node.onprocessorerror = fail;
      node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer | null>) => {
        if (data === null) {
          signal.removeEventListener("abort", abort);
          resolve(new Blob(bytes ? [waveHeader(bytes), ...chunks] : [], { type: "audio/wav" }));
        } else if ((bytes += data.byteLength) + 44 > maxBytes) {
          signal.removeEventListener("abort", abort);
          reject(new RangeError("audio_size"));
        } else {
          chunks.push(data);
        }
      };
      input.connect(node);
      node.connect(context.destination);
      track?.addEventListener("ended", stop);
      started(stop, stream, context);
    });
  } finally {
    signal.removeEventListener("abort", close);
    track?.removeEventListener("ended", stop);
    source?.disconnect();
    processor?.disconnect();
    processor?.port.close();
    await close();
  }
}
