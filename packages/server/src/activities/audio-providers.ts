import type {
  SoundFormat,
  SoundKind,
  SoundProblem,
  SoundProviderId,
  SoundProviderStatus,
} from "./sound-types.js";
import type { SpeechProviderId, SpeechProviderStatus } from "./speech-types.js";
import { SPEECH_PROVIDER_IDS } from "./voice-catalogue.js";
import {
  LOCAL_AUDIO_MODELS,
  isLocalAudioProvider,
  type LocalAudioAvailability,
} from "./local-audio-models.js";
import {
  AGENTHUB_SOUND_MODELS,
  AGENTHUB_VERSION,
  type AgenthubSoundModel,
} from "./sound-models.js";

/**
 * Which audio a run can actually produce, and what to say when it cannot.
 *
 * Loom's audio stack has four kinds — speech, music, effects and forced alignment — each
 * with its own provider setting. Local models run in Penguin's native local-audio
 * capability. Availability includes the installed runtime and required model package.
 *
 * The part worth having now is honesty about capability. An activity that asks for effects
 * on a deployment with no effects provider must be told so, not handed silence. Every
 * asset this stage cannot produce is named, with the setting that would fix it.
 */

export type AudioKind =
  /** Narration and dialogue. */
  | "speech"
  /** Background music beds. */
  | "music"
  /** One-shot sound effects. */
  | "effect"
  /** Word timings for an existing clip. */
  | "alignment";

export const AUDIO_KINDS: readonly AudioKind[] = ["speech", "music", "effect", "alignment"];

/** A provider this port carries, with the credential it needs. */
export interface AudioProvider {
  id: string;
  kinds: readonly AudioKind[];
  /** Vault key that must be present for this provider to run. */
  credential: string;
  /** Whether this provider can return word timings alongside speech. */
  nativeTimings?: boolean;
}

export const AUDIO_PROVIDERS: readonly AudioProvider[] = [
  {
    id: "elevenlabs",
    kinds: ["speech", "music", "effect", "alignment"],
    credential: "ELEVENLABS_API_KEY",
    nativeTimings: true,
  },
  {
    id: "gemini",
    kinds: ["speech"],
    credential: "GEMINI_API_KEY",
  },
];

export interface AudioSetup {
  local?: LocalAudioAvailability;
  /** Vault keys that are present. */
  credentials: readonly string[];
  /** Per-kind provider choice, when one was configured. */
  chosen?: Partial<Record<AudioKind, string>>;
}

export type ProviderChoice =
  { kind: AudioKind; provider: AudioProvider } | { kind: AudioKind; problem: string };

/**
 * Whether one named provider can serve one kind with the keys present, as a code. Both the
 * worded capability report below and the sound seam decide through this, so they never
 * disagree about what a provider can do.
 */
function checkProvider(
  kind: AudioKind,
  id: string,
  have: ReadonlySet<string>,
):
  | { provider: AudioProvider }
  | { problem: "provider_unknown" }
  | { problem: "kind_unsupported" }
  | { problem: "credential_missing"; credential: string } {
  const provider = AUDIO_PROVIDERS.find((entry) => entry.id === id);
  if (!provider) return { problem: "provider_unknown" };
  if (!provider.kinds.includes(kind)) return { problem: "kind_unsupported" };
  if (!have.has(provider.credential))
    return { problem: "credential_missing", credential: provider.credential };
  return { provider };
}

/**
 * The provider that will serve one kind, or why none will.
 *
 * A configured choice is honoured strictly: asking for a provider this build does not carry
 * is an error rather than a silent fallback to another one. Substituting a different voice
 * because the configured one was unavailable is the kind of quiet success that produces an
 * activity nobody can explain.
 */
export function providerFor(kind: AudioKind, setup: AudioSetup): ProviderChoice {
  const have = new Set(setup.credentials);
  const wanted = setup.chosen?.[kind];

  if (wanted) {
    if (isLocalAudioProvider(wanted)) {
      const expected = wanted === "kokoro" ? "speech" : wanted === "musicgen" ? "music" : "effect";
      if (kind !== expected)
        return { kind, problem: `${kind}: "${wanted}" does not produce ${kind}.` };
      return setup.local?.[wanted]
        ? { kind, provider: { id: wanted, kinds: [kind], credential: "" } }
        : {
            kind,
            problem: `${kind}: install the ${LOCAL_AUDIO_MODELS[wanted].package} local runtime.`,
          };
    }
    const checked = checkProvider(kind, wanted, have);
    if ("provider" in checked) return { kind, provider: checked.provider };
    if (checked.problem === "provider_unknown")
      return { kind, problem: `${kind}: there is no provider called "${wanted}".` };
    if (checked.problem === "kind_unsupported")
      return { kind, problem: `${kind}: "${wanted}" does not produce ${kind}.` };
    return {
      kind,
      problem: `${kind}: "${wanted}" needs ${checked.credential} in the Agent's vault.`,
    };
  }

  const usable = AUDIO_PROVIDERS.filter(
    (entry) => entry.kinds.includes(kind) && have.has(entry.credential),
  );
  if (!usable.length) {
    const local =
      kind === "speech"
        ? "kokoro"
        : kind === "music"
          ? "musicgen"
          : kind === "effect"
            ? "audioldm"
            : null;
    if (local && setup.local?.[local])
      return { kind, provider: { id: local, kinds: [kind], credential: "" } };
    const candidates = AUDIO_PROVIDERS.filter((entry) => entry.kinds.includes(kind));
    return {
      kind,
      problem: candidates.length
        ? `${kind}: no provider is configured. Add ${candidates.map((entry) => entry.credential).join(" or ")} to the Agent's vault.`
        : `${kind}: this build carries no ${kind} provider.`,
    };
  }
  return { kind, provider: usable[0]! };
}

/** Which kinds can be produced right now, and why the others cannot. */
export function audioCapability(setup: AudioSetup): {
  available: AudioKind[];
  problems: string[];
} {
  const available: AudioKind[] = [];
  const problems: string[] = [];
  for (const kind of AUDIO_KINDS) {
    const choice = providerFor(kind, setup);
    if ("provider" in choice) available.push(kind);
    else problems.push(choice.problem);
  }
  return { available, problems };
}

/**
 * Whether a run can produce word timings for its narration.
 *
 * Separate from having a speech provider, because they are separate questions: a
 * deployment can speak without aligning, and a book activity needs to be told that before
 * it ships a read-along that does not read along.
 */
export function canAlign(setup: AudioSetup): boolean {
  return "provider" in providerFor("alignment", setup);
}

/** One line about what this deployment can do, with the gaps named. */
export function describeAudioCapability(setup: AudioSetup): string {
  const { available, problems } = audioCapability(setup);
  if (!problems.length) return "Speech, music, effects and word timings are all available.";
  if (!available.length) return `No audio can be produced. ${problems.join(" ")}`;
  return `Available: ${available.join(", ")}. ${problems.join(" ")}`;
}

/** The provider that speaks a narration, with the Vault key it reads. */
export type SpeechChoice = { provider: SpeechProviderId; credential: string; timings: boolean };

/**
 * Who speaks one narration, or why nobody can: its own `speechProvider`, Gemini when it names
 * none. The choice is honoured strictly, so a narration set to ElevenLabs on an agent
 * without `ELEVENLABS_API_KEY` is refused with that key's name rather than spoken by Gemini.
 * `vaultKeys` are the keys the chosen agent's Vault holds; null skips the key check.
 */
export function speechProviderFor(
  asset: { speechProvider?: string },
  vaultKeys: readonly string[] | null,
  local: LocalAudioAvailability = {},
):
  | SpeechChoice
  | { problem: "provider_unknown" }
  | {
      problem: "credential_missing" | "runtime_missing";
      credential: string;
    } {
  const id = asset.speechProvider ?? "gemini";
  if (id === "kokoro")
    return vaultKeys === null || local.kokoro
      ? { provider: "kokoro", credential: "", timings: false }
      : { problem: "runtime_missing", credential: "kokoro-js" };
  if (!(SPEECH_PROVIDER_IDS as readonly string[]).includes(id))
    return { problem: "provider_unknown" };
  const provider = AUDIO_PROVIDERS.find((entry) => entry.id === id)!;
  const checked = checkProvider("speech", id, new Set(vaultKeys ?? [provider.credential]));
  if ("problem" in checked)
    return checked.problem === "credential_missing"
      ? { problem: "credential_missing", credential: checked.credential }
      : { problem: "provider_unknown" };
  return {
    provider: id as SpeechProviderId,
    credential: checked.provider.credential,
    timings: !!checked.provider.nativeTimings,
  };
}

/** Every speech provider as the Provider picker shows it, for an agent holding `vaultKeys`. */
export function speechSetup(
  vaultKeys: readonly string[],
  local: LocalAudioAvailability = {},
): SpeechProviderStatus[] {
  return SPEECH_PROVIDER_IDS.map((id) => {
    if (id === "kokoro")
      return {
        id,
        credential: "",
        available: !!local.kokoro,
        timings: false,
        ...(!local.kokoro ? { problem: "runtime_missing" as const } : {}),
      };
    const provider = AUDIO_PROVIDERS.find((entry) => entry.id === id)!;
    const choice = speechProviderFor({ speechProvider: id }, vaultKeys);
    return {
      id,
      credential: provider.credential,
      available: "provider" in choice,
      ...("provider" in choice ? {} : { problem: "credential_missing" as const }),
      timings: !!provider.nativeTimings,
    };
  });
}

/**
 * Music and sound effects made from a prompt: the providers this build carries for them, the
 * model each uses per kind, and the Vault key it needs. An asset's `sfx` is this file's
 * `effect`.
 *
 * ElevenLabs has one fixed model per kind. The model hub ("agenthub") offers whatever
 * `AGENTHUB_SOUND_MODELS` lists, each with its own provider's key and output format; that
 * list is empty in this build, so the hub is reported as `no_model` rather than hidden or
 * quietly replaced by another provider.
 */
export interface SoundProvider {
  id: SoundProviderId;
  kinds: readonly SoundKind[];
  credential: string;
  models: Partial<Record<SoundKind, string>>;
}

export const SOUND_PROVIDERS: readonly SoundProvider[] = [
  {
    id: "elevenlabs",
    kinds: ["music", "sfx"],
    credential: "ELEVENLABS_API_KEY",
    models: { music: "music_v1", sfx: "sound-generation" },
  },
];

/** The kinds the model hub can be asked for; which models serve them is the catalogue's. */
const AGENTHUB_KINDS: readonly SoundKind[] = ["music", "sfx"];

const AUDIO_KIND_OF: Record<SoundKind, AudioKind> = { music: "music", sfx: "effect" };

/** Whether release `have` is at least `need`, both plain `major.minor.patch`. */
function atLeast(have: string, need: string): boolean {
  const a = have.split(".").map(Number);
  const b = need.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * The hub's models for one kind (or every kind) that the pinned agenthub release carries,
 * from `catalogue` (this build's, unless a caller passes the one its ports hold).
 */
export function agenthubSoundModels(
  kind?: SoundKind,
  catalogue: readonly AgenthubSoundModel[] = AGENTHUB_SOUND_MODELS,
): AgenthubSoundModel[] {
  return catalogue.filter(
    (model) =>
      (!kind || model.kinds.includes(kind)) &&
      AGENTHUB_KINDS.some((offered) => model.kinds.includes(offered)) &&
      atLeast(AGENTHUB_VERSION, model.minAgenthub),
  );
}

export type SoundChoice = {
  provider: SoundProviderId;
  model: string;
  /** Set for a hub model: the Vault key it reads and what it returns. ElevenLabs needs its
   * own key and always returns MP3. */
  credential?: string;
  format?: SoundFormat;
};

/**
 * The provider and model that will make one sound, or why they cannot. `model` picks one of
 * the provider's models (the first that makes the kind when absent). `vaultKeys` are the
 * keys the chosen agent's Vault holds; null skips the key check (an asset is being checked,
 * not a run started).
 */
export function soundProviderFor(
  kind: SoundKind,
  provider: string,
  vaultKeys: readonly string[] | null,
  model?: string,
  catalogue: readonly AgenthubSoundModel[] = AGENTHUB_SOUND_MODELS,
  local: LocalAudioAvailability = {},
): SoundChoice | { problem: SoundProblem; credential?: string } {
  if (isLocalAudioProvider(provider) && provider !== "kokoro") {
    if (kind !== (provider === "musicgen" ? "music" : "sfx"))
      return { problem: "kind_unsupported" };
    if (model !== undefined && model !== LOCAL_AUDIO_MODELS[provider].model)
      return { problem: "model_unknown" };
    if (vaultKeys !== null && !local[provider]) return { problem: "runtime_missing" };
    return { provider, model: LOCAL_AUDIO_MODELS[provider].model, format: "wav" };
  }
  if (provider === "agenthub") {
    const offered = agenthubSoundModels(kind, catalogue);
    if (!offered.length) return { problem: "no_model" };
    // With no model named, the first whose key the Vault holds, as setup reports it; the
    // first offered only names the missing key.
    const chosen =
      model === undefined
        ? (offered.find((entry) => !vaultKeys || vaultKeys.includes(entry.credential)) ??
          offered[0]!)
        : offered.find((entry) => entry.id === model);
    if (!chosen) return { problem: "model_unknown" };
    if (vaultKeys && !vaultKeys.includes(chosen.credential))
      return { problem: "credential_missing", credential: chosen.credential };
    return {
      provider: "agenthub",
      model: chosen.id,
      credential: chosen.credential,
      format: chosen.format,
    };
  }
  const sound = SOUND_PROVIDERS.find((entry) => entry.id === provider);
  if (!sound) return { problem: "provider_unknown" };
  const fixed = sound.models[kind];
  if (!sound.kinds.includes(kind) || !fixed) return { problem: "kind_unsupported" };
  if (model !== undefined && model !== fixed) return { problem: "model_unknown" };
  const checked = checkProvider(
    AUDIO_KIND_OF[kind],
    sound.id,
    new Set(vaultKeys ?? [sound.credential]),
  );
  if ("problem" in checked)
    return checked.problem === "credential_missing"
      ? { problem: "credential_missing", credential: checked.credential }
      : { problem: checked.problem };
  return { provider: sound.id, model: fixed };
}

/**
 * Whether a provider, as `soundSetup` reported it, can make `kind` now: a hub model that
 * serves the kind and whose key the agent holds, or a fixed provider that is usable and makes
 * the kind. A provider usable for one kind may still be unable to make the other.
 */
export function servesSoundKind(status: SoundProviderStatus, kind: SoundKind): boolean {
  if (status.modelChoices)
    return status.modelChoices.some((choice) => choice.available && choice.kinds.includes(kind));
  return status.available && status.kinds.includes(kind);
}

/** Every sound provider as the picker shows it, for an agent holding `vaultKeys`. */
export function soundSetup(
  vaultKeys: readonly string[],
  catalogue: readonly AgenthubSoundModel[] = AGENTHUB_SOUND_MODELS,
  local: LocalAudioAvailability = {},
): SoundProviderStatus[] {
  const fixed = SOUND_PROVIDERS.map((provider): SoundProviderStatus => {
    // A provider is usable when it can make at least one kind; the kinds it cannot make
    // are simply absent from its list.
    const problems = provider.kinds.map((kind) => soundProviderFor(kind, provider.id, vaultKeys));
    const usable = problems.some((choice) => "model" in choice);
    const problem = problems.find((choice) => "problem" in choice);
    return {
      id: provider.id,
      kinds: [...provider.kinds],
      credential: provider.credential,
      models: { ...provider.models },
      available: usable,
      ...(!usable && problem && "problem" in problem ? { problem: problem.problem } : {}),
    };
  });
  const offered = agenthubSoundModels(undefined, catalogue);
  const choices = offered.map((model) => ({
    id: model.id,
    kinds: AGENTHUB_KINDS.filter((kind) => model.kinds.includes(kind)),
    credential: model.credential,
    available: vaultKeys.includes(model.credential),
  }));
  const usable = choices.find((choice) => choice.available);
  const models: Partial<Record<SoundKind, string>> = {};
  for (const kind of AGENTHUB_KINDS) {
    // The model a run without a named model uses: the first usable one, else the first.
    const serving = offered.filter((model) => model.kinds.includes(kind));
    const first = serving.find((model) => vaultKeys.includes(model.credential)) ?? serving[0];
    if (first) models[kind] = first.id;
  }
  const hub: SoundProviderStatus = {
    id: "agenthub",
    // What the hub can be asked for; which kinds a model serves is in `modelChoices`.
    kinds: [...AGENTHUB_KINDS],
    // The key the picker names: the first usable model's, else the first model's.
    credential: (usable ?? choices[0])?.credential ?? "",
    models,
    available: !!usable,
    ...(!choices.length
      ? { problem: "no_model" as const }
      : usable
        ? {}
        : { problem: "credential_missing" as const }),
    modelChoices: choices,
  };
  return [
    ...fixed,
    hub,
    ...(["musicgen", "audiogen", "audioldm"] as const).map((id): SoundProviderStatus => ({
      id,
      kinds: [id === "musicgen" ? "music" : "sfx"],
      credential: "",
      models: { [id === "musicgen" ? "music" : "sfx"]: LOCAL_AUDIO_MODELS[id].model },
      available: !!local[id],
      ...(!local[id] ? { problem: "runtime_missing" as const } : {}),
    })),
  ];
}
