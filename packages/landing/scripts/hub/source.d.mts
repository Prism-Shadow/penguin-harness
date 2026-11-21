/** Types for source.mjs. */
export declare const CACHE_DIR: string;
export declare function benchmarkRepo(options?: { refresh?: boolean }): string;
export declare function dataFiles(repo: string, prefix?: string): string[];
export declare function externalDataRepo(
  index: string,
  url: string,
): { root: string; tree: string; files: string[] } | undefined;
