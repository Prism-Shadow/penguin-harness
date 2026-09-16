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
  supportsVision: boolean;
  /**
   * List price, which is what a Project stores: the platform's `listPricing` when it runs a
   * promotion on the model, its billed `pricing` otherwise.
   */
  pricing: PlatformCatalogPricing;
  /** Fraction off `pricing` the platform is running (0.5 = half price); absent when none. */
  discount?: number;
  baseUrl: string;
  clientType: "gemini-3.8" | "deepseek-v4";
}

/** Validated snapshot returned by Penguin Go's client-model catalog. */
export interface PlatformModelCatalog {
  models: PlatformCatalogModel[];
}

/** Catalog merge result. `updated` counts existing rows whose list price, client type or promotion changed. */
export interface PlatformModelApplyResult {
  added: number;
  updated: number;
  applied: number;
}
