/**
 * The audio editor's derivations, kept apart from the view so they can be tested without a
 * DOM: which languages get a card and in what order, the one candidate each card compares
 * with its current audio, where that audio plays from, and what the card's primary action is.
 */
import type {
  ActivityRunSummary,
  AssetManifest,
  MediaAsset,
} from "@prismshadow/penguin-server/api";
import { isUploadPath } from "./media-library";

/** The ElevenLabs models a narration may be spoken with; the server's ELEVENLABS_SPEECH_MODELS. */
export const ELEVENLABS_MODELS = ["eleven_v3", "eleven_v4", "eleven_multilingual_v2"] as const;
export type ElevenLabsModel = (typeof ELEVENLABS_MODELS)[number];
export const ELEVENLABS_DEFAULT_MODEL: ElevenLabsModel = "eleven_v3";

/** The model an ElevenLabs narration is generated with next. */
export function speechModelOf(asset: Pick<MediaAsset, "speechModel">): ElevenLabsModel {
  return asset.speechModel ?? ELEVENLABS_DEFAULT_MODEL;
}

/**
 * The languages that have `key`, one card each: the default language first, then the rest in
 * code order, as the narration overview lists them.
 */
export function cardLanguages(
  manifest: AssetManifest,
  key: string,
  defaultLanguage: string,
): string[] {
  return Object.keys(manifest.assets)
    .filter((code) => manifest.assets[code]?.some((entry) => entry.key === key))
    .sort((a, b) => (a === defaultLanguage ? -1 : b === defaultLanguage ? 1 : a.localeCompare(b)));
}

/** A file the author uploaded or trimmed, held on the card until it is saved or replaced. */
export interface PendingAudio {
  source: "upload" | "trim";
  path: string;
  /** The uploaded file's own name; a trimmed clip has none worth showing. */
  name?: string;
}

/** What a card compares with its current audio, and what Save makes current. */
export type AudioCandidate =
  { source: "generated"; runId: string } | ({ source: "upload" | "trim" } & PendingAudio);

/**
 * The newest take that could replace the bound audio of one language: succeeded, with a file,
 * made from the current draft, not the one already bound, and not older than an upload bound
 * since (saving an upload over a take retires the take).
 */
export function newestTake(
  runs: readonly ActivityRunSummary[],
  language: string,
  key: string,
  revision: string,
  bound: { runId?: string; uploadedAt?: string },
): ActivityRunSummary | undefined {
  return [...runs]
    .filter(
      (run) =>
        run.kind === "audio" && run.audio?.language === language && run.audio?.assetKey === key,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .find(
      (run) =>
        run.status === "succeeded" &&
        run.hasCandidate &&
        run.inputRevision === revision &&
        run.runId !== bound.runId &&
        !(bound.uploadedAt && run.createdAt < bound.uploadedAt),
    );
}

/**
 * A card's one candidate. A pending upload or trim wins until it is saved or replaced:
 * generating clears it, so a newer take then shows instead.
 */
export function cardCandidate(
  take: ActivityRunSummary | undefined,
  pending: PendingAudio | null,
): AudioCandidate | null {
  if (pending) return { ...pending };
  return take ? { source: "generated", runId: take.runId } : null;
}

/** Whether a speech or sound run for this card is under way. */
export function cardGenerating(
  runs: readonly ActivityRunSummary[],
  language: string,
  key: string,
): boolean {
  return runs.some(
    (run) =>
      run.status === "running" &&
      run.kind === "audio" &&
      run.audio?.language === language &&
      run.audio?.assetKey === key,
  );
}

/**
 * The newest script suggestion for this card still worth showing: one under way, one with
 * text made from the current draft, or one that conflicted. Accepting one changes the draft,
 * which retires it.
 */
export function pendingText(
  runs: readonly ActivityRunSummary[],
  language: string,
  key: string,
  revision: string,
): ActivityRunSummary | undefined {
  const newest = [...runs]
    .filter(
      (run) =>
        run.kind === "media-text" &&
        run.mediaText?.language === language &&
        run.mediaText?.assetKey === key &&
        run.mediaText?.type === "audio",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!newest) return undefined;
  if (newest.status === "running") return newest;
  // A conflicted one stays readable (it can never be accepted), so the author sees why.
  return newest.hasCandidate &&
    ((newest.status === "succeeded" && newest.inputRevision === revision) ||
      newest.status === "conflict")
    ? newest
    : undefined;
}

/** Where a sandbox media path is served from: the draft's own media, then the checkout's. */
export function sandboxMediaUrl(endpoint: string, path: string): string {
  return `${endpoint}/sandbox/media/${path
    .slice("media/".length)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function uploadUrl(endpoint: string, path: string): string {
  return `${endpoint}/media-upload?path=${encodeURIComponent(path)}`;
}

export function runAudioUrl(endpoint: string, runId: string): string {
  return `${endpoint}/runs/${encodeURIComponent(runId)}/audio`;
}

/**
 * Where an asset's bound audio plays from: the accepted run, an upload, or sandbox media.
 * Null when nothing is bound, or when it is bound somewhere this page cannot play.
 */
export function boundAudioUrl(
  asset: Pick<MediaAsset, "path" | "generatedAudio">,
  endpoint: string,
): string | null {
  if (!asset.path) return null;
  if (asset.generatedAudio) return runAudioUrl(endpoint, asset.generatedAudio.runId);
  if (isUploadPath(asset.path)) return uploadUrl(endpoint, asset.path);
  if (asset.path.startsWith("media/")) return sandboxMediaUrl(endpoint, asset.path);
  return null;
}

export function candidateUrl(candidate: AudioCandidate, endpoint: string): string {
  return candidate.source === "generated"
    ? runAudioUrl(endpoint, candidate.runId)
    : uploadUrl(endpoint, candidate.path);
}

/** A stable identity for a candidate, to key its player by. */
export function candidateId(candidate: AudioCandidate): string {
  return candidate.source === "generated" ? candidate.runId : candidate.path;
}

/**
 * A card's primary action. A narration in another language with no script yet is translated
 * from the default language first; it cannot be until that language has a script.
 */
export type PrimaryAction =
  { action: "generate"; again: boolean } | { action: "translate" } | { action: "blocked" };

export function primaryAction({
  narration,
  language,
  defaultLanguage,
  script,
  sourceScript,
  bound,
}: {
  narration: boolean;
  language: string;
  defaultLanguage: string;
  script: string | undefined;
  /** The default language's script for the same key. */
  sourceScript: string | undefined;
  /** Whether the card's language has audio bound already. */
  bound: boolean;
}): PrimaryAction {
  if (narration && language !== defaultLanguage && !script?.trim())
    return sourceScript?.trim() ? { action: "translate" } : { action: "blocked" };
  return { action: "generate", again: bound };
}

/**
 * The change Save makes for an uploaded or trimmed file: bind it, and drop what described the
 * recording it replaces (the run it came from and its timings).
 */
export function bindCandidateFile(entry: MediaAsset, path: string): void {
  entry.path = path;
  delete entry.generatedAudio;
  delete entry.wordTimings;
  delete entry.durationMs;
  delete entry.phonemeTimings;
  delete entry.wholeWordTiming;
}
