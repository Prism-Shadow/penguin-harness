/**
 * A new ref's draft, made from its product's template ref and the author's decision about
 * each of the template's assets.
 *
 * Pure: the service copies the template's files and publishes the draft this returns, so what
 * the new ref will say is decided (and refused) before anything is written.
 */
import { validateBookSpec } from "./book.js";
import { validateActivitySpec, type ActivityDetail, type ActivityDraft } from "./domain.js";
import { validateManifest, type MediaAsset } from "./media.js";
import { isUploadReference } from "./upload.js";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { RefAssetAction, RefAssetDecision } from "./ref-template-types.js";

export type {
  RefAssetAction,
  RefAssetDecision,
  RefNumberSuggestion,
} from "./ref-template-types.js";

/** The most decisions one request may carry: a manifest holds at most 2000 assets. */
export const REF_DECISIONS_MAX = 2000;
/** The longest script speech generation takes. */
export const REF_SCRIPT_MAX = 5000;
/** The longest description the manifest keeps. */
export const REF_DESCRIPTION_MAX = 10000;

const ACTIONS: readonly RefAssetAction[] = ["keep", "clear", "bind"];

function optionalText(record: Record<string, unknown>, key: string, max: number) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max)
    throw badRequest(`decisions[].${key} must be a string of at most ${max} characters.`);
  return value;
}

/** The decisions a request carries, checked for shape only; what they name is checked later. */
export function parseRefDecisions(value: unknown): RefAssetDecision[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw badRequest("decisions must be an array.");
  if (value.length > REF_DECISIONS_MAX)
    throw badRequest(`decisions may hold at most ${REF_DECISIONS_MAX} entries.`);
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw badRequest("Each decision must be an object.");
    const record = raw as Record<string, unknown>;
    if (
      Object.keys(record).some(
        (key) =>
          !["language", "assetKey", "action", "script", "description", "voice", "path"].includes(
            key,
          ),
      )
    )
      throw badRequest("A decision holds an unsupported field.");
    if (typeof record.language !== "string" || !record.language || record.language.length > 35)
      throw badRequest("decisions[].language is required.");
    if (typeof record.assetKey !== "string" || !record.assetKey || record.assetKey.length > 128)
      throw badRequest("decisions[].assetKey is required.");
    if (!ACTIONS.includes(record.action as RefAssetAction))
      throw badRequest("decisions[].action must be keep, clear or bind.");
    const script = optionalText(record, "script", 100000);
    const description = optionalText(record, "description", 100000);
    const voice = optionalText(record, "voice", 64);
    const path = optionalText(record, "path", 1024);
    return {
      language: record.language,
      assetKey: record.assetKey,
      action: record.action as RefAssetAction,
      ...(script !== undefined ? { script } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(voice !== undefined ? { voice } : {}),
      ...(path !== undefined ? { path } : {}),
    };
  });
}

function invalid(message: string): HttpError {
  return new HttpError(422, "ref_plan_invalid", message);
}

/** Forget the file an asset was bound to, and what was measured from that file. */
function unbind(asset: MediaAsset): void {
  delete asset.path;
  delete asset.generatedAudio;
  delete asset.generatedImage;
  delete asset.wordTimings;
  delete asset.durationMs;
  delete asset.phonemeTimings;
  delete asset.wholeWordTiming;
}

/**
 * The new ref's description, specification and media plan: the template's, with the manifest
 * addressed to `refNum` and each decision applied. Keeping is the default, so an asset no
 * decision names stays bound as the template has it. The specification is the template's, so
 * the plan's revision and requirements still describe it.
 */
export function refDraftFromTemplate(
  template: ActivityDetail,
  refNum: number,
  decisions: readonly RefAssetDecision[],
): Pick<ActivityDraft, "description" | "spec" | "mediaPlan" | "status"> {
  const source = template.draft;
  const status = source.status;
  if (status === "valid") {
    try {
      const spec = validateActivitySpec(source.spec);
      if (template.activityType === "book") validateBookSpec(spec);
    } catch (error) {
      throw new HttpError(422, "spec_invalid", (error as Error).message);
    }
  }
  const plan = source.mediaPlan;
  if (!plan) {
    if (decisions.some((decision) => decision.action !== "keep"))
      throw invalid("The template has no media plan, so none of its assets can be changed.");
    return {
      description: source.description,
      spec: source.spec === null ? null : structuredClone(source.spec),
      status,
    };
  }
  const manifest = structuredClone(plan.manifest);
  manifest.refNum = refNum;
  const seen = new Set<string>();
  for (const decision of decisions) {
    const id = `${decision.language}\u0000${decision.assetKey}`;
    if (seen.has(id))
      throw invalid(`Asset ${decision.assetKey} (${decision.language}) is decided twice.`);
    seen.add(id);
    const asset = manifest.assets[decision.language]?.find(
      (entry) => entry.key === decision.assetKey,
    );
    if (!asset)
      throw invalid(`The template has no asset ${decision.assetKey} in ${decision.language}.`);
    if (decision.action === "keep") continue;
    if (decision.action === "bind") {
      if (!isUploadReference(decision.path))
        throw invalid(`Asset ${decision.assetKey} can only be bound to an uploaded file.`);
      unbind(asset);
      asset.path = decision.path!;
      continue;
    }
    // clear
    unbind(asset);
    if (decision.script !== undefined) {
      if (asset.type !== "audio" || asset.kind)
        throw invalid(`Only a narration takes a script; ${decision.assetKey} is not one.`);
      if (!decision.script.trim() || decision.script.length > REF_SCRIPT_MAX)
        throw invalid(
          `The script of ${decision.assetKey} must be 1 to ${REF_SCRIPT_MAX} characters.`,
        );
      // A line rewritten by hand is no longer the translation it was recorded as.
      if (decision.script !== asset.script) delete asset.translatedFrom;
      asset.script = decision.script;
    }
    if (decision.description !== undefined) {
      if (asset.type !== "image")
        throw invalid(`Only an image takes a new description; ${decision.assetKey} is not one.`);
      if (!decision.description.trim() || decision.description.length > REF_DESCRIPTION_MAX)
        throw invalid(
          `The description of ${decision.assetKey} must be 1 to ${REF_DESCRIPTION_MAX} characters.`,
        );
      asset.description = decision.description;
    }
    if (decision.voice !== undefined) {
      if (asset.type !== "audio" || asset.kind)
        throw invalid(`Only a narration takes a voice; ${decision.assetKey} is not one.`);
      asset.voice = decision.voice;
    }
  }
  let validated;
  try {
    validated = validateManifest(manifest, { productCode: template.productCode, refNum });
  } catch (error) {
    throw invalid((error as Error).message);
  }
  return {
    description: source.description,
    spec: source.spec === null ? null : structuredClone(source.spec),
    mediaPlan: {
      specRevision: plan.specRevision,
      requirements: { ...plan.requirements },
      manifest: validated,
    },
    status,
  };
}

/** The number after the highest one taken, or 0 for a product with none. */
export function nextFreeRefNum(refs: readonly number[]): number {
  return refs.length ? Math.max(...refs) + 1 : 0;
}
