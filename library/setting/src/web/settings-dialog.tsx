/**
 * Settings dialog: one popup holding the settings that used to sit as separate rows
 * in the sidebar user menu, on the PagedDialog shell (left rail of pages, ChatGPT-style
 * rows on the right). The rail is grouped — Personal for the viewer's own preferences,
 * Server for the server-global settings an admin writes — and both the rail and the pane
 * go through visibleSettingsSections, so a viewer neither sees a page they may not open
 * nor lands on one: the active page is re-resolved against that list on every render, and
 * anything not on it falls back to the first page they can actually open.
 *
 * Last on the rail, under its own heading, a page per plugin that has options for this viewer
 * (lib/plugin-pages.ts; plugin-page.tsx draws one). Which plugins have pages, and their names,
 * come from reads made once per opening (plugin-pages-index.ts); the group appears when this
 * server's have answered, all at once, and a plugin only a machine has joins it once that machine
 * answers. A request naming a plugin page — its `plugin:<package>` key, the key a
 * contributed page had before it joined its plugin's page, or the plugin management page focused
 * on a settings group a plugin page now draws — opens that page, scrolled to the part it named;
 * until the pages are known it shows an empty pane rather than another page. The host's module
 * requests page carries the count of requests waiting on this server on its rail row.
 *
 * A page with a typed form registers it under the dialog's scope while it holds unsaved
 * edits, and both ways of leaving that page ask first: switching pages on the rail (which
 * unmounts the page and its drafts) and closing the dialog by Esc, the ×, or a press on the
 * scrim. Switches, selects and other instant controls never make a page dirty. A page's Save
 * registers under the same scope while it is in flight (`useSaving`), and the dialog's close
 * does nothing until it answers; an instant control's write holds nothing.
 */
import { useEffect, useState } from "react";
import {
  Count,
  ICON_SIZE,
  ICONS,
  PagedDialog,
  guardLeave,
  useGuardedClose,
  type PagedDialogGroup,
  type PagedDialogItem,
} from "@prismshadow/penguin-ui";
import { webLocale } from "@prismshadow/penguin-web-plugin";

import {
  S,
  glyphOf,
  useModuleGates,
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
  type HostSettingsSectionKey,
  type SettingsGroupKey,
  type SettingsSectionKey,
  localizedText,
  useAuth,
  useSessionsIfAny,
  AdminUsersSection,
} from "@prismshadow/penguin-web/internal";

import { SETTINGS_SCOPE } from "./lib/unsaved/scopes";
import { mayNamePluginPage, pluginPageTarget, pluginPages } from "./lib/plugin-pages";
import { ProfileSection } from "./profile-section";
import { GeneralSection } from "./general-section";
import { AppearanceSection } from "./appearance-section";
import { ShortcutsSection } from "./shortcuts-section";
import { ArchivedSessionsSection } from "./archived-sessions-section";
import { AccountSection } from "./account-section";
import { ProxySection } from "./proxy-section";
import { ResourceLimitsSection } from "./resource-limits-section";
import { UploadsSection } from "./uploads-section";
import { CompanySection } from "./company-section";
import { AgentApiSection } from "./agent-api-section";
import { PluginsSection } from "./plugins-section";
import { ModuleRequestsPage, useModuleRequestsWaiting } from "./module-requests-page";
import { shownSections } from "./contributed-sections";
import { usePluginPagesIndex } from "./plugin-pages-index";
import { PluginPageBody, PluginPageHeading, PluginPageIcon } from "./plugin-page";
import { SettingsNavigationProvider } from "./settings-navigation";
import { SANDBOX_GROUP } from "./plugin-config-groups";

/** Rail glyphs of the app's own pages (see NAV_ICONS' conventions); a contributed page names its own. */
const SECTION_ICONS: Record<HostSettingsSectionKey, string> = {
  /** Person in a circle: the account's own identity, distinct from the bust used for credentials. */
  profile: ICONS.userCircle,
  general: ICONS.gear,
  /** Sun: appearance. */
  appearance: ICONS.sun,
  /** Keyboard: shortcuts. */
  shortcuts: ICONS.keyboard,
  /** The archive box the sidebar row's archive action wears: archived chats. */
  archived: ICONS.archive,
  /** Single person: the signed-in account. */
  account: ICONS.user,
  /** Globe: outbound traffic. */
  proxy: ICONS.globe,
  /** Up arrow over a base: uploads. */
  uploads: ICONS.arrowUpFromLine,
  resourceLimits: ICONS.terminalPrompt,
  /** The building the mode switch wears: company mode. */
  company: ICONS.building,
  /** Angle brackets: programs calling the Agents. The plug that marks the API elsewhere is taken here, by the Chrome extension's page. */
  agentApi: ICONS.angleBrackets,
  /** Puzzle piece: where plugins come from, the plugin library's own mark. */
  plugins: ICONS.puzzle,
  /** A raised hand: members asking for a plugin's server module, the waiting rows' own mark. */
  moduleRequests: ICONS.hand,
  /** The half-filled shield the composer's permission button wears: the sandbox Agents run in. */
  sandbox: ICONS.shieldHalf,
  /** Two people: user management. */
  users: ICONS.users,
};

export function SettingsDialog({
  open,
  onClose,
  section,
  pluginFocus,
  pluginMachine = null,
}: {
  open: boolean;
  onClose: () => void;
  /** The page an opening starts on; a page this viewer may not open falls back like any other. */
  section?: SettingsSectionKey;
  /** On the Plugins page: the card an opening scrolls to (e.g. `sandbox`). */
  pluginFocus?: string;
  /** On the Plugins and Sandbox pages: the machine they open on (null, the default: this server). */
  pluginMachine?: string | null;
}) {
  // uploadLimits feeds the Upload limits page's "?" (sectionInfo below); the rest pick pages.
  const { user, desktopMode, sessionVia, uploadLimits } = useAuth();
  // The language on screen, as the dictionary switch tells it (a remount follows every switch).
  const locale = webLocale();
  const isAdmin = user?.isAdmin === true;
  // A contributed page is there while its module's server half runs; the gates re-render this.
  useModuleGates();
  const contributed = shownSections();
  // The Project's connected machines, whose plugins may have pages too; none outside the providers.
  const machineIds = useSessionsIfAny()?.machineIds;
  const index = usePluginPagesIndex(open, isAdmin, machineIds);
  /** Requests waiting on this server: the module requests row's count. */
  const waitingModules = useModuleRequestsWaiting(isAdmin && open);
  const pages =
    index === null ? [] : pluginPages({ isAdmin, locale, sections: contributed, ...index });
  const sections = visibleSettingsSections(
    { isAdmin, desktopMode, sessionVia },
    contributed.map((c) => c.data),
    pages,
  );
  const contributedByKey = new Map(contributed.map((c) => [c.data.key, c]));
  const [active, setActive] = useState<SettingsSectionKey | null>(null);
  /** The opening's card focus on the plugin management page, until the viewer picks a page. */
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const requestClose = useGuardedClose(onClose, SETTINGS_SCOPE);

  // Each opening starts on the requested page, or the viewer's first: `current` below
  // resolves the choice against the live list. Deliberately keyed on `open` (and the
  // request) alone — re-running on every sections identity change would yank the user off a
  // page they navigated to.
  useEffect(() => {
    if (open) {
      setActive(section ?? null);
      setFocus(pluginFocus);
    }
  }, [open, section, pluginFocus]);

  // A request naming a plugin page (or a part of one) lands there; one that may name a plugin
  // page waits for the pages rather than falling back to the first page.
  // The plugin sources page focused on the sandbox's group (the composer's old link) is the
  // sandbox's page now; focused on a group a plugin page draws, that page.
  const sandboxFocus = active === "plugins" && focus === SANDBOX_GROUP;
  const target = sandboxFocus ? null : pluginPageTarget(active, pages, focus);
  const waiting = index === null && mayNamePluginPage(active, contributed);
  const current = waiting
    ? null
    : resolveSettingsSection(sandboxFocus ? "sandbox" : (target?.key ?? active), sections);
  if (current === null && !waiting) return null;
  const currentPage = pages.find((page) => page.key === current);

  // Read inside the component: after a language switch remount, these pick up the current dictionary.
  const sectionLabel: Record<HostSettingsSectionKey, string> = {
    profile: S.settings.profile,
    general: S.settings.generalTitle,
    appearance: S.settings.appearanceTitle,
    shortcuts: S.settings.shortcutsTitle,
    archived: S.settings.archivedTitle,
    account: S.settings.accountTitle,
    proxy: S.settings.proxyTitle,
    uploads: S.settings.uploadLimitsTitle,
    resourceLimits: S.settings.resourceLimits.title,
    company: S.settings.companyModeTitle,
    agentApi: S.settings.agentApiTitle,
    plugins: S.settings.pluginsTitle,
    moduleRequests: S.settings.moduleRequests.title,
    sandbox: S.settings.sandboxTitle,
    users: S.admin.users,
  };
  const groupLabel: Record<SettingsGroupKey, string> = {
    personal: S.settings.groupPersonal,
    server: S.settings.groupServer,
    plugin: S.settings.groupPlugins,
  };
  // Page-level explanations, disclosed by the "?" the shell draws beside the pane heading.
  // Pages whose rows explain themselves one by one carry none.
  const sectionInfo: Partial<Record<HostSettingsSectionKey, string>> = {
    shortcuts: S.settings.shortcutsInfo,
    archived: S.settings.archivedInfo,
    proxy: S.settings.proxyInfo,
    resourceLimits: S.settings.resourceLimits.info,
    uploads: S.settings.uploadLimitsInfo(uploadLimits.attachmentMaxCount, uploadLimits.imageMaxMb),
    company: S.settings.companyModeServerInfo,
    agentApi: S.settings.agentApiHint,
    plugins: S.settings.pluginsInfo,
    moduleRequests: S.settings.moduleRequests.info,
    sandbox: S.settings.sandboxInfo,
  };

  const groups: Array<PagedDialogGroup<SettingsSectionKey>> = settingsGroups(sections).map(
    (group) => ({
      key: group,
      label: groupLabel[group],
      items: sections
        .filter((s) => s.group === group)
        .map((s): PagedDialogItem<SettingsSectionKey> => {
          const plugin = pages.find((p) => p.key === s.key);
          if (plugin !== undefined) {
            const item = plugin.library;
            const about =
              item === undefined || item.description === ""
                ? undefined
                : localizedText(locale, item.description, item.descriptionZh);
            return {
              key: s.key,
              label: plugin.title,
              icon: <PluginPageIcon page={plugin} size={ICON_SIZE.navRow} />,
              heading: <PluginPageHeading page={plugin} />,
              ...(about !== undefined ? { info: about } : {}),
            };
          }
          const page = contributedByKey.get(s.key);
          const own = s.key as HostSettingsSectionKey;
          const info = page !== undefined ? page.code.info?.() : sectionInfo[own];
          // A count while requests wait, with the row named to include it.
          const counted = s.key === "moduleRequests" && waitingModules > 0;
          return {
            key: s.key,
            label: page !== undefined ? page.code.label() : sectionLabel[own],
            icon: page !== undefined ? glyphOf(page.data.icon) : SECTION_ICONS[own],
            ...(info !== undefined ? { info } : {}),
            ...(counted
              ? {
                  badge: <Count n={waitingModules} max={99} />,
                  ariaLabel: S.settings.moduleRequests.waitingCount(waitingModules),
                }
              : {}),
          };
        }),
    }),
  );

  const ContributedBody = current === null ? undefined : contributedByKey.get(current)?.code.Body;
  // Every way to another page goes through the same guard: the rail, and a contributed page's
  // own link to another (`openPage`).
  const goTo = (key: SettingsSectionKey) => {
    if (key !== current)
      void guardLeave(() => {
        setActive(key);
        setFocus(undefined);
      }, SETTINGS_SCOPE);
  };
  const navigation = {
    open: (key: string) => goTo(key as SettingsSectionKey),
    has: (key: string) => sections.some((s) => s.key === key),
  };

  return (
    <SettingsNavigationProvider value={navigation}>
      <PagedDialog
        open={open}
        onClose={requestClose}
        title={S.settings.title}
        groups={groups}
        active={current ?? active ?? ("" as SettingsSectionKey)}
        onSelect={goTo}
      >
        {current === "profile" && <ProfileSection />}
        {current === "general" && <GeneralSection />}
        {current === "appearance" && <AppearanceSection />}
        {current === "shortcuts" && <ShortcutsSection />}
        {current === "archived" && <ArchivedSessionsSection />}
        {current === "account" && <AccountSection />}
        {current === "proxy" && <ProxySection />}
        {current === "uploads" && <UploadsSection />}
        {current === "resourceLimits" && <ResourceLimitsSection />}
        {current === "company" && <CompanySection />}
        {current === "agentApi" && <AgentApiSection />}
        {current === "plugins" && (
          <PluginsSection
            host="sources"
            {...(focus !== undefined ? { focus } : {})}
            machine={pluginMachine}
          />
        )}
        {current === "moduleRequests" && <ModuleRequestsPage />}
        {current === "sandbox" && <PluginsSection host="sandbox" machine={pluginMachine} />}
        {current === "users" && <AdminUsersSection />}
        {ContributedBody !== undefined && (
          <ContributedBody openPage={(key) => goTo(key as SettingsSectionKey)} />
        )}
        {currentPage !== undefined && (
          <PluginPageBody
            key={currentPage.key}
            page={currentPage}
            isAdmin={isAdmin}
            {...(target?.key === currentPage.key && target.anchor !== undefined
              ? { anchor: target.anchor }
              : {})}
          />
        )}
      </PagedDialog>
    </SettingsNavigationProvider>
  );
}
