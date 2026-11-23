/** Types for external-plugins.mjs, which the server's typechecked tests import. */
import type { PnpmLock } from "./locked-prefix.mjs";

export interface ExternalPin {
  name: string;
  version: string;
  integrity: string;
  asset?: string;
}
export declare const HOST_PACKAGES: string[];
export declare function externalPins(root: string, lock: PnpmLock): ExternalPin[];
export declare function pinProblems(root: string, lock: PnpmLock): string[];
export declare function tarballName(pin: { name: string; version: string }): string;
export declare function lockedTarball(
  pin: ExternalPin,
  options: { into: string; env?: NodeJS.ProcessEnv },
): Promise<{ file: string; source: string }>;
export declare function unpackPackage(file: string, dir: string): Promise<Record<string, unknown>>;
