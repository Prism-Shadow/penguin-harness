/**
 * The System settings dialog's pages, and who may see each one.
 *
 * Server-global pages write through /api/admin/settings (or the admin user routes) and
 * belong to admins alone; the personal pages are per-user preferences every signed-in user
 * owns. Two pages additionally depend on how this session runs: the account page only
 * exists where a password can be changed (see offersChangePassword), and user management
 * disappears in desktop mode, where the app is single-user. Updating is not a page here at
 * all — both the server check and the desktop client's live in the sidebar user menu, under
 * the entry that opens this dialog. The rules live here rather than inside the dialog
 * because this package's vitest runs in Node with no DOM — a pure function is the only
 * thing a test can pin directly — and because rail and content have to apply the same rule
 * to avoid a visible-but-forbidden entry.
 *
 * A page the viewer may not open is dropped from the list entirely rather than rendered
 * disabled: a greyed-out "Proxy" row still tells a non-admin the setting exists and that
 * someone else can reach it.
 *
 * None of this is the boundary. The admin APIs answer a non-admin with 403 whatever the
 * browser chose to render.
 */
import { offersChangePassword } from "./account-menu";
import type { AccountMenuSession } from "./account-menu";

/** A page of the System settings dialog. */
export type SettingsSectionKey =
  "general" | "appearance" | "account" | "proxy" | "uploads" | "sharing" | "sandbox" | "users";

/** Rail heading a page sits under: the viewer's own preferences vs. the whole server's. */
export type SettingsGroupKey = "personal" | "server";

export interface SettingsSection {
  readonly key: SettingsSectionKey;
  readonly group: SettingsGroupKey;
}

/** Who is looking, and from where — the union of what the visibility rules consume. */
export interface SettingsViewer extends AccountMenuSession {
  readonly isAdmin: boolean;
}

/**
 * Every page in rail order, with its visibility rule. Pages of one group stay contiguous —
 * the rail renders this list top to bottom and starts a heading wherever the group changes.
 */
const SECTION_RULES: ReadonlyArray<SettingsSection & { visible(viewer: SettingsViewer): boolean }> =
  [
    { key: "general", group: "personal", visible: () => true },
    { key: "appearance", group: "personal", visible: () => true },
    // The desktop shell's own window has no password to change; a password-established
    // session against the same server still does. Same predicate as the old menu row.
    { key: "account", group: "personal", visible: (v) => offersChangePassword(v) },
    { key: "proxy", group: "server", visible: (v) => v.isAdmin },
    { key: "uploads", group: "server", visible: (v) => v.isAdmin },
    { key: "sharing", group: "server", visible: (v) => v.isAdmin },
    { key: "sandbox", group: "server", visible: (v) => v.isAdmin },
    // Single-user under the desktop shell: the server rejects the admin user routes there.
    { key: "users", group: "server", visible: (v) => v.isAdmin && !v.desktopMode },
  ];

/** The pages this viewer may open, in rail order. */
export function visibleSettingsSections(viewer: SettingsViewer): readonly SettingsSection[] {
  return SECTION_RULES.filter((section) => section.visible(viewer)).map(({ key, group }) => ({
    key,
    group,
  }));
}

/**
 * The group headings to draw for `sections`, in order and without repeats. A viewer left
 * with a single group gets one entry, which the rail takes as its cue to draw no heading
 * at all — a lone "Personal" heading implies the other group.
 */
export function settingsGroups(sections: readonly SettingsSection[]): readonly SettingsGroupKey[] {
  const seen: SettingsGroupKey[] = [];
  for (const section of sections) if (!seen.includes(section.group)) seen.push(section.group);
  return seen;
}

/**
 * Requested page -> the page to render. An unknown request and one naming a page this
 * viewer may not open resolve identically, to the first visible page: nothing about what a
 * different account would have found there leaks. Null only when nothing is visible.
 */
export function resolveSettingsSection(
  raw: string | null | undefined,
  sections: readonly SettingsSection[],
): SettingsSectionKey | null {
  if (sections.some((section) => section.key === raw)) return raw as SettingsSectionKey;
  return sections[0]?.key ?? null;
}
