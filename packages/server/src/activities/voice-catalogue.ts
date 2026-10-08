/**
 * The voices Penguin speaks narration with, described for the App's voice picker. Kept free
 * of Node-only imports so the Web App's type graph can re-export `VoiceOption` from here.
 *
 * Three providers speak: Gemini, with its five named voices, Kokoro on the server, and
 * ElevenLabs, whose voices are ids. ElevenLabs' voices are its default (the Media Agent's Vault
 * `ELEVENLABS_VOICE_ID`, else Loom's narration voice), the account's library as
 * elevenlabs-voices.ts lists it, and any id an author types.
 */
import type { SpeechProviderId } from "./speech-types.js";
import { KOKORO_VOICES, LOCAL_AUDIO_MODELS } from "./local-audio-models.js";

export const SPEECH_MODEL = "gemini-3.1-flash-tts-preview";
export const SPEECH_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];

/** One voice an author can choose for a narration. */
export interface VoiceOption {
  id: string;
  label: string;
  /** The provider's display name. */
  provider: string;
  /** Which provider speaks with it; absent (from an older server) is Gemini. */
  providerId?: SpeechProviderId;
  model: string;
  /** Language codes the voice speaks; empty means every language. */
  languages: string[];
  /** A sample to listen to, when the provider publishes one. */
  previewUrl: string | null;
  /** The provider's published style word for the voice. */
  description?: string;
  /** For the ElevenLabs default: the name of the voice it stands for, when the library has it. */
  voiceName?: string;
}

const STYLES: Record<SpeechVoice, string> = {
  Kore: "Firm",
  Puck: "Upbeat",
  Charon: "Informative",
  Fenrir: "Excitable",
  Aoede: "Breezy",
};

export const SPEECH_CATALOGUE: readonly VoiceOption[] = SPEECH_VOICES.map((id) => ({
  id,
  label: id,
  provider: "Gemini",
  providerId: "gemini" as const,
  model: SPEECH_MODEL,
  languages: [],
  previewUrl: null,
  description: STYLES[id],
}));

/** True for a voice Penguin can speak with. */
export function isSpeechVoice(value: unknown): value is SpeechVoice {
  return typeof value === "string" && (SPEECH_VOICES as readonly string[]).includes(value);
}

/** The providers that speak narration. */
export const SPEECH_PROVIDER_IDS: readonly SpeechProviderId[] = ["gemini", "elevenlabs", "kokoro"];

/**
 * Who speaks a narration that names no provider, as Loom does. A run record naming none is
 * still Gemini's (`speechProviderOf`): runs made before ElevenLabs became the default.
 */
export const DEFAULT_SPEECH_PROVIDER: SpeechProviderId = "elevenlabs";

/**
 * Who speaks a decodable book's word: the provider it names, else ElevenLabs like a narration.
 * A word naming none whose bound recording was generated is the exception: that take predates
 * providers, so it is Gemini's, and reading it as ElevenLabs' would rewrite its script and
 * unbind the recording. Re-recording it with a provider chosen moves it over.
 */
export function wordSpeechProvider(asset: {
  speechProvider?: SpeechProviderId;
  generatedAudio?: unknown;
}): SpeechProviderId {
  return asset.speechProvider ?? (asset.generatedAudio ? "gemini" : DEFAULT_SPEECH_PROVIDER);
}

export function isSpeechProvider(value: unknown): value is SpeechProviderId {
  return typeof value === "string" && (SPEECH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** ElevenLabs' speech models; v3 reads audio tags and IPA, and is the default. */
export const ELEVENLABS_SPEECH_MODELS = [
  "eleven_v3",
  "eleven_v4",
  "eleven_multilingual_v2",
] as const;
export type ElevenLabsSpeechModel = (typeof ELEVENLABS_SPEECH_MODELS)[number];
export const ELEVENLABS_DEFAULT_MODEL: ElevenLabsSpeechModel = "eleven_v3";

export function isElevenLabsModel(value: unknown): value is ElevenLabsSpeechModel {
  return (
    typeof value === "string" && (ELEVENLABS_SPEECH_MODELS as readonly string[]).includes(value)
  );
}

/** The Vault key that may name a different default ElevenLabs voice. */
export const ELEVENLABS_VOICE_KEY = "ELEVENLABS_VOICE_ID";

/**
 * The default ElevenLabs narration voice when the Vault names none: Loom's
 * (`ELEVENLABS_VOICE_ID` in waf-loom's backend/config/app.yaml).
 */
export const ELEVENLABS_BUILTIN_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

/**
 * The voice id that stands for the default ElevenLabs voice. The server resolves it when a run
 * starts (elevenLabsDefaultVoiceId) and the clip records what it resolved to.
 */
export const ELEVENLABS_DEFAULT_VOICE = "elevenlabs-default";

/** An ElevenLabs voice id as an author may type it. */
export function isElevenLabsVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{10,40}$/.test(value);
}

/**
 * The voice the default ElevenLabs voice speaks with, Loom's way: the Vault's
 * `ELEVENLABS_VOICE_ID` when it names a voice, else ELEVENLABS_BUILTIN_VOICE_ID.
 */
export function elevenLabsDefaultVoiceId(configured: string | undefined): string {
  const value = configured?.trim();
  return isElevenLabsVoiceId(value) ? value : ELEVENLABS_BUILTIN_VOICE_ID;
}

/** True for a voice `provider` can speak with. */
export function isVoiceOf(provider: SpeechProviderId, value: unknown): value is string {
  if (provider === "kokoro") return KOKORO_VOICES.some((voice) => voice.id === value);
  return provider === "elevenlabs"
    ? value === ELEVENLABS_DEFAULT_VOICE || isElevenLabsVoiceId(value)
    : isSpeechVoice(value);
}

/** The default ElevenLabs voice, as the picker lists it before the library names it. */
export const ELEVENLABS_DEFAULT_OPTION: VoiceOption = {
  id: ELEVENLABS_DEFAULT_VOICE,
  label: "ElevenLabs default",
  provider: "ElevenLabs",
  providerId: "elevenlabs",
  model: ELEVENLABS_DEFAULT_MODEL,
  languages: [],
  previewUrl: null,
};

/**
 * Every voice the picker offers without asking ElevenLabs: Gemini's, Kokoro's and the
 * ElevenLabs default, which always has a voice to stand for. `elevenLabs`, when given, is the
 * account's library with the default first (elevenlabs-voices.ts) and replaces the bare default.
 */
export function speechCatalogue(elevenLabs: readonly VoiceOption[] = []): VoiceOption[] {
  return [
    ...SPEECH_CATALOGUE,
    ...KOKORO_VOICES.map((voice) => ({
      ...voice,
      provider: "Kokoro",
      providerId: "kokoro" as const,
      model: LOCAL_AUDIO_MODELS.kokoro.model,
      previewUrl: null,
    })),
    ...(elevenLabs.length ? elevenLabs : [ELEVENLABS_DEFAULT_OPTION]),
  ];
}
