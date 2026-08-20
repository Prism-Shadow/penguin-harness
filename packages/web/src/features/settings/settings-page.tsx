/**
 * System settings (/settings/:section): one surface holding the settings that used to sit as
 * separate rows in the sidebar user menu. A left sub-nav switches sub-pages; each sub-page owns
 * its own form semantics, so a personal preference can apply on the spot while a server-global
 * one saves explicitly.
 *
 * The sub-nav is grouped — Personal for the viewer's own preferences, Server for the
 * server-global settings an admin writes through /api/admin/settings. Both the sub-nav and the
 * `:section` segment go through visibleSettingsSections, so a non-admin neither sees the Server
 * group nor reaches it by typing its path: an unknown or forbidden segment is replaced with the
 * first section they can actually open. A viewer left with one group gets no heading at all —
 * a lone "Personal" would announce that a second group exists somewhere.
 *
 * Deep-linkable on purpose: a settings entry can be pointed at ("/settings/proxy"), the browser's
 * back button leaves the surface the way it arrived, and the sub-nav has room to grow past what a
 * dropdown row or a modal's left rail would hold.
 */
import { useMemo } from "react";
import { Navigate, NavLink, useParams } from "react-router";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import {
  resolveSettingsSection,
  settingsGroups,
  visibleSettingsSections,
} from "../../lib/settings-sections";
import type { SettingsGroupKey, SettingsSectionKey } from "../../lib/settings-sections";
import { useAuth } from "../../state/auth";
import { GeneralSection } from "./general-section";
import { ProxySection } from "./proxy-section";
import { UploadsSection } from "./uploads-section";

/** Sub-nav entry: solid gray fill when active, gray hover otherwise (the sidebar's convention). */
const navItemClass = (active: boolean) =>
  `block whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
    active
      ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200"
  }`;

export function SettingsPage() {
  useDocumentTitle(S.settings.systemSettings);
  const { user } = useAuth();
  const { section } = useParams();
  const isAdmin = user?.isAdmin === true;
  const sections = useMemo(() => visibleSettingsSections({ isAdmin }), [isAdmin]);
  const active = resolveSettingsSection(section ?? null, sections);

  // Read inside the component: after a language switch remount, these pick up the current dictionary.
  const sectionLabel: Record<SettingsSectionKey, string> = {
    general: S.settings.generalTitle,
    proxy: S.settings.proxyTitle,
    uploads: S.settings.uploadLimitsTitle,
  };
  const groupLabel: Record<SettingsGroupKey, string> = {
    personal: S.settings.groupPersonal,
    server: S.settings.groupServer,
  };

  // Nothing this viewer may open: leave rather than render an empty shell. Unreachable while
  // the Personal group exists for every account, and cheaper to keep than to prove.
  if (active === null) return <Navigate to="/chat" replace />;
  // The address named a section this viewer cannot open (or none at all): correct it rather
  // than rendering a different section than the URL claims.
  if (active !== section) return <Navigate to={`/settings/${active}`} replace />;

  const groups = settingsGroups(sections);
  const showGroupHeadings = groups.length > 1;

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-4 text-xl font-semibold">{S.settings.systemSettings}</h1>
        <div className="flex flex-col gap-4 md:flex-row md:gap-6">
          {/* Vertical rail on desktop; a horizontal scroller on narrow screens, where the
              group headings are dropped along with the second dimension (Tabs' convention). */}
          <nav
            aria-label={S.settings.systemSettings}
            className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-44 md:flex-col md:overflow-x-visible md:pb-0"
          >
            {groups.map((group) => (
              // display:contents on mobile folds the entries straight into the scroller row;
              // the desktop rail gets the group as a real block, spaced from the one above it.
              <div key={group} className="contents md:mt-3 md:block md:first:mt-0">
                {showGroupHeadings && (
                  <p className="hidden px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 md:block dark:text-gray-500">
                    {groupLabel[group]}
                  </p>
                )}
                {sections
                  .filter((s) => s.group === group)
                  .map((s) => (
                    <NavLink
                      key={s.key}
                      to={`/settings/${s.key}`}
                      className={({ isActive }) => navItemClass(isActive)}
                    >
                      {sectionLabel[s.key]}
                    </NavLink>
                  ))}
              </div>
            ))}
          </nav>

          <div className="min-w-0 flex-1">
            {active === "general" && <GeneralSection />}
            {active === "proxy" && <ProxySection />}
            {active === "uploads" && <UploadsSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
