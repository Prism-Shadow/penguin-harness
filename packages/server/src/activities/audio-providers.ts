import type {
  SoundKind,
  SoundProblem,
  SoundProviderId,
  SoundProviderStatus,
} from "./sound-types.js";

/**
 * Which audio a run can actually produce, and what to say when it cannot.
 *
 * Loom's audio stack has four kinds — speech, music, effects and forced alignment — each
 * with its own provider setting. Half its providers are local Python models (Kokoro,
 * MusicGen, AudioGen, AudioLDM) which this port deliberately leaves behind; the interface
 * stays open so a sidecar could add them later.
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

/**
 * Providers Loom has that this port does not carry.
 *
 * Kept as data rather than dropped silently: when someone asks why music generation is not
 * available, the answer should name what Loom used and why it is absent, not leave them
 * reading a diff.
 */
export const LEFT_BEHIND: readonly { id: string; kinds: readonly AudioKind[]; why: string }[] = [
  { id: "kokoro", kinds: ["speech"], why: "a local Python model with no TypeScript equivalent" },
  { id: "musicgen", kinds: ["music"], why: "a local Python model with no TypeScript equivalent" },
  { id: "audiogen", kinds: ["effect"], why: "a local Python model with no TypeScript equivalent" },
  { id: "audioldm", kinds: ["effect"], why: "a local Python model with no TypeScript equivalent" },
];

export interface AudioSetup {
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
    const left = LEFT_BEHIND.find((entry) => entry.id === wanted);
    if (left)
      return {
        kind,
        problem: `${kind}: this build does not carry "${wanted}" — ${left.why}. Configure one of ${
          AUDIO_PROVIDERS.filter((p) => p.kinds.includes(kind))
            .map((p) => p.id)
            .join(", ") || "none"
        }.`,
      };
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

/**
 * Music and sound effects made from a prompt: the providers this build carries for them, the
 * model each uses per kind, and the Vault key it needs. An asset's `sfx` is this file's
 * `effect`.
 *
 * Only ElevenLabs is listed. A model reached through the model hub is a provider id the
 * seam knows, but this build has no such model, so asking for it is `provider_unknown`
 * rather than a quiet substitution.
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

const AUDIO_KIND_OF: Record<SoundKind, AudioKind> = { music: "music", sfx: "effect" };

/**
 * The provider and model that will make one sound, or why they cannot. `vaultKeys` are the
 * keys the chosen agent's Vault holds; null skips the key check (an asset is being checked,
 * not a run started).
 */
export function soundProviderFor(
  kind: SoundKind,
  provider: string,
  vaultKeys: readonly string[] | null,
): { provider: SoundProviderId; model: string } | { problem: SoundProblem; credential?: string } {
  const sound = SOUND_PROVIDERS.find((entry) => entry.id === provider);
  if (!sound) return { problem: "provider_unknown" };
  const model = sound.models[kind];
  if (!sound.kinds.includes(kind) || !model) return { problem: "kind_unsupported" };
  const checked = checkProvider(
    AUDIO_KIND_OF[kind],
    sound.id,
    new Set(vaultKeys ?? [sound.credential]),
  );
  if ("problem" in checked)
    return checked.problem === "credential_missing"
      ? { problem: "credential_missing", credential: checked.credential }
      : { problem: checked.problem };
  return { provider: sound.id, model };
}

/** Every sound provider as the picker shows it, for an agent holding `vaultKeys`. */
export function soundSetup(vaultKeys: readonly string[]): SoundProviderStatus[] {
  return SOUND_PROVIDERS.map((provider) => {
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
}
