/**
 * The organization switcher that stands where the Project switcher stands in development
 * mode. The trigger names the open organization with its status dot and, beneath it, the
 * Project it belongs to; the menu lists every organization the user can reach, grouped by
 * Project with a check mark on the open one (picking one opens its all-hands channel), then the two entries that make and shape one —
 * "New organization" (success lands in the CEO's desk session) and "Organization settings".
 * Same Dropdown, same menu rows as the Project switcher, so the two modes read as one shell.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneSurface } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { projectDisplayName, useProject } from "../../state/project";
import { Dropdown } from "../../components/ui/dropdown";
import { Badge } from "../../components/ui/badge";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CheckIcon, ChevronDown, GEAR_ICON, PlusIcon } from "../../components/ui/icons";
import { groupOrganizationsByProject, orgChannelPath, orgKey, parseOrgKey } from "./company-nav";
import { DEFAULT_CHANNEL_ID } from "./channel-list";
import { CreateOrganizationDialog, OrganizationSettingsDialog } from "./org-dialogs";
import { OrgStatusDot } from "./shared";

const menuItemClass = `flex w-full items-center ${ICON_GAP.menu} px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800`;

export function OrgSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const company = useCompany();
  const { projects } = useProject();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const current = company.currentOrg;
  const currentKey = company.currentOrgKey ?? company.lastOrgKey;
  const projectName = (projectId: string) => {
    const p = projects.find((x) => x.projectId === projectId);
    return p ? projectDisplayName(p) : projectId;
  };
  const groups = groupOrganizationsByProject(
    company.organizations,
    projects.map((p) => p.projectId),
  );
  const settingsTarget = parseOrgKey(currentKey);

  const go = (to: string) => {
    navigate(to);
    onNavigate?.();
  };

  const triggerTitle =
    current !== null
      ? S.company.inProject(projectName(current.projectId), current.name)
      : S.company.switcher;
  /**
   * What is waiting in this organization's channels, summed over the ones the user belongs
   * to: mentions first, since they are addressed to it. The list below carries the same
   * numbers per channel — this is the copy that survives the list being scrolled away, and
   * the only one on a phone before the drawer is opened.
   */
  const channelNote =
    company.channelMentions > 0
      ? S.company.channels.badgeMentions(company.channelMentions)
      : company.channelUnread > 0
        ? S.company.channels.badgeUnread(company.channelUnread)
        : null;

  return (
    <>
      <Dropdown
        open={open}
        setOpen={setOpen}
        className="min-w-0 flex-1"
        menuClass="left-0 right-0 top-full mt-1 origin-top"
        button={
          <button
            type="button"
            onClick={() => setOpen(!open)}
            title={channelNote !== null ? `${triggerTitle} · ${channelNote}` : triggerTitle}
            aria-label={channelNote !== null ? `${triggerTitle} · ${channelNote}` : triggerTitle}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
          >
            <span className="min-w-0 flex-1">
              <span className={`flex items-center ${ICON_GAP.row}`}>
                {current !== null && <OrgStatusDot org={current} />}
                <span className="min-w-0 truncate text-base font-semibold leading-tight">
                  {current !== null
                    ? current.name
                    : company.orgsLoaded
                      ? S.company.noOrganizations
                      : S.common.loading}
                </span>
              </span>
              {/* The Project the organization belongs to: the second line, so the name stays the headline. */}
              {current !== null && (
                <span className="block truncate text-[11px] leading-tight text-gray-500 dark:text-gray-400">
                  {projectName(current.projectId)}
                </span>
              )}
            </span>
            {channelNote !== null && (
              <span
                aria-hidden
                className={`shrink-0 rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                  company.channelMentions > 0
                    ? toneSurface.attention
                    : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                }`}
              >
                {company.channelMentions > 0
                  ? `@${company.channelMentions}`
                  : company.channelUnread}
              </span>
            )}
            <span className="text-gray-400">
              <ChevronDown />
            </span>
          </button>
        }
      >
        {groups.map((group) => (
          <div key={group.projectId} role="group" aria-label={projectName(group.projectId)}>
            <p className="px-3.5 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {projectName(group.projectId)}
            </p>
            {group.organizations.map((o) => {
              const key = orgKey(o.projectId, o.orgId);
              const active = key === currentKey;
              return (
                <button
                  key={key}
                  type="button"
                  title={S.company.inProject(projectName(o.projectId), o.name)}
                  aria-current={active ? "true" : undefined}
                  onClick={() => {
                    setOpen(false);
                    go(orgChannelPath(o.projectId, o.orgId, DEFAULT_CHANNEL_ID));
                  }}
                  className={`${menuItemClass} ${active ? "font-semibold" : ""}`}
                >
                  <OrgStatusDot org={o} />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  {o.invalid !== undefined ? (
                    <Badge tone="red">{S.company.orgInvalid}</Badge>
                  ) : o.status === "paused" ? (
                    <Badge tone="amber">{S.company.orgPaused}</Badge>
                  ) : null}
                  {active && (
                    <span className="shrink-0 text-gray-500 dark:text-gray-400">
                      <CheckIcon />
                      <span className="sr-only">{S.company.switcherCurrent}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-3.5 py-2 text-sm text-gray-400 dark:text-gray-500">
            {company.orgsLoaded ? S.company.noOrganizations : S.common.loading}
          </p>
        )}
        <div className="mt-1.5 border-t border-gray-100 pt-1.5 dark:border-gray-800">
          <button
            type="button"
            className={menuItemClass}
            onClick={() => {
              setOpen(false);
              setCreateOpen(true);
            }}
          >
            <span className="shrink-0 text-gray-400 dark:text-gray-500">
              <PlusIcon size={ICON_SIZE.rowLead} />
            </span>
            {S.company.createOrg}
          </button>
          {settingsTarget !== null && (
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                setOpen(false);
                setSettingsOpen(true);
              }}
            >
              <span className="shrink-0 text-gray-400 dark:text-gray-500">
                <GlyphIcon d={GEAR_ICON} size={ICON_SIZE.rowLead} />
              </span>
              {S.company.orgSettings}
            </button>
          )}
        </div>
      </Dropdown>

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(detail) => {
          setCreateOpen(false);
          void company.reloadOrganizations();
          // Creation opens the CEO's desk: land in it so the mission conversation starts now.
          go(
            detail.ceoDeskSessionId !== undefined
              ? `/chat/${detail.ceoDeskSessionId}`
              : orgChannelPath(detail.projectId, detail.orgId, DEFAULT_CHANNEL_ID),
          );
        }}
      />
      {settingsTarget !== null && (
        <OrganizationSettingsDialog
          open={settingsOpen}
          projectId={settingsTarget.projectId}
          orgId={settingsTarget.orgId}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void company.reloadOrganizations()}
          onDeleted={() => {
            setSettingsOpen(false);
            void company.reloadOrganizations();
            go("/org");
          }}
        />
      )}
    </>
  );
}
