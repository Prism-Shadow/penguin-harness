/**
 * @prismshadow/penguin-ui — the shared UI package: token contract, themes, fonts and the
 * component set. Source-only: a consumer's `workspace:*` dependency is linked to this directory,
 * so Vite, vitest and tsc read `src/` through the `exports` map in package.json, never a build.
 */
export * from "./hooks";
export * from "./tokens";
// The component set, as it lands: the Spinner first (the Web App renders it where it used to
// hand-draw a ring).
export * from "./components/icons/spinner/spinner";
