/**
 * Types the App reads for narration spoken through a provider. Type-only, so the web type
 * graph can import them without the server modules that do the work.
 */
import type { VoiceOption } from "./voice-catalogue.js";

/** Who speaks a narration. An asset or run naming none is spoken by Gemini. */
export type SpeechProviderId = "gemini" | "elevenlabs" | "kokoro";

/** Why a provider cannot speak for the chosen agent now. The App words it. */
export type SpeechProblem = "credential_missing" | "runtime_missing";

/** One speech provider as the editor's Provider picker shows it, for the chosen agent. */
export interface SpeechProviderStatus {
  id: SpeechProviderId;
  /** The Vault key the provider needs. */
  credential: string;
  available: boolean;
  problem?: SpeechProblem;
  /** Whether a recording comes back with word timings, so read-along highlighting works. */
  timings: boolean;
}

/** `GET /speech-setup`; `providers` is present when an agent was named. */
export interface SpeechSetup {
  provider: string;
  model: string;
  voices: readonly string[];
  catalogue: VoiceOption[];
  vaultKey: string;
  providers?: SpeechProviderStatus[];
}
