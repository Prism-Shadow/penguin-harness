/**
 * The Web App's module manifest: which feature directories are modules, and what each may
 * import from the rest of the app. vitest.config.ts derives one test project per entry, and
 * module-boundaries.test.ts enforces the rest, so the two cannot drift apart.
 *
 * A module is `src/features/<name>/` with:
 * - `index.ts`, its public entry — the only file outside code may import;
 * - `strings.ts`, its dictionary fragments `<name>Zh` and `<name>En` — imported only by the app
 *   dictionaries, which mount them as their `<name>` section;
 * - `test/`, its unit tests — run alone with `vitest run --project <name>`;
 * - `dependsOn`, the files outside the directory its own sources and tests may import, as
 *   paths relative to `src/` without extension. A path ending in `/` admits the whole
 *   directory. Another module is named by its entry (`features/<name>/index`).
 */
export interface WebModule {
  name: string;
  dependsOn: readonly string[];
}

export const WEB_MODULES: readonly WebModule[] = [
  // Empty for now: the terminal module's entry, dictionary fragment and test directory belong
  // to the layer that restructures the terminal feature, and the app's current tree does not
  // have them yet. The guard runs over an empty manifest until that layer fills this list.
];
