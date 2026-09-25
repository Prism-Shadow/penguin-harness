/**
 * Types the App reads for music and sound effects made from a prompt. Type-only, so the web
 * type graph can import them without the server modules that do the work.
 */

/** An asset's playback kind, which is also what a sound provider is asked for. */
export type SoundKind = "music" | "sfx";

/** Where a sound is made: ElevenLabs directly, or a model reached through the model hub. */
export type SoundProviderId = "elevenlabs" | "agenthub";

/** Why a provider cannot make a sound right now. The App words each one. */
export type SoundProblem = "provider_unknown" | "credential_missing" | "kind_unsupported";

/** What one sound run asks its provider for. */
export interface SoundRequest {
  provider: SoundProviderId;
  model: string;
  kind: SoundKind;
  prompt: string;
  targetDurationMs?: number;
}

/** One provider as the editor's picker shows it, for the chosen agent. */
export interface SoundProviderStatus {
  id: SoundProviderId;
  kinds: SoundKind[];
  /** The Vault key the provider needs. */
  credential: string;
  /** The model used for each kind it makes. */
  models: Partial<Record<SoundKind, string>>;
  available: boolean;
  problem?: SoundProblem;
}

/** `GET /sound-setup`. */
export interface SoundSetup {
  providers: SoundProviderStatus[];
}
