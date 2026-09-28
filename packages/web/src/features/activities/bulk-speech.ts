/**
 * Which speech an activity is still missing, and which of it can be generated now.
 * Kept pure so the count an author is shown and the work a bulk run actually does are
 * the same list, decided once.
 */

import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";

type MediaAsset = AssetManifest["assets"][string][number];

/** The longest script the speech endpoint accepts, mirrored from the manifest contract. */
export const SPEECH_SCRIPT_MAX = 5000;

export type SpeechState =
  "ready" | "generating" | "failed" | "missing" | "scriptMissing" | "scriptTooLong";

export interface SpeechStatus {
  key: string;
  /** The scenes asking for this narration, for grouping the list. */
  sceneIds: string[];
  state: SpeechState;
  /** Why the last attempt failed, when it did. */
  error?: string;
  /**
   * In a language other than the default, whether the script still needs translating: never
   * translated, translated from a default line since rewritten, or being translated now.
   */
  translation?: "missing" | "outdated" | "translating";
}

/** Whether this asset's script could be sent to the speech endpoint as it stands. */
export function speechScriptUsable(asset: MediaAsset): boolean {
  const script = asset.script?.trim() ?? "";
  return !!script && (asset.script?.length ?? 0) <= SPEECH_SCRIPT_MAX;
}

/** A run that ended without speech to show for it. */
const UNSUCCESSFUL = new Set<ActivityRunSummary["status"]>(["failed", "conflict", "interrupted"]);

/**
 * Every audio asset in one language group, with why it is or is not ready. An asset is
 * "ready" once it has any binding: generated speech, an upload, or a checkout file. An
 * author who bound a recording by hand is not missing narration.
 *
 * Given the activity's runs, an unbound narration is also "generating" while a speech run
 * works on it, and "failed" when its latest run ended without speech, as Loom's Audios
 * panel says per track.
 */
export function speechStatuses(
  assets: readonly MediaAsset[],
  runs: readonly ActivityRunSummary[] = [],
  language = "",
  /** The default language's scripts by key, when `language` is not the default. */
  sources?: ReadonlyMap<string, string>,
): SpeechStatus[] {
  const latest = new Map<string, ActivityRunSummary>();
  const translating = new Set<string>();
  for (const run of runs) {
    if (run.kind === "audio" && run.audio?.language === language) {
      const seen = latest.get(run.audio.assetKey);
      if (!seen || run.createdAt > seen.createdAt) latest.set(run.audio.assetKey, run);
    }
    if (
      run.kind === "media-text" &&
      run.status === "running" &&
      run.mediaText?.language === language &&
      run.mediaText.translation
    )
      translating.add(run.mediaText.assetKey);
  }
  const translationOf = (asset: MediaAsset): SpeechStatus["translation"] => {
    const source = sources?.get(asset.key);
    if (!source?.trim()) return undefined;
    if (translating.has(asset.key)) return "translating";
    if (!asset.script?.trim()) return "missing";
    // A script with no recorded source was written, not translated, and stands.
    if (asset.translatedFrom !== undefined && asset.translatedFrom !== source) return "outdated";
    return undefined;
  };
  return (
    assets
      // Music and effects are audio the module plays, not narration anyone speaks.
      .filter((asset) => asset.type === "audio" && !asset.kind)
      .map((asset) => {
        const run = latest.get(asset.key);
        const translation = translationOf(asset);
        const base = {
          key: asset.key,
          sceneIds: [...new Set(asset.usages.map((usage) => usage.sceneId))],
          ...(translation ? { translation } : {}),
        };
        if (asset.path) return { ...base, state: "ready" as const };
        if (!asset.script?.trim()) return { ...base, state: "scriptMissing" as const };
        if ((asset.script?.length ?? 0) > SPEECH_SCRIPT_MAX)
          return { ...base, state: "scriptTooLong" as const };
        if (run?.status === "running") return { ...base, state: "generating" as const };
        if (run && UNSUCCESSFUL.has(run.status))
          return { ...base, state: "failed" as const, ...(run.error ? { error: run.error } : {}) };
        return { ...base, state: "missing" as const };
      })
  );
}

/** The keys a bulk run would generate, in manifest order: missing, and failed to try again. */
export function pendingSpeechKeys(
  assets: readonly MediaAsset[],
  runs: readonly ActivityRunSummary[] = [],
  language = "",
): string[] {
  return speechStatuses(assets, runs, language)
    .filter((status) => status.state === "missing" || status.state === "failed")
    .map((status) => status.key);
}

export interface SpeechTally {
  total: number;
  ready: number;
  /** Generatable now: missing, or failed and worth another try. */
  pending: number;
  failed: number;
  generating: number;
  /** Unbound, and not generatable as they stand: no script, or one over the limit. */
  blocked: number;
}

/** The counts behind the language summary line. */
export function speechTally(
  assets: readonly MediaAsset[],
  runs: readonly ActivityRunSummary[] = [],
  language = "",
): SpeechTally {
  const statuses = speechStatuses(assets, runs, language);
  const count = (state: SpeechStatus["state"]) =>
    statuses.filter((status) => status.state === state).length;
  return {
    total: statuses.length,
    ready: count("ready"),
    pending: count("missing") + count("failed"),
    failed: count("failed"),
    generating: count("generating"),
    blocked: count("scriptMissing") + count("scriptTooLong"),
  };
}

/** The list's filters, as Loom's Audios panel offers them. */
export type SpeechFilter = "all" | "needs" | "translate" | "ready" | "failed" | "blocked";

/** Whether a narration belongs under a filter. */
export function inSpeechFilter(status: SpeechStatus, filter: SpeechFilter): boolean {
  if (filter === "all") return true;
  if (filter === "translate") return status.translation !== undefined;
  if (filter === "ready") return status.state === "ready";
  if (filter === "failed") return status.state === "failed";
  if (filter === "blocked")
    return status.state === "scriptMissing" || status.state === "scriptTooLong";
  return status.state === "missing" || status.state === "generating" || status.state === "failed";
}

/** The language with the most speech still to generate, for the panel's opening choice. */
export function neediestLanguage(manifest: AssetManifest): string {
  const languages = Object.keys(manifest.assets);
  let best = languages[0] ?? "en-US";
  let most = -1;
  for (const language of languages) {
    const pending = speechTally(manifest.assets[language] ?? []).pending;
    if (pending > most) {
      most = pending;
      best = language;
    }
  }
  return best;
}
