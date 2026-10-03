/** Types for plugin-entry.mjs, plain JavaScript because scripts/build-plugins.mjs runs it directly. */
export declare const INDEX_FILE: string;
export declare const INTEGRITY_FILE: string;
export declare const INTEGRITY: RegExp;

export declare function tarballIntegrity(file: string): Promise<string>;

/** An index row: the index repository's fields, `integrity` required. */
export interface EntryManifest {
  name: string;
  version: string;
  description: string;
  authors: string[];
  license: string;
  repository?: string;
  homepage?: string;
  keywords?: string[];
  categories?: string[];
  integrity: string;
}
export declare function manifestOf(
  pkg: Record<string, unknown>,
  name: string,
  version: string,
  integrity: string,
): EntryManifest;

export declare function sortIndex<T extends { name: string; version: string; integrity: string }>(
  entries: readonly T[],
): T[];
