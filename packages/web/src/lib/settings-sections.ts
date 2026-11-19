/**
 * The Settings dialog's pages, and who may see each one.
 *
 * Server-global pages write through /api/admin/settings (or the admin user routes) and
 * belong to admins alone; the personal pages are per-user preferences every signed-in user
 * owns. Two pages additionally depend on how this session runs: the account page only
 * exists where a password can be changed (see offersChangePassword), and user management
 * disappears in desktop mode, where the app is single-user. The profile page is neither — an
 * avatar and a nickname are display data, so every signed-in session may set them. Updating
 * and the credits are not pages here — both live in the App info dialog, opened from the
 * sidebar user menu. The rules live here rather than inside the dialog because this package's
 * vitest runs in Node with no DOM — a pure function is the only thing a test can pin directly
 * — and because rail and content have to apply the same rule to avoid a visible-but-forbidden
 * entry.
 *
 * A page the viewer may not open is dropped from the list entirely rather than rendered
 * disabled: a greyed-out "Proxy" row still tells a non-admin the setting exists and that
 * someone else can reach it.
 *
 * Other modules add pages of their own (`SettingsModule.sections`): each brings its key, group,
 * visibility and place (`order`), and joins the rail among the app's pages by that place, its
 * group kept contiguous. The rule here treats a contributed page exactly like one of the app's.
 *
 * None of this is the boundary. The admin APIs answer a non-admin with 403 whatever the
 * browser chose to render.
 */
import type { SettingsSectionData } from "@prismshadow/penguin-web-plugin";
import { offersChangePassword, type AccountMenuSession } from "./account-menu";

/**
 * A contributed page's key. Branded, so the app's own code still names only its own pages and a
 * mistyped one is a type error; a contributed key enters through the contribution's data or the
 * plugin face's `requestSettings` (lib/settings-request.ts).
 */
export type ContributedSettingsKey = string & { readonly __contributedSettingsKey: true };

/** A page of the Settings dialog: one of the app's own, or one another module contributed. */
export type SettingsSectionKey = HostSettingsSectionKey | ContributedSettingsKey;

/** The app's own pages. */
export type HostSettingsSectionKey =
  | "profile"
  | "general"
  | "appearance"
  | "shortcuts"
  | "archived"
  | "account"
  | "proxy"
  | "uploads"
  | "company"
  | "agentApi"
  | "plugins"
  | "users";

/** Rail heading a page sits under: the viewer's own preferences vs. the whole server's. */
export type SettingsGroupKey = "personal" | "server";

export interface SettingsSection {
  readonly key: SettingsSectionKey;
  readonly group: SettingsGroupKey;
}

/** The rail's groups, in the order their headings are drawn. */
const GROUP_ORDER: Readonly<Record<SettingsGroupKey, number>> = { personal: 0, server: 1 };

/** Who is looking, and from where — the union of what the visibility rules consume. */
export interface SettingsViewer extends AccountMenuSession {
  readonly isAdmin: boolean;
}

type SectionRule = SettingsSection & { order: number; visible(viewer: SettingsViewer): boolean };

/**
 * The app's own pages, each with its place and visibility rule. The places leave room between
 * them for contributed pages (the agent browser's sits at 70 and 140).
 */
const SECTION_RULES: readonly SectionRule[] = [
  // Heads the personal group, and unlike the account page below it is visible in every
  // session: a nickname and an avatar need no password to change, so the desktop shell's
  // own window — which for some installs is the only session there is — keeps it.
  { key: "profile", group: "personal", order: 10, visible: () => true },
  { key: "general", group: "personal", order: 20, visible: () => true },
  { key: "appearance", group: "personal", order: 30, visible: () => true },
  // Keyboard shortcuts are the account's, and apply in every session of it.
  { key: "shortcuts", group: "personal", order: 40, visible: () => true },
  // The conversations not in the sidebar — archived by hand, or opened by a program and not
  // kept — across every Project the user can open: theirs in every session.
  { key: "archived", group: "personal", order: 50, visible: () => true },
  // The desktop shell's own window has no password to change; a password-established
  // session against the same server still does. Same predicate as the old menu row.
  { key: "account", group: "personal", order: 60, visible: (v) => offersChangePassword(v) },
  { key: "proxy", group: "server", order: 110, visible: (v) => v.isAdmin },
  { key: "uploads", group: "server", order: 120, visible: (v) => v.isAdmin },
  // The company-mode master switch: server-global like the proxy and upload limits.
  { key: "company", group: "server", order: 130, visible: (v) => v.isAdmin },
  // Whether any Agent's public API answers at all: server-global, like company mode.
  { key: "agentApi", group: "server", order: 150, visible: (v) => v.isAdmin },
  // The sandbox, and the options loaded plugins declare (server-global, like the plugins themselves).
  { key: "plugins", group: "server", order: 160, visible: (v) => v.isAdmin },
  // Single-user under the desktop shell: the server rejects the admin user routes there.
  { key: "users", group: "server", order: 170, visible: (v) => v.isAdmin && !v.desktopMode },
];

/** A contributed page as the rule judges it: everyone sees it, or admins alone. */
function ruleOf(section: SettingsSectionData): SectionRule {
  return {
    key: section.key as ContributedSettingsKey,
    group: section.group,
    order: section.order,
    visible: section.visibility === "admin" ? (v) => v.isAdmin : () => true,
  };
}

/**
 * The pages this viewer may open, in rail order: the app's own and the `contributed` ones, by
 * group and then by place, so the pages of one group stay contiguous — the rail renders this list
 * top to bottom and starts a heading wherever the group changes. A contributed page whose key the
 * app already uses is dropped.
 */
export function visibleSettingsSections(
  viewer: SettingsViewer,
  contributed: readonly SettingsSectionData[] = [],
): readonly SettingsSection[] {
  const own = new Set<string>(SECTION_RULES.map((rule) => rule.key));
  return [...SECTION_RULES, ...contributed.filter((c) => !own.has(c.key)).map(ruleOf)]
    .filter((section) => section.visible(viewer))
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || a.order - b.order)
    .map(({ key, group }) => ({ key, group }));
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
  const requested = sections.find((section) => section.key === raw);
  return requested?.key ?? sections[0]?.key ?? null;
}
