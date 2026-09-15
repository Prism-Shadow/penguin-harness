/** Stable identifiers for Penguin Go's key-authorization flow. */

export const PLATFORM_CLIENT_ID = "penguin-harness";

export interface PlatformCatalogPricing {
  unit: "usd_per_mtok";
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** A platform model normalized into the fields Penguin persists for a newly discovered row. */
export interface PlatformCatalogModel {
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens?: number;
  supportsVision: boolean;
  pricing: PlatformCatalogPricing;
  baseUrl: string;
  clientType?: "openai-chat";
}

/** Validated snapshot returned by Penguin Go's client-model catalog. */
export interface PlatformModelCatalog {
  models: PlatformCatalogModel[];
}

/** Catalog merge result. `updated` counts existing rows whose platform price changed. */
export interface PlatformModelApplyResult {
  added: number;
  updated: number;
  applied: number;
}
