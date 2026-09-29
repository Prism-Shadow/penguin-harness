/**
 * Music and sound effects made from a prompt: which asset a sound run is for and what it
 * asks its provider, and the check an MP3 a provider returned must pass before it is kept.
 *
 * The prompt is the asset's script (the body of Loom's `<audio kind="music">…</audio>` tag
 * when it has one) and the length is the asset's `targetDurationMs`. Pure: no file or
 * network access.
 */
import { createHash } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { AUDIO_MAX_BYTES, inspectWave, type AudioResult, type AudioTarget } from "./audio.js";
import { soundProviderFor } from "./audio-providers.js";
import { soundPromptOf } from "./playback.js";
import type { GeneratedAudioFormat } from "./media.js";
import type { SoundFormat, SoundProviderId } from "./sound-types.js";
import type { AgenthubSoundModel } from "./sound-models.js";

export const SOUND_PROMPT_MAX = 2000;

/**
 * The file the helper writes, one per format, which collection reads. ElevenLabs always
 * writes MP3; a hub model writes MP3 or WAV, whichever its audio was.
 */
export const SOUND_OUTPUT_FILES: Readonly<Record<SoundFormat, string>> = {
  mp3: "sound.mp3",
  wav: "sound.wav",
};

/** A sound run's target: an audio target whose `sound` says what to ask for. */
export type SoundTarget = AudioTarget & { sound: NonNullable<AudioTarget["sound"]> };

/**
 * What a run for one music or sound-effect asset asks for. The asset must be audio with a
 * playback kind and a prompt of 1–2 000 characters, and the media plan must be current, as
 * for speech.
 */
export function soundTarget(
  activity: ActivityDetail,
  input: { language: string; assetKey: string; provider: string; model?: string },
  catalogue?: readonly AgenthubSoundModel[],
): SoundTarget {
  const plan = activity.draft.mediaPlan;
  if (
    activity.draft.status !== "valid" ||
    !plan ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before generating a sound.");
  const asset = plan.manifest.assets[input.language]?.find((item) => item.key === input.assetKey);
  const prompt = soundPromptOf(asset?.script);
  if (
    !asset ||
    asset.type !== "audio" ||
    !asset.kind ||
    !prompt ||
    prompt.length > SOUND_PROMPT_MAX
  )
    throw new HttpError(
      422,
      "sound_invalid",
      `Select a music or sound effect asset with a prompt of 1–${SOUND_PROMPT_MAX} characters.`,
    );
  const choice = soundProviderFor(asset.kind, input.provider, null, input.model, catalogue);
  const maxDuration =
    input.provider === "musicgen"
      ? 30000
      : ["audiogen", "audioldm"].includes(input.provider)
        ? 10000
        : Infinity;
  if ((asset.targetDurationMs ?? 10000) > maxDuration)
    throw new HttpError(
      422,
      "sound_invalid",
      `This provider supports clips up to ${maxDuration / 1000} seconds. Shorten the requested length.`,
    );
  if ("problem" in choice) {
    if (choice.problem === "provider_unknown")
      throw new HttpError(
        400,
        "sound_provider_unknown",
        "Choose a sound provider this build carries.",
      );
    if (choice.problem === "no_model")
      throw new HttpError(
        409,
        "sound_no_model",
        "No music or sound model is available through the model hub in this version.",
      );
    if (choice.problem === "model_unknown")
      throw new HttpError(400, "sound_model_unknown", "Choose a model this provider offers.");
    throw new HttpError(
      422,
      "sound_kind_unsupported",
      `That provider does not make ${asset.kind === "music" ? "music" : "sound effects"}.`,
    );
  }
  return {
    language: input.language,
    assetKey: input.assetKey,
    script: asset.script!,
    model: choice.model,
    sound: {
      provider: choice.provider as SoundProviderId,
      model: choice.model,
      kind: asset.kind,
      prompt,
      ...(asset.targetDurationMs !== undefined ? { targetDurationMs: asset.targetDurationMs } : {}),
      // A hub model names its key and format; ElevenLabs' helper branch knows its own.
      ...(choice.format ? { credential: choice.credential, format: choice.format } : {}),
    },
  };
}

const BITRATES_KBPS = {
  // MPEG-1 layers I, II, III.
  v1: [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ],
  // MPEG-2 and 2.5: layer I, then layers II and III.
  v2: [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ],
} as const;
const SAMPLE_RATES = {
  v1: [44100, 48000, 32000],
  v2: [22050, 24000, 16000],
  v25: [11025, 12000, 8000],
} as const;

/** One MPEG audio frame header at `offset`: its length in bytes and duration, or null. */
function frameAt(
  data: Buffer,
  offset: number,
): { length: number; samples: number; rate: number } | null {
  if (offset + 4 > data.length) return null;
  const b1 = data[offset + 1]!;
  const b2 = data[offset + 2]!;
  if (data[offset] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3; // 0: 2.5, 1: reserved, 2: 2, 3: 1
  const layerBits = (b1 >> 1) & 3; // 1: III, 2: II, 3: I, 0: reserved
  const bitrateIndex = b2 >> 4;
  const rateIndex = (b2 >> 2) & 3;
  if (
    version === 1 ||
    layerBits === 0 ||
    bitrateIndex === 0 ||
    bitrateIndex === 15 ||
    rateIndex === 3
  )
    return null;
  const layer = 4 - layerBits; // 1, 2 or 3
  const mpeg1 = version === 3;
  const kbps = (mpeg1 ? BITRATES_KBPS.v1 : BITRATES_KBPS.v2)[layer - 1]![bitrateIndex]!;
  const rate = (mpeg1 ? SAMPLE_RATES.v1 : version === 2 ? SAMPLE_RATES.v2 : SAMPLE_RATES.v25)[
    rateIndex
  ]!;
  const padding = (b2 >> 1) & 1;
  const bitrate = kbps * 1000;
  if (layer === 1)
    return { length: (Math.floor((12 * bitrate) / rate) + padding) * 4, samples: 384, rate };
  const perFrame = layer === 3 && !mpeg1 ? 576 : 1152;
  return {
    length: Math.floor(((perFrame / 8) * bitrate) / rate) + padding,
    samples: perFrame,
    rate,
  };
}

/**
 * Accept an MP3 a provider returned only if it is one: bounded, an optional ID3v2 tag, then
 * MPEG audio frames back to back (an ID3v1 tag may close it). Its length is the sum of its
 * frames'. A model's filename or MIME label is never trusted.
 */
export function inspectMp3(bytes: Uint8Array, runId: string): AudioResult & { format: "mp3" } {
  const data = Buffer.from(bytes);
  if (!data.length || data.length > AUDIO_MAX_BYTES)
    throw new Error("Sound output must be a bounded MP3 file.");
  let offset = 0;
  if (data.length >= 10 && data.toString("latin1", 0, 3) === "ID3") {
    const size =
      ((data[6]! & 0x7f) << 21) |
      ((data[7]! & 0x7f) << 14) |
      ((data[8]! & 0x7f) << 7) |
      (data[9]! & 0x7f);
    if ((data[6]! | data[7]! | data[8]! | data[9]!) & 0x80) throw new Error("Invalid ID3 tag.");
    offset = 10 + size + (data[5]! & 0x10 ? 10 : 0);
    if (offset >= data.length) throw new Error("The MP3 holds a tag and no audio.");
  }
  let frames = 0;
  let durationMs = 0;
  while (offset < data.length) {
    // An ID3v1 tag closes the file.
    if (data.length - offset === 128 && data.toString("latin1", offset, offset + 3) === "TAG")
      break;
    const frame = frameAt(data, offset);
    if (!frame) throw new Error("Sound output is not MPEG audio.");
    if (offset + frame.length > data.length) throw new Error("Truncated MP3 frame.");
    frames += 1;
    durationMs += (frame.samples * 1000) / frame.rate;
    offset += frame.length;
  }
  if (!frames) throw new Error("The MP3 holds no audio frames.");
  return {
    runId,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
    durationMs: Math.round(durationMs),
    mimeType: "audio/mpeg",
    format: "mp3",
  };
}

/** Check stored audio of either format a run can produce. */
export function inspectGeneratedAudio(
  bytes: Uint8Array,
  runId: string,
  format: GeneratedAudioFormat | undefined,
): AudioResult {
  return format === "mp3" ? inspectMp3(bytes, runId) : inspectWave(bytes, runId);
}

/** The Content-Type a stored clip is served with, read from its bytes. */
export function audioMimeType(bytes: Uint8Array): "audio/wav" | "audio/mpeg" {
  return Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF"
    ? "audio/wav"
    : "audio/mpeg";
}

export const soundPrompt = `Generate the single sound candidate specified in sound-input.json.
The supplied generate-sound.mjs helper calls the configured sound provider and reads its API key only from the Agent Vault-injected process environment. If package.json lists dependencies, install them first with npm install --ignore-scripts.
Use normal Harness exec_command approval for that install and for node generate-sound.mjs. Do not print credentials or read them into your context. Do not edit the supplied helper, package.json or input files. Do not delegate or write outside this workspace.
Run the helper once. It writes sound.mp3 or sound.wav. Do nothing else: never synthesize audio yourself or substitute another provider, model or prompt. If credentials or the provider fail, report the failure and stop; do not retry a billable provider request automatically.
Finish only after the helper succeeds. The user will listen and explicitly accept the candidate; do not edit activity drafts or replace accepted media.`;
