/**
 * The identity of the code that lays the PR graph out. It is part of every snapshot's key
 * (pr-graph.ts `inputsOf`): a build with other layout rules computes another key, so its first
 * read lays the graph out again instead of answering what the previous build laid out from the
 * same inputs.
 *
 * The identity is the stamp the server's plugin loader puts on the entry's import URL (`?v=`,
 * packages/server/src/plugin/loader.ts `importPlugin`) — what the loader itself uses to tell
 * one build of the package from another. The plugin is bundled into that one entry file, so
 * this module's `import.meta.url` is the entry's URL. Imported without a stamp (tests, a bare
 * specifier the loader did not resolve) it falls back to the package version.
 */
import pkg from "../package.json" with { type: "json" };

/** The layout code's identity from a module URL: the loader's `?v=` stamp, else the version. */
export function layoutCodeOf(moduleUrl: string, version: string): string {
  const stamp = new URL(moduleUrl).searchParams.get("v");
  return stamp !== null && stamp !== "" ? `build:${stamp}` : `version:${version}`;
}

/** This build's identity, read once when the plugin loads. */
export const LAYOUT_CODE = layoutCodeOf(import.meta.url, pkg.version);
