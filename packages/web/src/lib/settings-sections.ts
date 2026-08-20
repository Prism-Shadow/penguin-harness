/**
 * The System settings surface's sub-pages, and who may see each one.
 *
 * Two of the three sub-pages write server-global settings through /api/admin/settings and
 * belong to admins alone; the third is a per-user preference every signed-in user owns. The
 * rule lives here rather than inside the page for two reasons: this package's vitest runs in
 * Node with no DOM, so a pure function is the only thing a test can pin directly; and both
 * the sub-nav and the `:section` path segment have to apply the same rule, which is exactly
 * how a surface ends up with a visible-but-forbidden entry when each side re-derives it.
 *
 * A section the viewer may not open is dropped from the list entirely rather than rendered
 * disabled: a greyed-out "Proxy" row still tells a non-admin the setting exists and that
 * someone else can reach it.
 *
 * None of this is the boundary. GET and PUT /api/admin/settings answer a non-admin with 403
 * whatever the browser chose to render.
 */

/** A sub-page of the System settings surface; also its `/settings/:section` path segment. */
export type SettingsSectionKey = "general" | "proxy" | "uploads";

/** Sub-nav heading a section sits under: the viewer's own preferences vs. the whole server's. */
export type SettingsGroupKey = "personal" | "server";

export interface SettingsSection {
  readonly key: SettingsSectionKey;
  readonly group: SettingsGroupKey;
  /** Written through /api/admin/settings, so only an admin may open it. */
  readonly adminOnly: boolean;
}

/**
 * Every section, in sub-nav order. Sections of one group stay contiguous — the sub-nav
 * renders this list top to bottom and starts a heading wherever the group changes.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { key: "general", group: "personal", adminOnly: false },
  { key: "proxy", group: "server", adminOnly: true },
  { key: "uploads", group: "server", adminOnly: true },
];

/** The sections this viewer may open, in sub-nav order. */
export function visibleSettingsSections(viewer: { isAdmin: boolean }): readonly SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => !section.adminOnly || viewer.isAdmin);
}

/**
 * The group headings to draw for `sections`, in order and without repeats. A viewer left
 * with a single group gets one entry, which the sub-nav takes as its cue to draw no heading
 * at all — a lone "Personal" heading implies the other group.
 */
export function settingsGroups(sections: readonly SettingsSection[]): readonly SettingsGroupKey[] {
  const seen: SettingsGroupKey[] = [];
  for (const section of sections) if (!seen.includes(section.group)) seen.push(section.group);
  return seen;
}

/**
 * `:section` path segment -> the section to render. An unknown segment and one naming a
 * section this viewer may not open resolve identically, to the first visible section: a
 * non-admin typing /settings/proxy lands on their own first sub-page, learning nothing about
 * what a different account would have found there. Null only when nothing is visible.
 *
 * The caller compares the result with what it passed in: a differing answer means the
 * address is wrong for this viewer and should be replaced rather than merely re-rendered.
 */
export function resolveSettingsSection(
  raw: string | null | undefined,
  sections: readonly SettingsSection[],
): SettingsSectionKey | null {
  if (sections.some((section) => section.key === raw)) return raw as SettingsSectionKey;
  return sections[0]?.key ?? null;
}
