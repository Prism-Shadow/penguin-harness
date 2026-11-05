/**
 * Types for push-bundle.mjs. The module is plain JavaScript because scripts/deploy.mjs loads it
 * directly; this lets packages/server's typechecked test compile with the same options a push uses.
 */
export interface PushBundleOptions {
  entryPoints?: string[];
  outfile: string;
  [option: string]: unknown;
}

export declare function pushBundleOptions(entry: string, outfile: string): PushBundleOptions;

export declare function compilePushBundle(options: PushBundleOptions): Promise<void>;
