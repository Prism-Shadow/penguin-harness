/**
 * The music and sound-effect models reached through the model hub (`@prismshadow/agenthub`),
 * which the "agenthub" sound provider offers.
 *
 * Empty on purpose: agenthub 0.4.15, the version a sound run's helper installs, carries
 * Gemini text, image and speech models and no music or sound-effect model. Until it does,
 * the provider is listed as unavailable ("no_model") rather than hidden or faked.
 *
 * Adding a model later is one entry here plus raising `AGENTHUB_VERSION` to the release
 * that carries it (at least the entry's `minAgenthub`; an entry newer than the pinned
 * version is not offered). The helper, staging and collection already handle it.
 */
import { Component, Interface } from "@prismshadow/penguin-core/kernel";
import type { SoundFormat, SoundKind } from "./sound-types.js";

/** The agenthub release a media run's helper installs. */
export const AGENTHUB_VERSION = "0.4.15";

export interface AgenthubSoundModel {
  /** The model id `AutoLLMClient({ model })` takes. */
  id: string;
  kinds: readonly SoundKind[];
  /** The Vault key `AutoLLMClient` reads for this model's provider, e.g. GEMINI_API_KEY. */
  credential: string;
  /** What the model returns; PCM is wrapped as WAV by the helper. */
  format: SoundFormat;
  /** The first agenthub release that carries the model. */
  minAgenthub: string;
}

export const AGENTHUB_SOUND_MODELS: readonly AgenthubSoundModel[] = [];

/**
 * Where the sound seam reads the hub's catalogue. Absent, the list above; a test stands in a
 * catalogue with entries to prove that one entry is all a hub model needs.
 */
export abstract class SoundModelPorts extends Interface<{
  agenthubModels?: readonly AgenthubSoundModel[];
}>() {}

@Component()
export class DefaultSoundModelPorts implements SoundModelPorts {}
