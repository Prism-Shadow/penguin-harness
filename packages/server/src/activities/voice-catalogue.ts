/**
 * The voices Penguin speaks narration with, described for the App's voice picker. Kept free
 * of Node-only imports so the Web App's type graph can re-export `VoiceOption` from here.
 *
 * Two providers speak: Gemini, with its five named voices, and ElevenLabs, whose voices are
 * ids. ElevenLabs' library is not listed over the network (a listing is an API call, and
 * only an explicit generation may make one); its voices are the agent's Vault
 * `ELEVENLABS_VOICE_ID`, offered as "ElevenLabs default", and any id an author types.
 */
import type { SpeechProviderId } from "./speech-types.js";

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

/** The providers that speak narration; an asset naming none is spoken by Gemini. */
export const SPEECH_PROVIDER_IDS: readonly SpeechProviderId[] = ["gemini", "elevenlabs"];

export function isSpeechProvider(value: unknown): value is SpeechProviderId {
  return typeof value === "string" && (SPEECH_PROVIDER_IDS as readonly string[]).includes(value);
}

/** ElevenLabs' speech models; v3 reads audio tags and IPA, and is the default. */
export const ELEVENLABS_SPEECH_MODELS = ["eleven_v3", "eleven_multilingual_v2"] as const;
export type ElevenLabsSpeechModel = (typeof ELEVENLABS_SPEECH_MODELS)[number];
export const ELEVENLABS_DEFAULT_MODEL: ElevenLabsSpeechModel = "eleven_v3";

export function isElevenLabsModel(value: unknown): value is ElevenLabsSpeechModel {
  return (
    typeof value === "string" && (ELEVENLABS_SPEECH_MODELS as readonly string[]).includes(value)
  );
}

/** The Vault key holding the agent's default ElevenLabs voice id. */
export const ELEVENLABS_VOICE_KEY = "ELEVENLABS_VOICE_ID";

/**
 * The voice id that stands for the agent's Vault `ELEVENLABS_VOICE_ID`. The server never
 * reads the value; the speech helper does, from its own environment.
 */
export const ELEVENLABS_DEFAULT_VOICE = "elevenlabs-default";

/** An ElevenLabs voice id as an author may type it. */
export function isElevenLabsVoiceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{10,40}$/.test(value);
}

/** True for a voice `provider` can speak with. */
export function isVoiceOf(provider: SpeechProviderId, value: unknown): value is string {
  return provider === "elevenlabs"
    ? value === ELEVENLABS_DEFAULT_VOICE || isElevenLabsVoiceId(value)
    : isSpeechVoice(value);
}

/** The Vault default ElevenLabs voice, as the picker lists it. */
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
 * Every voice the picker offers an agent whose Vault holds `vaultKeys`: Gemini's, and the
 * ElevenLabs default when the Vault names one. Null keys (no agent chosen) list Gemini's.
 */
export function speechCatalogue(vaultKeys: readonly string[] | null): VoiceOption[] {
  return [
    ...SPEECH_CATALOGUE,
    ...(vaultKeys?.includes(ELEVENLABS_VOICE_KEY) ? [ELEVENLABS_DEFAULT_OPTION] : []),
  ];
}
