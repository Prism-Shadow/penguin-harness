/**
 * The module's own documents for a ref, as Loom showed them beside the script: its
 * configuration, its assessment and its definition (`definition.json`), read from whichever module the preview would play, or
 * as an author edited them.
 *
 * Its own module so the App can import the shape without pulling the sandbox in.
 */
export interface ModuleDocuments {
  /**
   * Where the module was read from: an assembly run's module, the checkout, or -- when there is
   * no module yet but an author edited a document -- the draft; null when there is nothing.
   */
  source: "run" | "checkout" | "draft" | null;
  configuration: ModuleDocument | null;
  assessment: ModuleDocument | null;
  /** The module's `definition.json`, shared by every ref of the product. */
  definition: ModuleDocument | null;
  /** The product's canonical ref, which owns the shared assessment and definition; null when there is none. */
  canonicalRefNum: number | null;
}

export interface ModuleDocument {
  /** Its path inside the module, e.g. `configurations/<code>-<ref>.json`. */
  file: string;
  value: unknown;
  /** An author's edit, used in place of the module's own document. */
  edited: boolean;
  /** The edit predates the current media plan (configuration) or specification (assessment, definition). */
  stale: boolean;
  /** Whether this viewer may edit it here: a project owner, and for a shared document the canonical ref. */
  editable: boolean;
}
