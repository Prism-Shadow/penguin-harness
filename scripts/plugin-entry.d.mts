/**
 * Types for plugin-entry.mjs. The module is plain JavaScript because scripts/build-plugins.mjs
 * runs it directly; the server's plugin store imports the same file, so both lay an entry out
 * and hash it one way.
 */
export declare const MANIFEST_FILE: string;
export declare const PACKAGE_DIR: string;
export declare const INDEX_FILE: string;
export declare const INTEGRITY: RegExp;
export declare const KEY_LENGTH: number;

export declare function entryKey(integrity: string): string | null;
export declare function entryDir(
  root: string,
  name: string,
  version: string,
  integrity: string,
): string;

/** One file of an archive: `rel` its posix path inside it, `abs` where it is read. */
export interface ArchiveFile {
  rel: string;
  abs: string;
  exec: boolean;
}
export declare function archiveChunks(files: Iterable<ArchiveFile>): AsyncGenerator<Buffer>;
export declare function archiveIntegrity(files: Iterable<ArchiveFile>): Promise<string>;
export declare function walkFiles(dir: string, prefix?: string): Promise<string[]>;
export declare function isExecutable(abs: string): boolean;
export declare function packageIntegrity(entry: string): Promise<string>;
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
  descriptionZh?: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
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
    check?: (entry: { name: string; version: string; integrity: string }) => void;
  },
): Promise<{ name: string; version: string; integrity: string; manifest: EntryManifest }>;

export declare function sortIndex<T extends { name: string; version: string; integrity: string }>(
  entries: readonly T[],
): T[];
