/**
 * What a generated file is stored and handed back as: a file extension for its MIME type, and raw
 * PCM speech wrapped as a WAV file a player opens.
 */

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** The bare MIME type, lower case: `audio/L16; rate=24000` → `audio/l16`. */
export function bareType(mimeType: string): string {
  return mimeType.split(";")[0]!.trim().toLowerCase();
}

/** The extension a file of this type is saved with, or undefined for a type this plugin does not store. */
export function extensionOf(mimeType: string): string | undefined {
  return EXTENSIONS[bareType(mimeType)];
}

/** A generated file: its bytes and type, and its length in seconds when that is known from PCM. */
export interface Media {
  data: Uint8Array;
  mimeType: string;
  seconds?: number;
}

/**
 * Raw 16-bit little-endian PCM (`audio/L16`, `audio/pcm`, as Gemini and DeepSeek return speech)
 * as a WAV file; anything else unchanged. Null for PCM whose stated format the bytes contradict.
 */
export function playable(media: Media): Media | null {
  const { mimeType, data } = media;
  if (!/^audio\/(?:l16|pcm)(?:\s*;|$)/i.test(mimeType)) return media;
  const statedRate = /(?:^|;)\s*rate\s*=\s*(\d+)/i.exec(mimeType)?.[1];
  const rate = Number(statedRate ?? 24000);
  const channels = Number(/(?:^|;)\s*channels\s*=\s*(\d+)/i.exec(mimeType)?.[1] ?? 1);
  if (rate < 1 || rate > 384000 || channels < 1 || channels > 16) return null;
  if (data.byteLength === 0 || data.byteLength % (channels * 2) !== 0) return null;
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(data.byteLength + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.byteLength, 40);
  return {
    mimeType: "audio/wav",
    data: Buffer.concat([header, data]),
    ...(statedRate !== undefined ? { seconds: data.byteLength / (channels * 2 * rate) } : {}),
  };
}

/** The MIME type of a local file the terminal sent, by its extension; undefined when unknown. */
export function typeByName(name: string): string | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "wav":
      return "audio/wav";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
    case "mp4":
      return "audio/mp4";
    case "ogg":
    case "opus":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "aac":
      return "audio/aac";
    case "webm":
      return "audio/webm";
    default:
      return undefined;
  }
}
