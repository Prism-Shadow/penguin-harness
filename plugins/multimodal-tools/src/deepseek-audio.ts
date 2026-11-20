/**
 * What DeepSeek's speech recognition takes: 16-bit PCM WAV or Ogg Opus, checked from the bytes
 * before a provider is called (a browser records WebM, which DeepSeek refuses after the upload).
 * Its MMSP client also wraps raw signed little-endian PCM with a stated sample rate in a WAV header.
 */
import { ToolError } from "./errors.js";
import type { Attachment } from "./operations.js";

/** MMSP's client for DeepSeek's speech recognition, on DeepSeek's own endpoint and on TokenDance's. */
export const DEEPSEEK_TRANSCRIPTION_CLIENT = "deepseek-transcription";

function wave(bytes: Buffer): boolean {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  )
    return false;
  let format = false;
  let samples = false;
  for (let i = 12; i + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(i + 4);
    const start = i + 8;
    if (start + size > bytes.length) return false;
    const chunk = bytes.toString("ascii", i, i + 4);
    if (
      chunk === "fmt " &&
      size >= 16 &&
      bytes.readUInt16LE(start + 2) > 0 &&
      bytes.readUInt32LE(start + 4) > 0 &&
      bytes.readUInt16LE(start + 14) === 16
    )
      format =
        bytes.readUInt16LE(start) === 1 ||
        (size >= 40 &&
          bytes.readUInt16LE(start) === 0xfffe &&
          bytes.toString("hex", start + 24, start + 40) === "0100000000001000800000aa00389b71");
    if (chunk === "data" && size > 0) samples = true;
    i = start + size + (size % 2);
  }
  return format && samples;
}

function oggOpus(bytes: Buffer): boolean {
  if (bytes.length < 28 || bytes.toString("ascii", 0, 4) !== "OggS" || bytes[4] !== 0) return false;
  const segments = bytes[26]!;
  const firstPacket = 27 + segments;
  return (
    segments > 0 &&
    bytes[27]! >= 19 &&
    firstPacket + 19 <= bytes.length &&
    bytes.toString("ascii", firstPacket, firstPacket + 8) === "OpusHead"
  );
}

/** Throws a 415 unless the recording is one DeepSeek's speech recognition takes. */
export function requireDeepSeekAudio(audio: Attachment): void {
  const [mime, ...parameters] = audio.mimeType
    .toLowerCase()
    .split(";")
    .map((part) => part.trim());
  const bytes = Buffer.from(audio.data);
  if (["audio/wav", "audio/wave", "audio/x-wav"].includes(mime!) && wave(bytes)) return;
  if (mime === "audio/ogg" && oggOpus(bytes)) return;
  if (mime === "audio/l16" || mime === "audio/pcm") {
    const fields = Object.fromEntries(
      parameters.map((part) => part.split("=").map((s) => s.trim())),
    );
    const rate = Number(fields.rate);
    const channels = Number(fields.channels ?? 1);
    if (
      Number.isSafeInteger(rate) &&
      rate > 0 &&
      Number.isSafeInteger(channels) &&
      channels > 0 &&
      channels <= 0x7fff &&
      rate * channels * 2 <= 0xffffffff &&
      bytes.length &&
      bytes.length % (channels * 2) === 0
    )
      return;
  }
  throw new ToolError(
    415,
    "unsupported_transcription_audio",
    "DeepSeek ASR accepts 16-bit PCM WAV or Ogg Opus. Convert the recording to one of these formats.",
  );
}
