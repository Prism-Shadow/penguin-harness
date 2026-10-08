import { createHash } from "node:crypto";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { HttpError } from "../http/errors.js";
import {
  DEFAULT_SPEECH_PROVIDER,
  ELEVENLABS_DEFAULT_MODEL,
  SPEECH_MODEL,
  isElevenLabsModel,
  isSpeechProvider,
  isVoiceOf,
  wordSpeechProvider,
} from "./voice-catalogue.js";
import type { SoundRequest } from "./sound-types.js";
import type { SpeechProviderId } from "./speech-types.js";
import type { GeneratedAudioFormat } from "./media.js";
import type { WordTiming } from "./word-timings.js";
import { isBookWord } from "./book-words.js";
import { KOKORO_VOICES, LOCAL_AUDIO_MODELS } from "./local-audio-models.js";

export interface AudioTarget {
  language: string;
  assetKey: string;
  /** The asset's script when the run started; accepting requires it unchanged. */
  script: string;
  /** The narration's voice. A sound run has none. */
  voice?: string;
  /**
   * The ElevenLabs voice the default voice resolved to when the run started: the Vault's
   * `ELEVENLABS_VOICE_ID`, else Loom's. The helper speaks with it and the clip records it.
   * Absent for any other voice.
   */
  voiceId?: string;
  /**
   * Who speaks the narration. Absent is Gemini, which every run before ElevenLabs speech
   * is; only an ElevenLabs run names it.
   */
  provider?: SpeechProviderId;
  /** Gemini's TTS model, or for ElevenLabs `eleven_v3`, `eleven_v4` or `eleven_multilingual_v2`. */
  model: string;
  /** Present on a music or sound-effect run: what its provider is asked for. */
  sound?: SoundRequest;
  /**
   * `direction` when the script tells the voice how to say something rather than being the
   * words to read: a word pronunciation spoken by Gemini, whose script asks for the word drawn
   * out and then said normally. Absent means the script is read aloud as written.
   */
  delivery?: "direction";
}
export interface AudioResult {
  runId: string;
  sha256: string;
  bytes: number;
  durationMs: number;
  mimeType: "audio/wav" | "audio/mpeg";
  /** Absent for WAV, which every Gemini speech run and every older record is. */
  format?: GeneratedAudioFormat;
  /**
   * When each spoken word starts and ends, checked against the script, from a provider that
   * returns them (ElevenLabs). Absent when the provider returns none.
   */
  wordTimings?: WordTiming[];
}
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export { SPEECH_MODEL, SPEECH_VOICES } from "./voice-catalogue.js";

/** The file a speech run writes, per provider: Gemini's WAV, ElevenLabs' MP3. */
export const SPEECH_OUTPUT_FILES: Readonly<Record<SpeechProviderId, string>> = {
  gemini: "speech.wav",
  elevenlabs: "speech.mp3",
  kokoro: "speech.wav",
};

/** Word timings a speech helper writes beside its clip when the provider returns them. */
export const SPEECH_TIMINGS_FILE = "speech-timings.json";

/**
 * The model a narration is spoken with when its run names none: Gemini's and Kokoro's only
 * model, or for ElevenLabs the narration's saved model, else the default.
 */
export function speechModelFor(
  provider: SpeechProviderId,
  asset: { speechModel?: string },
): string {
  if (provider === "gemini") return SPEECH_MODEL;
  if (provider === "kokoro") return LOCAL_AUDIO_MODELS.kokoro.model;
  return asset.speechModel ?? ELEVENLABS_DEFAULT_MODEL;
}

/**
 * What a speech run for one narration asks for. The provider is the one the request names,
 * else the narration's own `speechProvider`, else Gemini; the voice must be one that provider
 * speaks with.
 */
export function audioTarget(
  activity: ActivityDetail,
  input: { language: string; assetKey: string; voice: string; provider?: string; model?: string },
): AudioTarget {
  const plan = activity.draft.mediaPlan;
  if (
    activity.draft.status !== "valid" ||
    !plan ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before generating speech.");
  const asset = plan.manifest.assets[input.language]?.find((item) => item.key === input.assetKey);
  if (!asset || asset.type !== "audio" || !asset.script?.trim() || asset.script.length > 5000)
    throw new HttpError(
      422,
      "audio_invalid",
      "Select an audio asset with a saved script of 1–5000 characters.",
    );
  const provider =
    input.provider ??
    asset.speechProvider ??
    (isBookWord(asset) ? wordSpeechProvider(asset) : DEFAULT_SPEECH_PROVIDER);
  if (!isSpeechProvider(provider))
    throw new HttpError(400, "speech_provider_unknown", "Choose Gemini, ElevenLabs or Kokoro.");
  if (!isVoiceOf(provider, input.voice))
    throw new HttpError(422, "audio_invalid", "Select a supported speech voice.");
  if (provider === "kokoro") {
    const voice = KOKORO_VOICES.find((entry) => entry.id === input.voice)!;
    if (!voice.languages.includes(input.language))
      throw new HttpError(
        422,
        "audio_invalid",
        "Choose a Kokoro voice for this narration's language.",
      );
    if (isBookWord(asset) && !asset.customScript)
      throw new HttpError(
        422,
        "audio_invalid",
        "Kokoro reads text literally. Write a custom pronunciation script before recording this word.",
      );
    if (input.model !== undefined && input.model !== LOCAL_AUDIO_MODELS.kokoro.model)
      throw new HttpError(400, "speech_model_unknown", "Choose a model this provider offers.");
    return {
      language: input.language,
      assetKey: input.assetKey,
      script: asset.script,
      voice: input.voice,
      provider,
      model: LOCAL_AUDIO_MODELS.kokoro.model,
    };
  }
  if (provider === "gemini") {
    if (input.model !== undefined && input.model !== SPEECH_MODEL)
      throw new HttpError(400, "speech_model_unknown", "Choose a model this provider offers.");
    return {
      language: input.language,
      assetKey: input.assetKey,
      script: asset.script,
      voice: input.voice,
      model: SPEECH_MODEL,
      ...(isBookWord(asset) && !asset.customScript ? { delivery: "direction" as const } : {}),
    };
  }
  // The request's model, else the one the narration saved, else the default.
  const model = input.model ?? speechModelFor("elevenlabs", asset);
  if (!isElevenLabsModel(model))
    throw new HttpError(400, "speech_model_unknown", "Choose a model this provider offers.");
  return {
    language: input.language,
    assetKey: input.assetKey,
    script: asset.script,
    voice: input.voice,
    provider,
    model,
  };
}

/**
 * Who speaks a run's narration; a record naming none is Gemini's, from before a run always
 * named its provider. A narration asset naming none is DEFAULT_SPEECH_PROVIDER's instead.
 */
export function speechProviderOf(target: Pick<AudioTarget, "provider">): SpeechProviderId {
  return target.provider ?? "gemini";
}

/** Accept one uncompressed mono speech format; never trust a model's filename or MIME label. */
export function inspectWave(bytes: Uint8Array, runId: string): AudioResult {
  const data = Buffer.from(bytes);
  if (
    data.length < 46 ||
    data.length > AUDIO_MAX_BYTES ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE" ||
    data.readUInt32LE(4) !== data.length - 8
  )
    throw new Error("Audio output must be a bounded PCM WAV file.");
  let format = false;
  let samples = 0;
  let offset = 12;
  for (; offset + 8 <= data.length;) {
    const size = data.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    if (end > data.length) throw new Error("Truncated WAV output.");
    const kind = data.toString("ascii", offset, offset + 4);
    if (kind === "fmt ") {
      if (
        format ||
        size < 16 ||
        data.readUInt16LE(offset + 8) !== 1 ||
        data.readUInt16LE(offset + 10) !== 1 ||
        data.readUInt32LE(offset + 12) !== 24000 ||
        data.readUInt32LE(offset + 16) !== 48000 ||
        data.readUInt16LE(offset + 20) !== 2 ||
        data.readUInt16LE(offset + 22) !== 16
      )
        throw new Error("Speech WAV must be mono 24 kHz, 16-bit PCM.");
      format = true;
    }
    if (kind === "data") {
      if (samples || size < 2 || size % 2) throw new Error("Invalid WAV samples.");
      samples = size;
    }
    offset = end + (size % 2);
    if (offset > data.length) throw new Error("Truncated WAV padding.");
  }
  if (offset !== data.length || !format || !samples)
    throw new Error("Speech WAV is missing its format or samples.");
  return {
    runId,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
    durationMs: samples / 48,
    mimeType: "audio/wav",
  };
}
