/**
 * The sound editor's derivations, kept apart from the view so they can be tested without a
 * DOM: a music or sound-effect asset's prompt (its script, or the words inside a Loom
 * `<audio …>` tag), its requested length in seconds, and the providers it can be made with.
 */
import type {
  ActivityRunSummary,
  SoundKind,
  SoundProviderId,
  SoundProviderStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

export const SOUND_PROMPT_MAX = 2000;
const MIN_SECONDS = 1;
const MAX_SECONDS = 60;

const TAG = /^(\s*<audio\b[^>]*>)([\s\S]*)(<\/audio>\s*)$/i;

/**
 * The prompt a script holds, as typed: the tag body when it is wrapped in Loom's tag, else the
 * script. The server trims it before asking a provider.
 */
export function soundPromptOf(script: string | undefined): string {
  if (!script) return "";
  const tag = TAG.exec(script);
  return tag ? tag[2]! : script;
}

/**
 * The script with its prompt replaced, keeping a Loom tag (and its playback and duration
 * attributes) around it when there was one.
 */
export function withSoundPrompt(script: string | undefined, prompt: string): string {
  const tag = script ? TAG.exec(script) : null;
  return tag ? `${tag[1]}${prompt}${tag[3]}` : prompt;
}

/** A requested length as the Length field shows it, in seconds. */
export function lengthText(targetDurationMs: number | undefined): string {
  if (targetDurationMs === undefined) return "";
  return String(Math.round(targetDurationMs / 100) / 10);
}

/**
 * What the Length field holds: empty lets the model choose, 1 to 60 seconds is a request,
 * anything else is not saved.
 */
export function parseLength(text: string): { ok: true; ms: number | undefined } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, ms: undefined };
  const seconds = Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS)
    return { ok: false };
  return { ok: true, ms: Math.round(seconds * 1000) };
}

export interface SoundModelOption {
  id: string;
  /** Why this model cannot make the sound now, worded; null when it can. */
  problem: string | null;
}

export interface SoundProviderOption {
  id: SoundProviderId;
  label: string;
  /** Why this provider cannot make this asset now, worded; null when it can. */
  problem: string | null;
  /**
   * The models it offers for this kind when it offers a choice (the model hub); empty for a
   * provider with one fixed model.
   */
  models: SoundModelOption[];
}

export function providerLabel(id: string): string {
  return id === "elevenlabs" || id === "agenthub" ? S.activities.sound.providers[id] : id;
}

function problemText(status: SoundProviderStatus, kind: SoundKind): string | null {
  const problems = S.activities.sound.problems;
  if (!status.kinds.includes(kind)) return problems.kind_unsupported;
  if (status.modelChoices) {
    // A provider with a choice of models: usable for this kind when one of its models makes
    // the kind and the agent holds that model's key.
    const choices = status.modelChoices.filter((choice) => choice.kinds.includes(kind));
    if (!choices.length) return problems.no_model;
    return choices.some((choice) => choice.available)
      ? null
      : problems.credential_missing(choices[0]!.credential);
  }
  if (status.available) return null;
  switch (status.problem) {
    case "credential_missing":
      return problems.credential_missing(status.credential);
    case "kind_unsupported":
      return problems.kind_unsupported;
    case "no_model":
      return problems.no_model;
    case "model_unknown":
      return problems.model_unknown;
    default:
      return problems.provider_unknown;
  }
}

/** The picker's options for one kind of sound, unavailable ones carrying their reason. */
export function providerOptions(
  providers: readonly SoundProviderStatus[],
  kind: SoundKind,
): SoundProviderOption[] {
  return providers.map((provider) => ({
    id: provider.id,
    label: providerLabel(provider.id),
    problem: problemText(provider, kind),
    models: (provider.modelChoices ?? [])
      .filter((choice) => choice.kinds.includes(kind))
      .map((choice) => ({
        id: choice.id,
        problem: choice.available
          ? null
          : S.activities.sound.problems.credential_missing(choice.credential),
      })),
  }));
}

/**
 * The provider to show chosen: the author's choice while it is offered, else the first that
 * can make the sound (ElevenLabs when its key is present), else the first listed so its
 * problem is on screen.
 */
export function chosenProvider(
  options: readonly SoundProviderOption[],
  choice: string | null,
): SoundProviderOption | null {
  return (
    options.find((option) => option.id === choice) ??
    options.find((option) => option.problem === null) ??
    options[0] ??
    null
  );
}

/**
 * The model to ask a provider with a choice for: the author's choice while it can make the
 * sound, else the first that can. Null for a provider with one fixed model, or when none can.
 */
export function chosenModel(
  provider: SoundProviderOption | null,
  choice: string | null,
): SoundModelOption | null {
  const usable = (provider?.models ?? []).filter((model) => model.problem === null);
  return usable.find((model) => model.id === choice) ?? usable[0] ?? null;
}

/** Whether a sound can be asked for: a usable provider and a prompt of the right size. */
export function canGenerateSound(
  prompt: string,
  provider: SoundProviderOption | null,
  lengthOk: boolean,
): boolean {
  const trimmed = prompt.trim();
  return (
    !!provider &&
    provider.problem === null &&
    lengthOk &&
    trimmed.length > 0 &&
    trimmed.length <= SOUND_PROMPT_MAX
  );
}

/** How a sound candidate is described in its list: provider and requested length. */
export function soundCandidateLabel(run: ActivityRunSummary): string {
  const sound = run.audio?.sound;
  if (!sound) return run.audio?.voice ?? "";
  return S.activities.sound.candidate(
    providerLabel(sound.provider),
    sound.targetDurationMs !== undefined ? lengthText(sound.targetDurationMs) : null,
  );
}

/** A failed sound run's reason, worded when the provider refused the plan or key. */
export function soundFailure(error: string | null | undefined): string | null {
  if (!error) return null;
  return /provider refused/i.test(error) ? S.activities.sound.refused : error;
}
