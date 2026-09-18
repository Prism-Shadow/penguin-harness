import { createHash, randomUUID } from "node:crypto";

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
    .update(JSON.stringify(value, Object.keys((value ?? {}) as object).sort()))
    .digest("hex");
}

export function validateActivitySpec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Activity specification must be a JSON object.");
  }
  const spec = value as Record<string, unknown>;
  for (const key of ["id", "title", "runtime", "activityDescription"]) {
    if (typeof spec[key] !== "string" && key !== "runtime") {
      throw new Error(`Activity specification requires ${key}.`);
    }
  }
  if (spec.runtime === null || typeof spec.runtime !== "object" || Array.isArray(spec.runtime)) {
    throw new Error("Activity specification requires a runtime object.");
  }
  const scenes = spec.scenes ?? spec.stages;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Activity specification requires at least one scene.");
  }
  return spec;
}
