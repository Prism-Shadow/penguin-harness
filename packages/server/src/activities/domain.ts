import { createHash, randomUUID } from "node:crypto";
import type { MediaPlan } from "./media.js";
import type { AudioTarget } from "./audio.js";
import type { ImageTarget } from "./generated-image.js";

export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;

export interface ActivityAddress {
  productCode: string;
  refNum: number;
}

export interface CollectionManifest {
  schemaVersion: 1;
  collectionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord extends ActivityAddress {
  id: string;
  collectionId: string;
  title: string;
  activityType: "standard" | "book";
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface ActivityDraft {
  draftId: string;
  activityId: string;
  baseVersionId: string | null;
  contentRevision: string;
  status: "draft" | "valid" | "invalid";
  description: string;
  spec: Record<string, unknown> | null;
  mediaPlan?: MediaPlan;
  updatedAt: string;
}

export function normalizeProductCode(value: unknown): string {
  const productCode = String(value ?? "").trim();
  if (!PRODUCT_CODE_PATTERN.test(productCode)) {
    throw new Error(
      "productCode must be a safe path segment containing only letters, numbers, dots, underscores, or hyphens.",
    );
  }
  return productCode;
}

export function normalizeRefNum(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("refNum must be a non-negative integer.");
  }
  return value;
}

export function newCollectionManifest(): CollectionManifest {
  const now = new Date().toISOString();
  return { schemaVersion: 1, collectionId: randomUUID(), createdAt: now, updatedAt: now };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function contentRevision(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export type ActivityDetail = ActivityRecord & { draft: ActivityDraft };

/** Preserve pre-media draft hashes until a plan is explicitly saved. */
export function draftRevision(
  draft: Pick<ActivityDraft, "description" | "spec" | "mediaPlan">,
): string {
  return contentRevision({
    description: draft.description,
    spec: draft.spec,
    ...(draft.mediaPlan ? { mediaPlan: draft.mediaPlan } : {}),
  });
}
export type ActivityRunStatus =
  "running" | "succeeded" | "failed" | "conflict" | "cancelled" | "interrupted";
export interface ActivityRun {
  kind: "spec" | "module" | "audio" | "image";
  audio?: AudioTarget;
  image?: ImageTarget;
  runId: string;
  activityId: string;
  projectId: string;
  draftId: string;
  inputRevision: string;
  agentId: string;
  sessionId: string | null;
  status: ActivityRunStatus;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  candidate: string | null;
}

export type ActivityRunSummary = Omit<ActivityRun, "candidate"> & { hasCandidate: boolean };

export function validateActivitySpec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Activity specification must be a JSON object.");
  }
  const spec = value as Record<string, unknown>;
  for (const key of ["id", "title", "activityDescription"]) {
    if (typeof spec[key] !== "string") {
      throw new Error(`Activity specification requires ${key}.`);
    }
  }
  if (!PRODUCT_CODE_PATTERN.test(spec.id as string) || !(spec.title as string).length)
    throw new Error("Activity specification requires a safe id and a non-empty title.");
  if (
    spec.moduleFolder !== undefined &&
    (typeof spec.moduleFolder !== "string" ||
      !/^waf-module-[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(spec.moduleFolder))
  )
    throw new Error("Invalid moduleFolder.");
  if (spec.runtime === null || typeof spec.runtime !== "object" || Array.isArray(spec.runtime)) {
    throw new Error("Activity specification requires a runtime object.");
  }
  const runtime = spec.runtime as Record<string, unknown>;
  if (
    runtime.engine !== "html" ||
    typeof runtime.usesAssessment !== "boolean" ||
    ["layout", "theme", "resolution"].some((key) => typeof runtime[key] !== "string")
  )
    throw new Error("runtime requires engine html, layout, theme, resolution and usesAssessment.");
  const scenes = spec.scenes ?? spec.stages;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Activity specification requires at least one scene.");
  }
  // Mirrors Loom's activity_spec.schema.json, including the retained stages alias.
  for (const key of ["scenes", "stages"]) {
    if (spec[key] === undefined) continue;
    if (!Array.isArray(spec[key]) || spec[key].length === 0)
      throw new Error(`${key} must be a non-empty array.`);
    for (const value of spec[key]) {
      const scene = object(value, key);
      strings(scene, ["id", "description"], key);
      if (scene.media !== undefined) {
        const media = object(scene.media, "media");
        for (const kind of ["images", "video", "animations"]) assets(media[kind], false);
      }
      if (scene.audio !== undefined) assets(object(scene.audio, "audio").tracks, true);
    }
  }
  if (
    spec.acceptance_criterias !== undefined &&
    (!Array.isArray(spec.acceptance_criterias) ||
      spec.acceptance_criterias.some((v) => typeof v !== "string"))
  )
    throw new Error("acceptance_criterias must contain strings.");
  if (spec.audience != null) {
    const audience = object(spec.audience, "audience");
    if (audience.gradeBand != null && typeof audience.gradeBand !== "string")
      throw new Error("audience.gradeBand must be a string or null.");
  }
  return spec;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function strings(value: Record<string, unknown>, keys: string[], name: string) {
  if (keys.some((key) => typeof value[key] !== "string"))
    throw new Error(`${name} requires ${keys.join(", ")} strings.`);
}
function assets(value: unknown, audio: boolean) {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("Assets must be an array.");
  for (const item of value) {
    const asset = object(item, "Asset");
    strings(asset, ["key", "description"], "Asset");
    for (const key of audio ? ["targetPath", "script"] : ["targetPath"])
      if (asset[key] !== undefined && typeof asset[key] !== "string")
        throw new Error(`${key} must be a string.`);
    if (audio && asset.interruptible !== undefined && typeof asset.interruptible !== "boolean")
      throw new Error("interruptible must be a boolean.");
  }
}
