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
  clientType: "google-genai" | "deepseek-official";
}

/** Validated snapshot returned by Penguin Go's client-model catalog. */
export interface PlatformModelCatalog {
  models: PlatformCatalogModel[];
}

/**
 * Catalog merge result. `updated` is always 0: a merge adds what is new and never rewrites a row
 * the Project already holds (its price, routing and promotion may be the user's own).
 */
export interface PlatformModelApplyResult {
  added: number;
  updated: number;
  applied: number;
}
