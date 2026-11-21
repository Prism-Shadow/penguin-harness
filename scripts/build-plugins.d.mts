/** Types for build-plugins.mjs, which the server's typechecked tests import. */
export interface BuiltPrefix {
  /** The staged prefix directory (in the build cache). */
  dir: string;
  /** The files to ship, relative to `dir`, as posix paths. */
  files: string[];
  /** What the prefix's manifest names: the packages it ships as built in. */
  plugins: { name: string; version: string }[];
}
export declare function buildBuiltinPlugins(options?: {
  log?: (message: string) => void;
  root?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<BuiltPrefix>;
export declare function prefixLayout(built: BuiltPrefix): Map<string, { path: string }>;
export declare function stagePrefix(built: BuiltPrefix, dest: string): Promise<void>;
