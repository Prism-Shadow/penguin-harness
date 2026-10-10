/**
 * Settings dialog: one popup holding the settings that used to sit as separate rows
 * in the sidebar user menu, on the PagedDialog shell (left rail of pages, ChatGPT-style
 * rows on the right). The rail is grouped — Personal for the viewer's own preferences,
 * Server for the server-global settings an admin writes — and both the rail and the pane
 * go through visibleSettingsSections, so a viewer neither sees a page they may not open
 * nor lands on one: the active page is re-resolved against that list on every render, and
 * anything not on it falls back to the first page they can actually open.
 *
 * A page with a typed form registers it under the dialog's scope while it holds unsaved
 * edits, and both ways of leaving that page ask first: switching pages on the rail (which
 * unmounts the page and its drafts) and closing the dialog by Esc, the ×, or a press on the
 * scrim. Switches, selects and other instant controls never make a page dirty.
 */
import { useEffect, useState } from "react";
import { ICONS, PagedDialog, guardLeave, useGuardedClose } from "@prismshadow/penguin-ui";
import type { PagedDialogGroup } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../../lib/settings-sections";
import type { SettingsGroupKey, SettingsSectionKey } from "../../lib/settings-sections";
import { SETTINGS_SCOPE } from "../../lib/unsaved/scopes";
import { useAuth } from "../../state/auth";
import { ProfileSection } from "./profile-section";
import { GeneralSection } from "./general-section";
import { AppearanceSection } from "./appearance-section";
import { ShortcutsSection } from "./shortcuts-section";
import { AccountSection } from "./account-section";
import { ProxySection } from "./proxy-section";
import { UploadsSection } from "./uploads-section";
import { CompanySection } from "./company-section";
import { BrowserSection } from "./browser-section";
import { ChromeExtensionSection } from "./chrome-extension-section";
import { AgentApiSection } from "./agent-api-section";
import { PluginsSection } from "./plugins-section";
import { AdminUsersSection } from "../admin/admin-users-page";

/** Rail glyphs (see NAV_ICONS' conventions). */
const SECTION_ICONS: Record<SettingsSectionKey, string> = {
  /** Person in a circle: the account's own identity, distinct from the bust used for credentials. */
  profile: ICONS.userCircle,
  general: ICONS.gear,
  /** Sun: appearance. */
  appearance: ICONS.sun,
  /** Keyboard: shortcuts. */
  shortcuts: ICONS.keyboard,
  /** Single person: the signed-in account. */
  account: ICONS.user,
  /** A browser window: the agent browser. */
  browser: ICONS.appWindow,
  /** Globe: outbound traffic. */
  proxy: ICONS.globe,
  /** Up arrow over a base: uploads. */
  uploads: ICONS.arrowUpFromLine,
  /** The building the mode switch wears: company mode. */
  company: ICONS.building,
  /** Plug: whether users may connect their Chrome. */
  chromeExtension: ICONS.plug,
  /** Angle brackets: programs calling the Agents. The plug that marks the API elsewhere is taken here, by the Chrome page above. */
  agentApi: ICONS.angleBrackets,
  /** Puzzle piece: plugins, the plugin library's own mark. */
  plugins: ICONS.puzzle,
  /** Two people: user management. */
  users: ICONS.users,
};

export function SettingsDialog({
  open,
  onClose,
  section,
  pluginFocus,
}: {
  open: boolean;
  onClose: () => void;
  /** The page an opening starts on; a page this viewer may not open falls back like any other. */
  section?: SettingsSectionKey;
  /** On the Plugins page: the card an opening scrolls to (e.g. `sandbox`). */
  pluginFocus?: string;
}) {
  // uploadLimits feeds the Upload limits page's "?" (sectionInfo below); the rest pick pages.
  const { user, desktopMode, sessionVia, uploadLimits } = useAuth();
  const sections = visibleSettingsSections({
    isAdmin: user?.isAdmin === true,
    desktopMode,
    sessionVia,
  });
  const [active, setActive] = useState<SettingsSectionKey | null>(null);
  const requestClose = useGuardedClose(onClose, SETTINGS_SCOPE);

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
    shortcuts: S.settings.shortcutsTitle,
    account: S.settings.accountTitle,
    browser: S.settings.browserTitle,
    proxy: S.settings.proxyTitle,
    uploads: S.settings.uploadLimitsTitle,
    company: S.settings.companyModeTitle,
    chromeExtension: S.settings.chromeExtensionTitle,
    agentApi: S.settings.agentApiTitle,
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
    shortcuts: S.settings.shortcutsInfo,
    proxy: S.settings.proxyInfo,
    uploads: S.settings.uploadLimitsInfo(uploadLimits.attachmentMaxCount, uploadLimits.imageMaxMb),
    company: S.settings.companyModeServerInfo,
    chromeExtension: S.settings.chromeExtensionInfo,
    agentApi: S.settings.agentApiHint,
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
          icon: SECTION_ICONS[s.key],
          ...(sectionInfo[s.key] !== undefined ? { info: sectionInfo[s.key] } : {}),
        })),
    }),
  );

  return (
    <PagedDialog
      open={open}
      onClose={requestClose}
      title={S.settings.title}
      groups={groups}
      active={current}
      onSelect={(key) => {
        if (key !== current) void guardLeave(() => setActive(key), SETTINGS_SCOPE);
      }}
    >
      {current === "profile" && <ProfileSection />}
      {current === "general" && <GeneralSection />}
      {current === "appearance" && <AppearanceSection />}
      {current === "shortcuts" && <ShortcutsSection />}
      {current === "account" && <AccountSection />}
      {current === "browser" && <BrowserSection />}
      {current === "proxy" && <ProxySection />}
      {current === "uploads" && <UploadsSection />}
      {current === "company" && <CompanySection />}
      {current === "chromeExtension" && <ChromeExtensionSection />}
      {current === "agentApi" && <AgentApiSection />}
      {current === "plugins" && (
        <PluginsSection {...(pluginFocus !== undefined ? { focus: pluginFocus } : {})} />
      )}
      {current === "users" && <AdminUsersSection />}
    </PagedDialog>
  );
}
