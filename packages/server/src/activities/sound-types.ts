/**
 * Types the App reads for music and sound effects made from a prompt. Type-only, so the web
 * type graph can import them without the server modules that do the work.
 */

/** An asset's playback kind, which is also what a sound provider is asked for. */
export type SoundKind = "music" | "sfx";

/** Where a sound is made: ElevenLabs directly, or a model reached through the model hub. */
export type SoundProviderId = "elevenlabs" | "agenthub";

/**
 * Why a provider cannot make a sound right now. The App words each one. `no_model`: the
 * model hub offers no music or sound model in this version; `model_unknown`: the model asked
 * for is not one the provider offers for that kind.
 */
export type SoundProblem =
  "provider_unknown" | "credential_missing" | "kind_unsupported" | "no_model" | "model_unknown";

/** The file format a sound model returns, and so the candidate the run keeps. */
export type SoundFormat = "wav" | "mp3";

/** What one sound run asks its provider for. */
export interface SoundRequest {
  provider: SoundProviderId;
  model: string;
  kind: SoundKind;
  prompt: string;
  targetDurationMs?: number;
  /**
   * A model reached through the model hub: the Vault key its provider reads and the format
   * it returns. Absent for ElevenLabs, whose helper branch names both itself.
   */
  credential?: string;
  format?: SoundFormat;
}

/** One model the model hub offers for sound, as the editor's Model picker shows it. */
export interface SoundModelChoice {
  id: string;
  kinds: SoundKind[];
  /** The Vault key this model's provider needs. */
  credential: string;
  available: boolean;
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
  /**
   * Every model the provider offers, when it offers a choice (the model hub). Empty while the
   * hub has no sound model; absent for a provider with one fixed model per kind.
   */
  modelChoices?: SoundModelChoice[];
}

/** `GET /sound-setup`. */
export interface SoundSetup {
  providers: SoundProviderStatus[];
}
