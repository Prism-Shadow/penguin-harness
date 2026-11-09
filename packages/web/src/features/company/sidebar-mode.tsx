import { useOrgPages } from "./use-org-pages";
import { useLocale } from "../../state/locale";
import { glyphOf } from "../../lib/nav-icons";
/**
 * Company mode in the sidebar (`SidebarModule.modes` and `.sections`): the work mode beside
 * development, with the organization's six pages and the company-mode pages plugins contribute
 * as its nav rows, and its four sections — the organization switcher where the Project switcher
 * stands; the channel list where the conversation list is (or, with no organization yet, the
 * block that creates one); the organization's ROADMAPS below it, while the roadmaps plugin is
 * there; and the organization's 工位 group, one row per employee's desk, with its Temporary
 * entries.
 */
import { useLocation, useMatch } from "react-router";
import { RailDivider } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { ModeState, SidebarMode, SidebarSection } from "../../lib/sidebar-contributions";
import { useCompany } from "./company-state";
import { CompanyBetaBadge } from "./company-beta";
import { COMPANY_NAV_ICONS } from "./company-nav-icons";
import { COMPANY_NAV_KEYS, isOrgRoute, orgPagePath, parseOrgKey } from "../../lib/company-nav";
import { NoOrganizationsSidebar, OrgSwitcher } from "./org-switcher";
import { ChannelRailRows, ChannelSidebar, DefaultChannelRailRow } from "./channel-sidebar";
import { DeskRailRows, OrgSessionGroups, TempSessionRailRows } from "./org-session-groups";

/** The organization the sidebar points at: the open one, else the one last opened (the switcher names the same). */
function useNavOrg(): { projectId: string; orgId: string } | null {
  const company = useCompany();
  return parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);
}

function useCompanyMode(): ModeState {
  const company = useCompany();
  const location = useLocation();
  const navOrg = useNavOrg();
  const { locale } = useLocale();
  const contributedPages = useOrgPages().filter((page) => page.released);
  return {
    available: company.available,
    current: company.workMode === "company",
    // Company mode enters at `/org` (the organization last opened, else the first);
    // development mode keeps whatever conversation is open and only leaves an organization
    // page, which has no development form.
    select: (on) => {
      company.setWorkMode(on ? "company" : "dev");
      if (on) return "/org";
      return isOrgRoute(location.pathname) ? "/chat" : null;
    },
    // The organization's six pages — channels are not among them, they are the list below —
    // all in the fold, with no pins and no drag. With no organization the six keep their
    // places, disabled: the pages exist, they just have no organization to show yet, and a nav
    // that empties itself reads as a broken shell rather than as an empty one.
    navItems: [
      ...COMPANY_NAV_KEYS.map((key) => ({
        key,
        to: navOrg === null ? null : orgPagePath(navOrg.projectId, navOrg.orgId, key),
        label: S.nav.org[key],
        icon: COMPANY_NAV_ICONS[key],
      })),
      ...contributedPages.map((page) => ({
        key: page.key,
        to:
          navOrg === null
            ? null
            : `/org/${encodeURIComponent(navOrg.projectId)}/${encodeURIComponent(navOrg.orgId)}/${page.path.replace(/^\/+/, "")}`,
        label: (locale === "zh" ? page.titleZh : page.title) ?? page.title ?? page.key,
        icon: glyphOf(page.icon ?? page.key),
      })),
    ],
  };
}

/** The rail's top slot in company mode: the organization's all-hands channel. */
function DefaultChannelRail() {
  return <DefaultChannelRailRow org={useNavOrg()} />;
}

export const companyMode: SidebarMode = {
  useMode: useCompanyMode,
  RailTop: DefaultChannelRail,
  listName: () => S.company.channels.drawerLabel,
  badge: { Node: CompanyBetaBadge, name: () => S.company.beta },
};

export const companySwitcher: SidebarSection = { Full: OrgSwitcher };

function Channels({ onNavigate }: { onNavigate?: () => void }) {
  const navOrg = useNavOrg();
  // No organization to list: the create block, not an empty channel list.
  if (navOrg === null) return <NoOrganizationsSidebar {...(onNavigate ? { onNavigate } : {})} />;
  return (
    <ChannelSidebar
      projectId={navOrg.projectId}
      orgId={navOrg.orgId}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );
}

/**
 * The rail's other channels (the all-hands one has the top slot); each carries its own unread
 * count, and the rows draw their own hairline, only when there are any.
 */
function ChannelsRail() {
  const navOrg = useNavOrg();
  if (navOrg === null) return null;
  return <ChannelRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />;
}

export const companyChannels: SidebarSection = { Full: Channels, Rail: ChannelsRail };

function Desks({ onNavigate }: { onNavigate?: () => void }) {
  const navOrg = useNavOrg();
  const activeSessionId = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  if (navOrg === null) return null;
  return (
    <OrgSessionGroups
      projectId={navOrg.projectId}
      orgId={navOrg.orgId}
      activeSessionId={activeSessionId}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );
}

/** The rail's desks and then its Temporary entries, after a hairline; each carries its running dot. */
function DesksRail() {
  const navOrg = useNavOrg();
  if (navOrg === null) return null;
  return (
    <>
      <RailDivider />
      <DeskRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />
      <TempSessionRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />
    </>
  );
}

export const companyDesks: SidebarSection = { Full: Desks, Rail: DesksRail };
