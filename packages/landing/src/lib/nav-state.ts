/**
 * Pure route state for the landing page navigation. Section links are represented by
 * hashes on the home page; Blog is a normal application route.
 */
export const SECTION_IDS = ["features", "self-improvement", "cases", "quickstart"] as const;

export type SectionId = (typeof SECTION_IDS)[number];
export type ActiveNavItem = SectionId | "blog" | "download" | null;

function isSectionId(value: string): value is SectionId {
  return SECTION_IDS.some((id) => id === value);
}

export function getActiveNavItem(pathname: string, hash: string): ActiveNavItem {
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return "blog";
  if (pathname === "/download") return "download";
  if (pathname !== "/") return null;

  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  return isSectionId(id) ? id : null;
}
