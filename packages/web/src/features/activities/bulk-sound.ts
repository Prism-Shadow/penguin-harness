/**
 * Which music and sound effects one language still needs, and which of them the sounds stage
 * would generate now. Pure, so the count on the button and the work the stage does come from
 * the same rule the server's `soundTargets` applies: an unbound asset with a playback kind and
 * a prompt of 1 to 2 000 characters.
 */
import type {
  ActivityRunSummary,
  AssetManifest,
  SoundKind,
  SoundProviderId,
  SoundProviderStatus,
} from "@prismshadow/penguin-server/api";
import { SOUND_PROMPT_MAX, soundPromptOf } from "./sound-model";

type MediaAsset = AssetManifest["assets"][string][number];

export type SoundState = "ready" | "missing" | "failed" | "generating" | "noPrompt";

export interface SoundStatus {
  key: string;
  state: SoundState;
  /** Why the last attempt failed, when it did. */
  error?: string;
}

const UNSUCCESSFUL = new Set<ActivityRunSummary["status"]>(["failed", "conflict", "interrupted"]);

/** Whether a prompt could be sent to a sound provider as it stands. */
function promptUsable(asset: MediaAsset): boolean {
  const prompt = soundPromptOf(asset.script).trim();
  return !!prompt && prompt.length <= SOUND_PROMPT_MAX;
}

/**
 * Every music and sound-effect asset in one language, with whether it is bound, waiting, being
 * made, failed on its latest run, or has no prompt to make it from. A bound asset is ready
 * however it was bound: generated, uploaded or from the checkout.
 */
export function soundStatuses(
  assets: readonly MediaAsset[],
  runs: readonly ActivityRunSummary[] = [],
  language = "",
): SoundStatus[] {
  const latest = new Map<string, ActivityRunSummary>();
  for (const run of runs) {
    if (run.kind !== "audio" || !run.audio?.sound || run.audio.language !== language) continue;
    const seen = latest.get(run.audio.assetKey);
    if (!seen || run.createdAt > seen.createdAt) latest.set(run.audio.assetKey, run);
  }
  return assets
    .filter((asset) => asset.type === "audio" && !!asset.kind)
    .map((asset): SoundStatus => {
      if (asset.path) return { key: asset.key, state: "ready" };
      if (!promptUsable(asset)) return { key: asset.key, state: "noPrompt" };
      const run = latest.get(asset.key);
      if (run?.status === "running") return { key: asset.key, state: "generating" };
      if (run && UNSUCCESSFUL.has(run.status))
        return { key: asset.key, state: "failed", ...(run.error ? { error: run.error } : {}) };
      return { key: asset.key, state: "missing" };
    });
}

export interface SoundTally {
  total: number;
  ready: number;
  /** What the sounds stage would generate now: missing, or failed and worth another try. */
  pending: number;
  failed: number;
  generating: number;
  noPrompt: number;
}

export function soundTally(
  assets: readonly MediaAsset[],
  runs: readonly ActivityRunSummary[] = [],
  language = "",
): SoundTally {
  const statuses = soundStatuses(assets, runs, language);
  const count = (state: SoundState) => statuses.filter((status) => status.state === state).length;
  return {
    total: statuses.length,
    ready: count("ready"),
    pending: count("missing") + count("failed"),
    failed: count("failed"),
    generating: count("generating"),
    noPrompt: count("noPrompt"),
  };
}

/**
 * The kinds of the sounds the stage would generate now in one language, so the provider it
 * uses can be one that makes them.
 */
export function pendingSoundKinds(
  assets: readonly MediaAsset[],
  runs: readonly ActivityRunSummary[] = [],
  language = "",
): SoundKind[] {
  const pending = new Set(
    soundStatuses(assets, runs, language)
      .filter((status) => status.state === "missing" || status.state === "failed")
      .map((status) => status.key),
  );
  const kinds = new Set<SoundKind>();
  for (const asset of assets)
    if (asset.type === "audio" && asset.kind && pending.has(asset.key)) kinds.add(asset.kind);
  return [...kinds];
}

/**
 * Whether a provider can make `kind` now: a hub model that serves the kind and whose key the
 * agent holds, or a fixed provider that is usable and makes the kind. The server's sounds
 * step applies the same rule and leaves out what the provider cannot make.
 */
function servesKind(provider: SoundProviderStatus, kind: SoundKind): boolean {
  if (provider.modelChoices)
    return provider.modelChoices.some((choice) => choice.available && choice.kinds.includes(kind));
  return provider.available && provider.kinds.includes(kind);
}

/**
 * The provider the sounds stage uses from the Audios section: the first the chosen agent can
 * use for every kind still needed (ElevenLabs when its key is present), else the first that
 * makes at least one of them, else ElevenLabs, so the stage names what is missing rather
 * than quietly picking something else.
 */
export function bulkSoundProvider(
  providers: readonly SoundProviderStatus[] | null,
  kinds: readonly SoundKind[] = [],
): {
  id: SoundProviderId;
  available: boolean;
} {
  const usable = (providers ?? []).filter((provider) => provider.available);
  const served = (provider: SoundProviderStatus) =>
    kinds.filter((kind) => servesKind(provider, kind)).length;
  const chosen =
    usable.find((provider) => served(provider) === kinds.length) ??
    usable.find((provider) => served(provider) > 0);
  if (chosen) return { id: chosen.id, available: true };
  return { id: "elevenlabs", available: false };
}
