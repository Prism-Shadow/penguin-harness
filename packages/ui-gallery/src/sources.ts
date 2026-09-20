/**
 * Files the gallery reads as text, via Vite globs:
 *
 * - icon sources: the Web App modules that declare line-icon paths (see lib/icon-registry.ts), for
 *   the Foundations › Icons board until W1 moves the registry into the package;
 * - font licences: `packages/ui/src/fonts/LICENSES/*.txt`, lazy, for `/fonts`.
 *
 * Kept apart from registry.ts: the Foundations module imports these, and registry.ts imports the
 * modules.
 */
import { extractIconPaths, extractIconSizes, unreadPaths } from "./lib/icon-registry";

/** Glob path → repo-relative path, for display. */
const repoPath = (globPath: string) => globPath.replace(/^(\.\.\/)+/, "packages/");

const iconSources = import.meta.glob<string>(
  [
    "../../web/src/components/ui/icons.tsx",
    "../../web/src/components/ui/group-list.tsx",
    "../../web/src/components/ui/session-row-menu.tsx",
    "../../web/src/lib/stat-icons.ts",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** The files the board reads, by repo-relative path — the count is the files, not the groups. */
const ICON_FILES = Object.fromEntries(
  Object.entries(iconSources).map(([path, text]) => [repoPath(path), text]),
);

export const WEB_ICON_FILES = Object.keys(ICON_FILES);
export const WEB_ICONS = extractIconPaths(ICON_FILES);
/** Paths in those files that no constant names, so the board can say what it is not showing. */
export const WEB_ICONS_UNREAD = unreadPaths(ICON_FILES, WEB_ICONS);

const iconScale = import.meta.glob<string>("../../web/src/lib/icon-scale.ts", {
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
