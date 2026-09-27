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
  {
    name: "terminal",
    dependsOn: [
      // The locale runtime (`S`) and the shared UI primitives.
      "lib/strings",
      "components/ui/",
      "lib/icon-scale",
      // Pointer and viewport hooks the touch key bar and the /terminal page size themselves by.
      "lib/use-coarse-pointer",
      "lib/use-visual-viewport-height",
      // The API client the shell list fetches with.
      "api/client",
      // Theme and sign-in state the view reads.
      "state/theme",
      "state/auth",
      // Where the server is, and which machine a shell runs on.
      "lib/server-context",
      "lib/terminal-machines",
      // The dock's visibility store: the view pool keeps a shell mounted while its dock tab is
      // hidden. Declared by file until the dock is a module with an entry of its own.
      "features/dock/dock-state",
    ],
  },
];
