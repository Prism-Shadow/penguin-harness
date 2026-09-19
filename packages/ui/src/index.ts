/**
 * @prismshadow/penguin-ui — the shared UI package: token contract, themes, fonts and the
 * component set. Source-only: a consumer's `workspace:*` dependency is linked to this directory,
 * so Vite, vitest and tsc read `src/` through the `exports` map in package.json, never a build.
 */
export * from "./hooks";
export * from "./scene";
export * from "./tokens";
