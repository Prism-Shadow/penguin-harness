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

export interface SoundProviderOption {
  id: SoundProviderId;
  label: string;
  /** Why this provider cannot make this asset now, worded; null when it can. */
  problem: string | null;
}

export function providerLabel(id: string): string {
  return id === "elevenlabs" || id === "agenthub" ? S.activities.sound.providers[id] : id;
}

/** The picker's options for one kind of sound, unavailable ones carrying their reason. */
export function providerOptions(
  providers: readonly SoundProviderStatus[],
  kind: SoundKind,
): SoundProviderOption[] {
  return providers.map((provider) => {
    const problems = S.activities.sound.problems;
    const problem = !provider.kinds.includes(kind)
      ? problems.kind_unsupported
      : provider.available
        ? null
        : provider.problem === "credential_missing"
          ? problems.credential_missing(provider.credential)
          : provider.problem === "kind_unsupported"
            ? problems.kind_unsupported
            : problems.provider_unknown;
    return { id: provider.id, label: providerLabel(provider.id), problem };
  });
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
