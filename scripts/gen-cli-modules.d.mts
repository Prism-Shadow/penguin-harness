/**
 * Types for gen-cli-modules.mjs. The module is plain JavaScript because the CLI's `gen:ifaces`
 * runs it with node; this lets packages/cli's typechecked test import the functions the build
 * runs instead of re-stating the rule.
 */

/** The plugin (`@penguinharness/*`) dependencies of the package at `dir` that export `./cli`, by name. */
export declare function shippedCliPackages(dir: string): string[];

/** The generated module's text for `names`, as `shippedCliPackages` returns them. */
export declare function renderCliModules(names: readonly string[]): string;
