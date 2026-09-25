/**
 * The voices Penguin speaks narration with, described for the App's voice picker. Kept free
 * of Node-only imports so the Web App's type graph can re-export `VoiceOption` from here.
 */

export const SPEECH_MODEL = "gemini-3.1-flash-tts-preview";
export const SPEECH_VOICES = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"] as const;
export type SpeechVoice = (typeof SPEECH_VOICES)[number];

/** One voice an author can choose for a narration. */
export interface VoiceOption {
  id: string;
  label: string;
  provider: string;
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
  model: SPEECH_MODEL,
  languages: [],
  previewUrl: null,
  description: STYLES[id],
}));

/** True for a voice Penguin can speak with. */
export function isSpeechVoice(value: unknown): value is SpeechVoice {
  return typeof value === "string" && (SPEECH_VOICES as readonly string[]).includes(value);
}
