/**
 * Files the gallery reads as text, via Vite globs:
 *
 * - icon sources: the shared registry of line-icon paths and the icon scale in `packages/ui` (see
 *   lib/icon-registry.ts), for the Icons foundation board;
 * - font licences: `packages/ui/src/fonts/LICENSES/*.txt`, lazy, for `/fonts/licences`.
 */
import { extractIconPaths, extractIconSizes } from "./lib/icon-registry";

/** Glob path → repo-relative path, for display. */
const repoPath = (globPath: string) => globPath.replace(/^(\.\.\/)+/, "packages/");

const iconSources = import.meta.glob<string>("../../ui/src/components/icons/icons.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const WEB_ICONS = extractIconPaths(
  Object.fromEntries(Object.entries(iconSources).map(([path, text]) => [repoPath(path), text])),
);

const iconScale = import.meta.glob<string>("../../ui/src/icon-scale.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const WEB_ICON_SIZES = extractIconSizes(Object.values(iconScale)[0] ?? "");

export const FONT_LICENSES = import.meta.glob<string>("../../ui/src/fonts/LICENSES/*.txt", {
  query: "?raw",
  import: "default",
});

export { repoPath as licencePath };
