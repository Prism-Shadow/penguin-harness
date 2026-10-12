/** Types for locked-prefix.mjs, which the server's typechecked tests import. */
export interface PnpmLock {
  importers?: Record<string, { dependencies?: Record<string, { version: string }> }>;
  packages?: Record<string, { os?: string[]; cpu?: string[]; resolution?: { integrity?: string } }>;
  snapshots?: Record<
    string,
    { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }
  >;
}
export declare function readPnpmLock(root: string): PnpmLock;
export declare function lockedClosure(
  lock: PnpmLock,
  importers: string[],
  natives: { has(name: string): boolean },
  targets: { os: string; cpu: string }[],
): Map<string, string>;
export declare function lockCacheInput(lock: PnpmLock, closure: Map<string, string>): string;
export declare function platformSpecs(lock: PnpmLock, closure: Map<string, string>): string[];
export declare function integrityMismatches(
  lock: PnpmLock,
  closure: Map<string, string>,
  npmLock: {
    packages?: Record<string, { name?: string; version?: string; integrity?: string }>;
  },
  ignored?: Set<string>,
): string[];
