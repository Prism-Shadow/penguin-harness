/**
 * The organization switcher that stands where the Project switcher stands in development
 * mode: every organization the user can reach, grouped by Project and labelled
 * `<project> / <org>`, plus the two entries that make and shape one — "New organization"
 * (id, display name, one-sentence mission; success lands in the CEO's desk session) and
 * "Organization settings". Same Dropdown, same menu rows as the Project switcher, so the two
 * modes read as one shell.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { S } from "../../lib/strings";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useCompany } from "../../state/company";
import { projectDisplayName, useProject } from "../../state/project";
import { Dropdown } from "../../components/ui/dropdown";
import { Badge } from "../../components/ui/badge";
import { ChevronDown, COMPANY_MODE_ICON } from "../../components/ui/icons";
import { Icon } from "../../components/ui/group-list";
import { groupOrganizationsByProject, orgKey, orgPagePath, parseOrgKey } from "./company-nav";
import { CreateOrganizationDialog, OrganizationSettingsDialog } from "./org-dialogs";

const menuItemClass =
  "block w-full px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800";

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
            title={
              current !== null
                ? S.company.inProject(projectName(current.projectId), current.name)
                : S.company.switcher
            }
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-base font-semibold transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {current !== null
                ? current.name
                : company.orgsLoaded
                  ? S.company.noOrganizations
                  : S.common.loading}
            </span>
            <span className="text-gray-400">
              <ChevronDown />
            </span>
          </button>
        }
      >
        {groups.map((group) => (
          <div key={group.projectId}>
            <p className="px-3.5 pb-0.5 pt-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
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
                  onClick={() => {
                    setOpen(false);
                    go(orgPagePath(o.projectId, o.orgId, "overview"));
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-sm transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    active ? "font-semibold" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">
                      <Icon d={COMPANY_MODE_ICON} size={ICON_SIZE.rowLead} />
                    </span>
                    <span className="truncate">{o.name}</span>
                  </span>
                  {o.invalid !== undefined ? (
                    <Badge tone="red">{S.company.orgInvalid}</Badge>
                  ) : o.status === "paused" ? (
                    <Badge tone="amber">{S.company.orgPaused}</Badge>
                  ) : null}
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
            + {S.company.createOrg}
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
              : orgPagePath(detail.projectId, detail.orgId, "overview"),
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
