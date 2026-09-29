/**
 * The shapes of making a ref from its product's template, on their own so the App can import
 * them without pulling in the service that copies the files (see `ref-template.ts`).
 */

/**
 * What happens to one of the template's assets in the new ref: `keep` leaves the binding as it
 * is, `clear` unbinds it (with an edited script or description) so a run generates it again,
 * and `bind` points it at one of the template's uploads, which the new ref copies.
 */
export type RefAssetAction = "keep" | "clear" | "bind";

export interface RefAssetDecision {
  language: string;
  assetKey: string;
  action: RefAssetAction;
  /** A narration's new script, for `clear`. */
  script?: string;
  /** An image's new description, for `clear`. */
  description?: string;
  /** The voice a cleared narration is generated in next. */
  voice?: string;
  /** The uploaded file's `media/loom/<pc>/<pc>-<ref>/uploads/...` reference to bind, for `bind`. */
  path?: string;
}

/** The number a new ref would take, and whether the open ref is the product's template. */
export interface RefNumberSuggestion {
  refNum: number;
  /** Whether this ref is its product's canonical ref, the only one new refs are made from. */
  canonical: boolean;
  /** Every number the product's refs hold, deleted ones included. */
  taken: number[];
}
