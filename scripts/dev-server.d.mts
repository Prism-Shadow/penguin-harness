/**
 * Types for dev-server.mjs so typechecked tests can import `devServerArgs` directly.
 */
export declare function devServerArgs(
  entryArgs: readonly string[],
  roots: Iterable<string>,
  resolve?: (specifier: string) => string,
): string[];
