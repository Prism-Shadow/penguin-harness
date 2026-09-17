/**
 * The announcements on the rotating bar above the landing page's navigation, rendered by
 * components/announcement-bar.tsx. An item's `key` names its copy under `announcement` in
 * strings.ts and strings-en.ts.
 */

/**
 * Where an announcement leads, exactly one of: `to`, a blog post on this site
 * (content/blog/<slug>.*.md) followed through the router, or `href`, a page on
 * another site, opened in a new tab.
 */
type AnnouncementTarget =
  { to: `/blog/${string}`; href?: never } | { href: `https://${string}`; to?: never };

/**
 * Newest first: slide 0 is what a visitor sees before the rotation moves, so the
 * freshest news goes at the front.
 */
export const ANNOUNCEMENTS = [
  { key: "flashModels", to: "/blog/penguinharness-0-2-11" },
  { key: "penguinGo", href: "https://token.penguin.ooo/" },
] as const satisfies ReadonlyArray<{ key: string } & AnnouncementTarget>;

/**
 * A slide as the renderer reads it. Typed against the target union rather than the
 * literal list, so reading `to` and `href` still type-checks while the list holds
 * only one kind.
 */
export type Announcement = { key: (typeof ANNOUNCEMENTS)[number]["key"] } & AnnouncementTarget;
