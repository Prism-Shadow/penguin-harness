/**
 * Products found in the WAF workspace's modules that a project may open in place, as the App
 * sees them. Types only, so the web can import them.
 */

/** A product under `modules/<moduleFolder>/generated/<productCode>` no project has open. */
export interface ModuleProduct {
  moduleFolder: string;
  productCode: string;
  /** The product's title, when its metadata names one. */
  title: string | null;
  activityType: "standard" | "book";
  /** Its refs' numbers, in order. */
  refNums: number[];
}

/** GET /api/projects/:projectId/activities/module-products. */
export interface ModuleProductsResponse {
  products: ModuleProduct[];
}

/** POST /api/projects/:projectId/activities/module-products/claim. */
export interface ClaimModuleProductResponse {
  collectionId: string;
  /** The refs now open in the project, in order. */
  activityIds: string[];
  /** What was repaired and what could not be carried, in one line. */
  message: string;
  /** Per-ref problems found while opening it; empty when nothing went wrong. */
  problems: string[];
}
