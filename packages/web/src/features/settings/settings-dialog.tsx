/**
 * Settings dialog: one popup holding the settings that used to sit as separate rows
 * in the sidebar user menu, on the PagedDialog shell (left rail of pages, ChatGPT-style
 * rows on the right). The rail is grouped — Personal for the viewer's own preferences,
 * Server for the server-global settings an admin writes — and both the rail and the pane
 * go through visibleSettingsSections, so a viewer neither sees a page they may not open
 * nor lands on one: the active page is re-resolved against that list on every render, and
 * anything not on it falls back to the first page they can actually open.
 */
import { useEffect, useState } from "react";
import { S } from "../../lib/strings";
import {
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../../lib/settings-sections";
import type { SettingsGroupKey, SettingsSectionKey } from "../../lib/settings-sections";
import { useAuth } from "../../state/auth";
import { PagedDialog } from "../../components/ui/paged-dialog";
import type { PagedDialogGroup } from "../../components/ui/paged-dialog";
import { Icon } from "../../components/ui/group-list";
import { COMPANY_MODE_ICON, GEAR_ICON } from "../../components/ui/icons";
import { ProfileSection } from "./profile-section";
import { GeneralSection } from "./general-section";
import { AppearanceSection } from "./appearance-section";
import { AccountSection } from "./account-section";
import { ProxySection } from "./proxy-section";
import { UploadsSection } from "./uploads-section";
import { CompanySection } from "./company-section";
import { SandboxSection } from "./sandbox-section";
import { PluginsSection } from "./plugins-section";
import { AdminUsersSection } from "../admin/admin-users-page";

/** Rail glyphs, on the shared 24x24 stroke grid (see NAV_ICONS' conventions). */
const SECTION_ICONS: Record<SettingsSectionKey, string> = {
  /** Person in a circle: the account's own identity, distinct from the bust used for credentials. */
  profile:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6.2 18.4a6 6 0 0 1 11.6 0",
  general: GEAR_ICON,
  /** Sun: appearance. */
  appearance:
    "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4",
  /** Single person: the signed-in account. */
  account: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  /** Globe: outbound traffic. */
  proxy:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 0 0 18M12 3a15 15 0 0 1 0 18",
  /** Up arrow over a base: uploads. */
  uploads: "M12 15V4m0 0L7 9m5-5l5 5M4 20h16",
  /** The building the mode switch wears: company mode. */
  company: COMPANY_MODE_ICON,
  /** Shield: confinement. */
  sandbox: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z",
  /** Puzzle piece: plugins. */
  plugins:
    "M10 4a2 2 0 1 1 4 0v2h3a1 1 0 0 1 1 1v3h-2a2 2 0 1 0 0 4h2v3a1 1 0 0 1-1 1h-3v-2a2 2 0 1 0-4 0v2H7a1 1 0 0 1-1-1v-3h2a2 2 0 1 0 0-4H6V7a1 1 0 0 1 1-1h3V4z",
  /** Two people: user management. */
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
};

export function SettingsDialog({
  open,
  onClose,
  section,
}: {
  open: boolean;
  onClose: () => void;
  /** The page an opening starts on; a page this viewer may not open falls back like any other. */
  section?: SettingsSectionKey;
}) {
  // uploadLimits feeds the Upload limits page's "?" (sectionInfo below); the rest pick pages.
  const { user, desktopMode, sessionVia, uploadLimits } = useAuth();
  const sections = visibleSettingsSections({
    isAdmin: user?.isAdmin === true,
    desktopMode,
    sessionVia,
  });
  const [active, setActive] = useState<SettingsSectionKey | null>(null);

  // Each opening starts on the requested page, or the viewer's first: `current` below
  // resolves the choice against the live list. Deliberately keyed on `open` (and the
  // request) alone — re-running on every sections identity change would yank the user off a
  // page they navigated to.
  useEffect(() => {
    if (open) setActive(section ?? null);
  }, [open, section]);

  const current = resolveSettingsSection(active, sections);
  if (current === null) return null;

  // Read inside the component: after a language switch remount, these pick up the current dictionary.
  const sectionLabel: Record<SettingsSectionKey, string> = {
    profile: S.settings.profile,
    general: S.settings.generalTitle,
    appearance: S.settings.appearanceTitle,
    account: S.settings.accountTitle,
    proxy: S.settings.proxyTitle,
    uploads: S.settings.uploadLimitsTitle,
    company: S.settings.companyModeTitle,
    sandbox: S.settings.sandboxTitle,
    plugins: S.settings.pluginsTitle,
    users: S.admin.users,
  };
  const groupLabel: Record<SettingsGroupKey, string> = {
    personal: S.settings.groupPersonal,
    server: S.settings.groupServer,
  };
  // Page-level explanations, disclosed by the "?" the shell draws beside the pane heading.
  // Pages whose rows explain themselves one by one carry none.
  const sectionInfo: Partial<Record<SettingsSectionKey, string>> = {
    proxy: S.settings.proxyInfo,
    uploads: S.settings.uploadLimitsInfo(uploadLimits.attachmentMaxCount, uploadLimits.imageMaxMb),
    company: S.settings.companyModeServerInfo,
    sandbox: S.settings.sandboxInfo,
    plugins: S.settings.pluginsInfo,
  };

  const groups: Array<PagedDialogGroup<SettingsSectionKey>> = settingsGroups(sections).map(
    (group) => ({
      key: group,
      label: groupLabel[group],
      items: sections
        .filter((s) => s.group === group)
        .map((s) => ({
          key: s.key,
          label: sectionLabel[s.key],
          icon: <Icon d={SECTION_ICONS[s.key]} size={16} />,
          ...(sectionInfo[s.key] !== undefined ? { info: sectionInfo[s.key] } : {}),
        })),
    }),
  );

  return (
    <PagedDialog
      open={open}
      onClose={onClose}
      title={S.settings.title}
      groups={groups}
      active={current}
      onSelect={setActive}
    >
      {current === "profile" && <ProfileSection />}
      {current === "general" && <GeneralSection />}
      {current === "appearance" && <AppearanceSection />}
      {current === "account" && <AccountSection />}
      {current === "proxy" && <ProxySection />}
      {current === "uploads" && <UploadsSection />}
      {current === "company" && <CompanySection />}
      {current === "sandbox" && <SandboxSection />}
      {current === "plugins" && <PluginsSection />}
      {current === "users" && <AdminUsersSection />}
    </PagedDialog>
  );
}
