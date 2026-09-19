/**
 * The organization switcher that stands where the Project switcher stands in development
 * mode. The trigger names the open organization with its status as a text capsule to the right
 * of the name (the name truncates, the capsule never does) and, beneath it, the Project it
 * belongs to; the menu lists every organization the user can reach, grouped by
 * Project with a check mark on the open one (picking one opens its overview), then the two
 * entries that make and shape one — "New organization" (success makes the new organization
 * the shell's current one and lands in its CEO's desk session) and "Organization settings".
 * Same Dropdown, same Menu rows as the Project switcher, so the two modes read as one shell.
 *
 * Beside it lives what the sidebar shows in place of a channel list while the user has no
 * organization at all — the same create dialog, reached from the slot where the list would be.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Badge,
  Button,
  ChevronDown,
  Count,
  Dropdown,
  ICONS,
  ICON_GAP,
  MenuItem,
  MenuLabel,
  MenuRadioItem,
  MenuSeparator,
  SkeletonList,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { nameOnMachine } from "../../lib/workspace-machines";
import { useCompany } from "../../state/company";
import { useSessions } from "../../state/sessions";
import { projectDisplayName, useProject } from "../../state/project";
import { groupOrganizationsByProject, orgKey, orgPagePath, parseOrgKey } from "./company-nav";
import {
  CreateOrganizationDialog,
  OrganizationSettingsDialog,
  useOrganizationCreated,
} from "./org-dialogs";
import { OrgStatusDot, OrgStatusPill, orgStatusText } from "./shared";

export function OrgSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate();
  const company = useCompany();
  // An organization on another machine reads `Name [SSH: alias]`, like a Workspace there; the
  // alias falls back to the machine id when the machine list could not be read.
  const { machineLabels } = useSessions();
  const machineAlias = (machineId: string | null) =>
    machineId === null ? null : (machineLabels.get(machineId) ?? machineId);
  const onOrgCreated = useOrganizationCreated();
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
      ? `${S.company.inProject(projectName(current.projectId), current.name)} · ${orgStatusText(current)}`
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
  const triggerLabel = channelNote !== null ? `${triggerTitle} · ${channelNote}` : triggerTitle;

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
            data-tooltip={triggerLabel}
            // The count beside the name renders aria-hidden — it is a bare `@3` — so the
            // accessible name has to carry the same fact in words.
            aria-label={triggerLabel}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
          >
            <span className="min-w-0 flex-1">
              <span className={`flex items-center ${ICON_GAP.row}`}>
                <span className="min-w-0 truncate text-base font-semibold leading-tight">
                  {current !== null
                    ? current.name
                    : company.orgsLoaded
                      ? S.company.noOrganizations
                      : S.common.loading}
                </span>
                {/* Never shrinks and never wraps: a CJK label would otherwise break per
                    character before the name gave up a single letter. */}
                {current !== null && (
                  <span className="shrink-0 whitespace-nowrap">
                    <OrgStatusPill org={current} />
                  </span>
                )}
              </span>
              {/* The Project the organization belongs to: the second line, so the name stays the headline. */}
              {current !== null && (
                <span className="block truncate text-xs leading-tight text-gray-500 dark:text-gray-400">
                  {projectName(current.projectId)}
                </span>
              )}
            </span>
            {channelNote !== null && (
              <span aria-hidden className="flex shrink-0">
                {company.channelMentions > 0 ? (
                  <Badge tone="attention" size="sm">{`@${company.channelMentions}`}</Badge>
                ) : (
                  <Count n={company.channelUnread} />
                )}
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
            <MenuLabel>{projectName(group.projectId)}</MenuLabel>
            {group.organizations.map((o) => {
              const key = orgKey(o.projectId, o.orgId);
              const active = key === currentKey;
              return (
                <MenuRadioItem
                  key={key}
                  data-tooltip={S.company.inProject(projectName(o.projectId), o.name)}
                  aria-current={active ? "true" : undefined}
                  onSelect={() => {
                    setOpen(false);
                    go(orgPagePath(o.projectId, o.orgId, "overview"));
                  }}
                  glyph={<OrgStatusDot org={o} />}
                  label={
                    <>
                      {nameOnMachine(o.name, machineAlias(o.machineId ?? null))}
                      {active && <span className="sr-only">{S.company.switcherCurrent}</span>}
                    </>
                  }
                  trailing={
                    o.invalid !== undefined ? (
                      <Badge tone="danger">{S.company.orgInvalid}</Badge>
                    ) : o.status === "paused" ? (
                      <Badge tone="attention">{S.company.orgPaused}</Badge>
                    ) : undefined
                  }
                  checked={active}
                />
              );
            })}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="px-3.5 py-2 text-sm text-gray-400 dark:text-gray-500">
            {company.orgsLoaded ? S.company.noOrganizations : S.common.loading}
          </p>
        )}
        <MenuSeparator />
        <MenuItem
          glyph={ICONS.plus}
          label={S.company.createOrg}
          onSelect={() => {
            setOpen(false);
            setCreateOpen(true);
          }}
        />
        {settingsTarget !== null && (
          <MenuItem
            glyph={ICONS.gear}
            label={S.company.orgSettings}
            onSelect={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          />
        )}
      </Dropdown>

      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(detail) => {
          setCreateOpen(false);
          // Creation opens the CEO's desk: land in it so the mission conversation starts now,
          // with the shell already inside the organization that desk belongs to.
          void onOrgCreated(detail).then(() => onNavigate?.());
        }}
      />
      {settingsTarget !== null && (
        <OrganizationSettingsDialog
          open={settingsOpen}
          projectId={settingsTarget.projectId}
          orgId={settingsTarget.orgId}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => void company.reloadOrganizations()}
          // The list drops it, and the shell then moves off its pages by itself (the settled
          // listing no longer holds the current organization).
          onDeleted={() => void company.reloadOrganizations()}
        />
      )}
    </>
  );
}

/**
 * The sidebar's list slot while the user has no organization anywhere: one quiet line and
 * the button that fixes it, in place of a channel list that would have nothing to list (and
 * of the load failure a listing for a deleted organization used to leave there). The six
 * page rows above stay put, disabled — the shell keeps its shape rather than collapsing into
 * something that reads as broken.
 */
export function NoOrganizationsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const company = useCompany();
  const onOrgCreated = useOrganizationCreated();
  const [createOpen, setCreateOpen] = useState(false);
  // "No organization" is only true once the list has settled; before that it is a guess, and
  // a guess that flashes a call to action is worse than a placeholder.
  if (!company.orgsLoaded) return <SkeletonList rows={3} />;
  return (
    <div className="mt-3 space-y-2 px-2.5 pt-2">
      <p className="text-xs text-gray-400 dark:text-gray-500">{S.company.noOrganizations}</p>
      {/* A quiet secondary button: every empty page beside this list (the landing, the
          organization-gone page) carries the primary "New organization" itself, so this one
          only covers the pages that do not. */}
      <Button size="sm" onClick={() => setCreateOpen(true)}>
        {S.company.createOrg}
      </Button>
      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(detail) => {
          setCreateOpen(false);
          void onOrgCreated(detail).then(() => onNavigate?.());
        }}
      />
    </div>
  );
}
