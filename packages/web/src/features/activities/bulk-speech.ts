/**
 * Which speech an activity is still missing, and which of it can be generated now.
 * Kept pure so the count an author is shown and the work a bulk run actually does are
 * the same list, decided once.
 */

import type { AssetManifest } from "@prismshadow/penguin-server/api";

type MediaAsset = AssetManifest["assets"][string][number];

/** The longest script the speech endpoint accepts, mirrored from the manifest contract. */
export const SPEECH_SCRIPT_MAX = 5000;

export interface SpeechStatus {
  key: string;
  /** The scenes asking for this narration, for grouping the list. */
  sceneIds: string[];
  state: "ready" | "missing" | "scriptMissing" | "scriptTooLong";
}

/** Whether this asset's script could be sent to the speech endpoint as it stands. */
export function speechScriptUsable(asset: MediaAsset): boolean {
  const script = asset.script?.trim() ?? "";
  return !!script && (asset.script?.length ?? 0) <= SPEECH_SCRIPT_MAX;
}

/**
 * Every audio asset in one language group, with why it is or is not ready. An asset is
 * "ready" once it has any binding: generated speech, an upload, or a checkout file. An
 * author who bound a recording by hand is not missing narration.
 */
export function speechStatuses(assets: readonly MediaAsset[]): SpeechStatus[] {
  return assets
    .filter((asset) => asset.type === "audio")
    .map((asset) => ({
      key: asset.key,
      sceneIds: [...new Set(asset.usages.map((usage) => usage.sceneId))],
      state: asset.path
        ? ("ready" as const)
        : !asset.script?.trim()
          ? ("scriptMissing" as const)
          : (asset.script?.length ?? 0) > SPEECH_SCRIPT_MAX
            ? ("scriptTooLong" as const)
            : ("missing" as const),
    }));
}

/** The keys a bulk run would generate, in manifest order. */
export function pendingSpeechKeys(assets: readonly MediaAsset[]): string[] {
  return speechStatuses(assets)
    .filter((status) => status.state === "missing")
    .map((status) => status.key);
}

export interface SpeechTally {
  total: number;
  ready: number;
  pending: number;
  /** Unbound, and not generatable as they stand: no script, or one over the limit. */
  blocked: number;
}

/** The counts behind the language summary line. */
export function speechTally(assets: readonly MediaAsset[]): SpeechTally {
  const statuses = speechStatuses(assets);
  const count = (state: SpeechStatus["state"]) =>
    statuses.filter((status) => status.state === state).length;
  return {
    total: statuses.length,
    ready: count("ready"),
    pending: count("missing"),
    blocked: count("scriptMissing") + count("scriptTooLong"),
  };
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
