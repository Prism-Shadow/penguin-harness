/**
 * Types for deploy-same-build.mjs. The module is plain JavaScript because scripts/deploy.mjs
 * loads it directly; this lets packages/server's typechecked test import the same functions
 * the push uses instead of re-stating the rules.
 */
export interface BuildPointers {
  platform: string;
  cli: string;
  web: string;
  assets: string | null;
}

export declare function buildPointers(build: {
  platform: Buffer;
  cli: Buffer;
  web: Record<string, Buffer>;
  assets?: Record<string, Buffer>;
}): BuildPointers;

export declare function committedBuildMatches(
  report: unknown,
  pointers: BuildPointers,
): { same: true } | { same: false; reason: string };
