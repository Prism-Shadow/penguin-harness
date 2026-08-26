/**
 * Pure route state for the landing page navigation. Section links are represented by
 * hashes on the home page; Blog is a normal application route.
 */
export const NAV_SECTION_IDS = [
  "highlights",
  "quickstart",
  "scenarios",
  "benchmark",
  "contract",
  "features",
] as const;

/** Includes sections without their own link so scroll-spy can map them to a parent item. */
export const OBSERVED_SECTION_IDS = [
  "cases",
  "highlights",
  "self-improvement",
  ...NAV_SECTION_IDS.slice(1),
] as const;

export type SectionId = (typeof NAV_SECTION_IDS)[number];
export type ObservedSectionId = (typeof OBSERVED_SECTION_IDS)[number];
export type ActiveNavItem = SectionId | "blog" | "download" | null;

function isSectionId(value: string): value is SectionId {
  return NAV_SECTION_IDS.some((id) => id === value);
}

export function getNavItemForSection(value: string | null): SectionId | null {
  if (value === "self-improvement") return "highlights";
  return value && isSectionId(value) ? value : null;
}

export function getActiveNavItem(pathname: string, hash: string): ActiveNavItem {
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return "blog";
  if (pathname === "/download") return "download";
  if (pathname !== "/") return null;

  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return getNavItemForSection(id);
}
