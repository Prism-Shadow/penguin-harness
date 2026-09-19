import { contentRevision, type ActivityDetail } from "./domain.js";
import type { MediaAsset } from "./media.js";
import { HttpError } from "../http/errors.js";

export interface MediaTextTarget {
  language: string;
  assetKey: string;
  type: "image" | "audio";
  text: string;
}

export function mediaTextTarget(
  activity: ActivityDetail,
  input: { language: string; assetKey: string },
): MediaTextTarget {
  const plan = activity.draft.mediaPlan;
  if (
    activity.draft.status !== "valid" ||
    !plan ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before improving media text.");
  const asset = plan.manifest.assets[input.language]?.find((item) => item.key === input.assetKey);
  if (!asset || (asset.type !== "image" && asset.type !== "audio"))
    throw new HttpError(422, "media_text_invalid", "Select an image or audio asset.");
  return {
    language: input.language,
    assetKey: input.assetKey,
    type: asset.type,
    text: asset.type === "image" ? asset.description : (asset.script ?? ""),
  };
}

export function mediaTextPrompt(target: MediaTextTarget): string {
  const field = target.type === "image" ? "image prompt" : "spoken script";
  return `Read input.json for the saved activity context and media-text-input.json for the selected target.
Improve only the selected ${field} for the existing media asset, preserving its source intent and language.
For an image, improve visual composition and style using the activity and scene context. For audio, improve only the spoken script; do not add SSML, markup, or stage directions.
Do not change the activity structure, scene ids, asset key, media type, usages, or any other asset. Do not run media generators, delegate, or change any other files.
Write exactly one JSON object to media-text.json using normal Harness tools, with no markdown or extra fields:
{"language":${JSON.stringify(target.language)},"assetKey":${JSON.stringify(target.assetKey)},"type":${JSON.stringify(target.type)},"text":"a non-empty replacement text of at most 5000 characters"}
Read the current ${field} from media-text-input.json before writing the candidate.`;
}

export function parseMediaTextCandidate(value: string, target: MediaTextTarget): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Media text candidate is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Media text candidate must be an object.");
  const candidate = parsed as Record<string, unknown>;
  if (
    Object.keys(candidate).some((key) => !["language", "assetKey", "type", "text"].includes(key)) ||
    candidate.language !== target.language ||
    candidate.assetKey !== target.assetKey ||
    candidate.type !== target.type ||
    typeof candidate.text !== "string" ||
    !candidate.text.trim() ||
    candidate.text.length > 5000
  )
    throw new Error("Media text candidate does not match the selected asset.");
  return candidate.text;
}

export function mediaTextField(asset: MediaAsset): string {
  return asset.type === "image" ? asset.description : (asset.script ?? "");
}
