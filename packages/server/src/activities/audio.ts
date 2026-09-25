import { createHash } from "node:crypto";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { HttpError } from "../http/errors.js";
import {
  ELEVENLABS_DEFAULT_MODEL,
  SPEECH_MODEL,
  isElevenLabsModel,
  isSpeechProvider,
  isVoiceOf,
} from "./voice-catalogue.js";
import type { SoundRequest } from "./sound-types.js";
import type { SpeechProviderId } from "./speech-types.js";
import type { GeneratedAudioFormat } from "./media.js";
import type { WordTiming } from "./word-timings.js";

export interface AudioTarget {
  language: string;
  assetKey: string;
  /** The asset's script when the run started; accepting requires it unchanged. */
  script: string;
  /** The narration's voice. A sound run has none. */
  voice?: string;
  /**
   * Who speaks the narration. Absent is Gemini, which every run before ElevenLabs speech
   * is; only an ElevenLabs run names it.
   */
  provider?: SpeechProviderId;
  /** Gemini's TTS model, or for ElevenLabs `eleven_v3` or `eleven_multilingual_v2`. */
  model: string;
  /** Present on a music or sound-effect run: what its provider is asked for. */
  sound?: SoundRequest;
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
};

/** Word timings a speech helper writes beside its clip when the provider returns them. */
export const SPEECH_TIMINGS_FILE = "speech-timings.json";

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
  const provider = input.provider ?? asset.speechProvider ?? "gemini";
  if (!isSpeechProvider(provider))
    throw new HttpError(400, "speech_provider_unknown", "Choose Gemini or ElevenLabs.");
  if (!isVoiceOf(provider, input.voice))
    throw new HttpError(422, "audio_invalid", "Select a supported speech voice.");
  if (provider === "gemini") {
    if (input.model !== undefined && input.model !== SPEECH_MODEL)
      throw new HttpError(400, "speech_model_unknown", "Choose a model this provider offers.");
    return {
      language: input.language,
      assetKey: input.assetKey,
      script: asset.script,
      voice: input.voice,
      model: SPEECH_MODEL,
    };
  }
  const model = input.model ?? ELEVENLABS_DEFAULT_MODEL;
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

/** Who speaks a run's narration; a record naming none is Gemini's. */
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

export const audioPrompt = `Generate the single speech candidate specified in speech-input.json.
The supplied generate-speech.mjs helper calls the configured speech provider through AgentHub and reads GEMINI_API_KEY only from the Agent Vault-injected process environment.
Use normal Harness exec_command approval for npm install --ignore-scripts and node generate-speech.mjs. Do not print credentials or read them into your context. Do not edit the supplied helper, package.json or input files. Do not delegate or write outside this workspace.
Run the helper once. It writes speech.wav. Never synthesize fake tones or substitute another provider, model, voice or script. If credentials, installation or the provider fail, report the failure and stop; do not retry a billable provider request automatically.
Finish only after the helper succeeds. The user will listen and explicitly accept the candidate; do not edit activity drafts or replace accepted media.`;

/** What a speech run's Session is told; Gemini's is `audioPrompt`, unchanged. */
export function speechPrompt(target: Pick<AudioTarget, "provider">): string {
  if (speechProviderOf(target) === "gemini") return audioPrompt;
  return `Generate the single speech candidate specified in speech-input.json.
The supplied generate-speech.mjs helper calls ElevenLabs with Node's built-in fetch and reads ELEVENLABS_API_KEY (and ELEVENLABS_VOICE_ID for the default voice) only from the Agent Vault-injected process environment. Nothing needs installing.
Use normal Harness exec_command approval for node generate-speech.mjs. Do not print credentials or read them into your context. Do not edit the supplied helper, package.json or input files. Do not delegate or write outside this workspace.
Run the helper once. It writes speech.mp3 and speech-timings.json. Never synthesize fake tones or substitute another provider, model, voice or script. If credentials or the provider fail, report the failure and stop; do not retry a billable provider request automatically.
Finish only after the helper succeeds. The user will listen and explicitly accept the candidate; do not edit activity drafts or replace accepted media.`;
}
