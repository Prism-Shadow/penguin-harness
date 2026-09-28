/**
 * The plan behind making a ref from its product's template: one row per asset the template's
 * media plan holds in a language, what the author decided to do with each, what stands in the
 * way of creating the ref, and the decisions the server takes.
 *
 * Pure, so the page and the tests cannot disagree about what a row asks for.
 */
import type { AssetManifest, MediaAsset, RefAssetDecision } from "@prismshadow/penguin-server/api";

/** What happens to one asset: kept, generated again, replaced by a file, or by an upload. */
export type RowAction = "keep" | "regenerate" | "upload" | "library";

/** The longest script speech generation takes. */
export const REF_SCRIPT_MAX = 5000;
/** The longest description image generation takes. */
export const REF_DESCRIPTION_MAX = 5000;

export interface RefPlanRow {
  key: string;
  type: MediaAsset["type"];
  /** A narration: audio that is spoken, rather than music or a sound effect. */
  narration: boolean;
  /** Only narration and images take an action; anything else is copied as it is. */
  editable: boolean;
  /** The scenes that use it, in the order the specification has them. */
  scenes: string[];
  /** The template's asset, as it will be copied when kept. */
  asset: MediaAsset;
  action: RowAction;
  /** The script (narration) or description (image) to generate from. */
  text: string;
  /** The voice a regenerated narration is spoken in; null keeps the narration's own. */
  voice: string | null;
  /** The name of the file chosen to upload, for `upload`. */
  fileName: string | null;
  /** The template upload chosen, for `library`. */
  libraryPath: string | null;
}

export interface RowGroup {
  /** The scene the rows are first used in, or null for rows no scene uses. */
  sceneId: string | null;
  rows: RefPlanRow[];
}

/** The scene ids of a specification, in its order. */
export function sceneOrder(spec: Record<string, unknown> | null): string[] {
  const scenes = (spec?.scenes ?? spec?.stages) as unknown;
  if (!Array.isArray(scenes)) return [];
  return scenes
    .map((scene) => (scene as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string");
}

/**
 * One row per asset of the language, ordered by the first scene that uses it (unused ones
 * last), keeping the manifest's order within a scene. Every row starts as `keep`.
 */
export function planRows(
  manifest: AssetManifest | undefined,
  language: string,
  order: readonly string[],
): RefPlanRow[] {
  const position = (sceneId: string | undefined) => {
    if (sceneId === undefined) return Number.MAX_SAFE_INTEGER;
    const index = order.indexOf(sceneId);
    return index < 0 ? Number.MAX_SAFE_INTEGER - 1 : index;
  };
  return (manifest?.assets[language] ?? [])
    .map((asset, index) => {
      const narration = asset.type === "audio" && !asset.kind;
      const scenes: string[] = [];
      for (const usage of asset.usages)
        if (!scenes.includes(usage.sceneId)) scenes.push(usage.sceneId);
      scenes.sort((left, right) => position(left) - position(right));
      const row: RefPlanRow = {
        key: asset.key,
        type: asset.type,
        narration,
        editable: narration || asset.type === "image",
        scenes,
        asset,
        action: "keep",
        text: (narration ? asset.script : asset.description) ?? "",
        voice: null,
        fileName: null,
        libraryPath: null,
      };
      return { row, index, first: position(scenes[0]) };
    })
    .sort((left, right) => left.first - right.first || left.index - right.index)
    .map((entry) => entry.row);
}

/** Rows grouped under the scene each is first used in, in the rows' order. */
export function groupRows(rows: readonly RefPlanRow[]): RowGroup[] {
  const groups: RowGroup[] = [];
  for (const row of rows) {
    const sceneId = row.scenes[0] ?? null;
    const last = groups[groups.length - 1];
    if (last && last.sceneId === sceneId) last.rows.push(row);
    else groups.push({ sceneId, rows: [row] });
  }
  return groups;
}

function update(
  rows: readonly RefPlanRow[],
  key: string,
  change: (row: RefPlanRow) => RefPlanRow,
): RefPlanRow[] {
  return rows.map((row) => (row.key === key && row.editable ? change(row) : row));
}

/** The original text of a row, as the template has it. */
function originalText(row: RefPlanRow): string {
  return (row.narration ? row.asset.script : row.asset.description) ?? "";
}

export function setAction(rows: readonly RefPlanRow[], key: string, action: RowAction) {
  return update(rows, key, (row) => ({ ...row, action }));
}

export function setText(rows: readonly RefPlanRow[], key: string, text: string) {
  return update(rows, key, (row) => ({ ...row, text }));
}

export function setFileName(rows: readonly RefPlanRow[], key: string, fileName: string | null) {
  return update(rows, key, (row) => ({ ...row, fileName }));
}

export function setLibraryPath(rows: readonly RefPlanRow[], key: string, path: string | null) {
  return update(rows, key, (row) => ({ ...row, libraryPath: path }));
}

/** Every asset back to what the template has: kept, with its text and voice as they were. */
export function keepAll(rows: readonly RefPlanRow[]): RefPlanRow[] {
  return rows.map((row) =>
    row.editable
      ? {
          ...row,
          action: "keep",
          text: originalText(row),
          voice: null,
          fileName: null,
          libraryPath: null,
        }
      : row,
  );
}

/** Every image marked to generate again. */
export function regenerateAllImages(rows: readonly RefPlanRow[]): RefPlanRow[] {
  return rows.map((row) => (row.type === "image" ? { ...row, action: "regenerate" } : row));
}

/**
 * One voice for every narration: each is marked to generate again in it, since a kept clip
 * keeps the voice it was recorded in. No voice leaves each narration's own, and its action.
 */
export function voiceForAll(rows: readonly RefPlanRow[], voice: string | null): RefPlanRow[] {
  return rows.map((row) =>
    row.narration ? { ...row, voice, ...(voice ? { action: "regenerate" as const } : {}) } : row,
  );
}

/** The number typed, when it is a whole number. */
export function refNumberFrom(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

export type RefPlanBlocker =
  | { code: "missingRefNum" }
  | { code: "refNumTaken"; refNum: number }
  | {
      code:
        | "uploadMissing"
        | "libraryMissing"
        | "scriptMissing"
        | "descriptionMissing"
        | "scriptTooLong"
        | "descriptionTooLong";
      key: string;
    };

/** What stands between the plan and a new ref, in row order after the number. */
export function blockers(
  rows: readonly RefPlanRow[],
  refNumText: string,
  taken: readonly number[],
): RefPlanBlocker[] {
  const found: RefPlanBlocker[] = [];
  const refNum = refNumberFrom(refNumText);
  if (refNum === null) found.push({ code: "missingRefNum" });
  else if (taken.includes(refNum)) found.push({ code: "refNumTaken", refNum });
  for (const row of rows) {
    if (!row.editable) continue;
    if (row.action === "upload" && !row.fileName)
      found.push({ code: "uploadMissing", key: row.key });
    if (row.action === "library" && !row.libraryPath)
      found.push({ code: "libraryMissing", key: row.key });
    if (row.action !== "regenerate") continue;
    const max = row.narration ? REF_SCRIPT_MAX : REF_DESCRIPTION_MAX;
    if (!row.text.trim())
      found.push({ code: row.narration ? "scriptMissing" : "descriptionMissing", key: row.key });
    else if (row.text.length > max)
      found.push({ code: row.narration ? "scriptTooLong" : "descriptionTooLong", key: row.key });
  }
  return found;
}

/**
 * What the server is asked to do with each asset. Kept assets are left out, since keeping is
 * what the server does with an asset nobody decided about. A row to upload is cleared now and
 * bound once its file is stored in the new ref.
 */
export function decisions(rows: readonly RefPlanRow[], language: string): RefAssetDecision[] {
  return rows.flatMap((row): RefAssetDecision[] => {
    if (!row.editable) return [];
    const base = { language, assetKey: row.key };
    // A narration the template has no clip for is generated by the run all the same, so a
    // kept one still takes the chosen voice.
    if (row.action === "keep")
      return row.narration && !row.asset.path && row.voice
        ? [{ ...base, action: "clear", voice: row.voice }]
        : [];
    if (row.action === "library") return [{ ...base, action: "bind", path: row.libraryPath ?? "" }];
    if (row.action === "upload") return [{ ...base, action: "clear" }];
    return [
      {
        ...base,
        action: "clear",
        ...(row.narration ? { script: row.text } : { description: row.text }),
        ...(row.narration && row.voice ? { voice: row.voice } : {}),
      },
    ];
  });
}

/** Whether the new ref has anything to generate once it exists. */
export function needsGeneration(rows: readonly RefPlanRow[]): boolean {
  return rows.some((row) => row.editable && row.action === "regenerate");
}

/**
 * Where an asset's bound file plays from, on the template's endpoint: a generated clip from
 * its run, an upload from the uploads, anything else from the checkout. Null when unbound.
 */
export function boundSource(asset: MediaAsset, endpoint: string): string | null {
  if (!asset.path) return null;
  if (asset.generatedAudio)
    return `${endpoint}/runs/${encodeURIComponent(asset.generatedAudio.runId)}/audio`;
  if (asset.generatedVideo)
    return `${endpoint}/runs/${encodeURIComponent(asset.generatedVideo.runId)}/video`;
  if (asset.path.startsWith("media/uploads/"))
    return `${endpoint}/media-upload?${new URLSearchParams({ path: asset.path })}`;
  return `${endpoint}/sandbox/media/${asset.path
    .slice("media/".length)
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
