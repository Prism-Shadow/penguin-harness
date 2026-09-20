/**
 * The modules and demos the gallery discovers on disk, via Vite globs (resolved at build time, so
 * adding a file needs no registration):
 *
 * - modules: every `packages/ui/src/modules/*.module.tsx`, plus the gallery's own
 *   `src/modules/*.module.tsx` (Foundations and Screens, which render gallery machinery), eager and
 *   checked against `MODULE_IDS`;
 * - demos: every `*.demo.tsx` under `packages/ui/src`, eager, checked against the catalog;
 * - both again as text, lazy, for the code drawer.
 *
 * Web App sources and font licences are read in sources.ts; screens have their own registry in
 * `packages/ui/src/screens/index.ts`.
 */
import { CATALOG } from "../../ui/src/catalog";
import type { Demo } from "../../ui/src/demo";
import type { Module } from "../../ui/src/module";
import { collectDemos } from "./lib/demos";
import { collectModules } from "./lib/modules";

const moduleFiles = import.meta.glob<{ module?: Module }>(
  ["../../ui/src/modules/*.module.tsx", "./modules/*.module.tsx"],
  { eager: true },
);

export const MODULES = collectModules(moduleFiles, CATALOG);

const demoFiles = import.meta.glob<{ demo?: Demo }>("../../ui/src/**/*.demo.tsx", {
  eager: true,
});

export const DEMOS = collectDemos(demoFiles, CATALOG);

const sources = import.meta.glob<string>(
  ["../../ui/src/**/*.demo.tsx", "../../ui/src/modules/*.module.tsx", "./modules/*.module.tsx"],
  { query: "?raw", import: "default" },
);

export async function loadSource(path: string): Promise<string | null> {
  const load = sources[path];
  return load ? load() : null;
}

/** Glob path → repo-relative path, for display. */
export function repoPath(globPath: string): string {
  return globPath.startsWith("./")
    ? `packages/ui-gallery/src/${globPath.slice(2)}`
    : globPath.replace(/^(\.\.\/)+/, "packages/");
}
