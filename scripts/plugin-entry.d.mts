/**
 * Types for plugin-entry.mjs. The module is plain JavaScript because scripts/build-plugins.mjs
 * runs it directly; the server's plugin store imports the same file, so both lay an entry out
 * one way.
 */
export declare const MANIFEST_FILE: string;
export declare const PACKAGE_DIR: string;
export declare const INDEX_FILE: string;
export declare const INTEGRITY: RegExp;
export declare const KEY_LENGTH: number;

export declare function entryKey(integrity: string): string | null;
export declare function tarballIntegrity(file: string): Promise<string>;
export declare const PACKAGES_DIR: string;
export declare function bucketOf(name: string): string[];
export declare function nameSegments(name: string): string[];
export declare function treeNames(root: string): Promise<Array<{ name: string; dir: string }>>;
export declare function entryDir(
  root: string,
  name: string,
  version: string,
  integrity: string,
): string;

export declare function walkFiles(dir: string, prefix?: string): Promise<string[]>;
export declare function isExecutable(abs: string): boolean;
export declare function readPackageJson(dir: string): Promise<Record<string, unknown> | null>;

/** An entry's `manifest.toml`: the index repository's fields, `integrity` required. */
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
  /** The platforms the plugin runs on, `process.platform` words; absent means every platform. */
  os?: string[];
  integrity: string;
}
export declare function manifestOf(
  pkg: Record<string, unknown>,
  name: string,
  version: string,
  integrity: string,
): EntryManifest;

export declare function layOutEntry(
  stage: string,
  pkgDir: string,
  prefixDir: string,
  options: {
    stringifyToml: (value: Record<string, unknown>) => string;
    integrity: string;
  },
): Promise<{ name: string; version: string; integrity: string; manifest: EntryManifest }>;

export declare function sortIndex<T extends { name: string; version: string; integrity: string }>(
  entries: readonly T[],
): T[];
