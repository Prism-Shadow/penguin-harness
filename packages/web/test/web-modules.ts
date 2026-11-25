/**
 * The Web App's module manifest: which feature directories are modules, and what each may
 * import from the rest of the app. vitest.config.ts includes each module's internal tests, and
 * web-modules.test.ts enforces these boundaries.
 *
 * A module is `src/features/<name>/` with:
 * - `index.ts`, its public entry — the only file outside code may import;
 * - `module.ts`, its kernel module declaration;
 * - `test/`, its unit tests — included by vitest.config.ts;
 * - `dependsOn`, the files outside the directory its own sources and tests may import, as
 *   paths relative to `src/` without extension. A path ending in `/` admits the whole
 *   directory. Another module is named by its entry (`features/<name>/index`).
 */
export interface WebModule {
  name: string;
  dependsOn: readonly string[];
}

export const WEB_MODULES: readonly WebModule[] = [
  // The terminal's web half lives in library/terminal (its ./web face) since W17; the dock
  // reaches it through the face, so no in-app module entry remains.
];
