/**
 * Company mode's session list: one group per organization of the current Project, each
 * holding a Desks folder (one row per employee, titled by the employee's name, the running
 * hourglass as in the ordinary list) and a Tickets folder (one sub-folder per ticket with
 * its contributing sessions). Every row opens the ordinary chat page — a desk or ticket
 * session is a normal Session. There is no "new chat" here: talking to an employee means
 * opening its desk, which the org chart and the overview do.
 */
import { useState } from "react";
import type { OrgTicketSessionItem, SessionStatus } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { formatRelativeShort } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { useLocale } from "../../state/locale";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { FolderSection, GroupHeader, Icon } from "../../components/ui/group-list";
import { COMPANY_MODE_ICON, NAV_ICONS } from "../../components/ui/icons";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { SkeletonList } from "../../components/ui/skeleton";
import { Truncated } from "../../components/ui/truncated";
import { Chevron } from "../../components/ui/chevron";
import { orgKey } from "./company-nav";
import { orgRowActivity, orgSessionGroup } from "./org-sessions";

/** Open-state key of a folder or ticket sub-folder ("\0" never appears in an id). */
const folderKey = (group: string, part: string) => `${part}\0${group}`;

export function OrgSessionList({
  activeSessionId,
  onOpen,
}: {
  activeSessionId: string | null;
  onOpen: (sessionId: string, agentId: string) => void;
}) {
  const { locale } = useLocale();
  const company = useCompany();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** Collapsed organizations and folders (everything open by default: the list is short and every row is a place to go). */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isOpen = (key: string) => !closed.has(key);

  const orgs = company.organizations.filter((o) => o.projectId === projectId);
  if (!company.orgsLoaded) return <SkeletonList rows={4} />;
  if (orgs.length === 0) {
    return (
      <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
        {S.company.noOrganizations}
      </p>
    );
  }

  const row = (
    key: string,
    sessionId: string,
    agentId: string,
    title: string,
    status: SessionStatus,
    lastActiveAt: string | null,
    indent: boolean,
  ) => {
    const active = sessionId === activeSessionId;
    const activity = orgRowActivity(status);
    return (
      <li key={key}>
        <button
          type="button"
          data-testid="session-row"
          data-session-id={sessionId}
          onClick={() => onOpen(sessionId, agentId)}
          className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left transition-colors duration-150 ${
            indent ? "pl-6" : "px-2.5"
          } ${
            active
              ? "bg-gray-200/70 dark:bg-gray-800"
              : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
          }`}
        >
          <AgentAvatar id={agentId} size={ICON_SIZE.rowLead} className="rounded" />
          <Truncated
            text={title}
            className={`min-w-0 flex-1 text-sm ${
              active
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-700 dark:text-gray-300"
            }`}
          />
          {activity === null ? (
            <span aria-hidden="true" className="block h-3 w-3 shrink-0" />
          ) : (
            <SessionActivityIcon activity={activity} />
          )}
          {lastActiveAt !== null && (
            <span className="shrink-0 px-1 text-[11px] text-gray-400 dark:text-gray-500">
              {formatRelativeShort(lastActiveAt, locale)}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <>
      {orgs.map((o) => {
        const key = orgKey(o.projectId, o.orgId);
        const res = company.orgSessions.get(key);
        const group = res === undefined ? null : orgSessionGroup(res);
        const open = isOpen(key);
        return (
          <div key={key} className="pt-2.5">
            <GroupHeader
              open={open}
              onToggle={() => toggle(key)}
              icon={
                <span className="shrink-0 text-gray-400 dark:text-gray-500">
                  <Icon d={COMPANY_MODE_ICON} size={ICON_SIZE.groupHeaderGlyph} />
                </span>
              }
              label={o.name}
              uppercase
              {...(group !== null ? { count: group.count } : {})}
            />
            {open &&
              (group === null ? (
                <SkeletonList rows={2} />
              ) : group.count === 0 ? (
                <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
                  {S.company.sessionList.empty}
                </p>
              ) : (
                <>
                  <FolderSection
                    label={S.company.sessionList.desks(group.desks.length)}
                    open={isOpen(folderKey(key, "desks"))}
                    onToggle={() => toggle(folderKey(key, "desks"))}
                  >
                    <ul className="space-y-0.5">
                      {group.desks.map((d) =>
                        row(
                          d.sessionId,
                          d.sessionId,
                          d.agentId,
                          d.title,
                          d.status,
                          d.lastActiveAt,
                          false,
                        ),
                      )}
                    </ul>
                  </FolderSection>
                  <FolderSection
                    label={S.company.sessionList.tickets(group.tickets.length)}
                    open={isOpen(folderKey(key, "tickets"))}
                    onToggle={() => toggle(folderKey(key, "tickets"))}
                  >
                    {group.tickets.map((t) => {
                      const tKey = folderKey(key, `ticket:${t.ticketId}`);
                      const tOpen = isOpen(tKey);
                      return (
                        <div key={t.ticketId} className="mt-0.5">
                          {/* The ticket's own row: its title, a running mark when any contributing session is live. */}
                          <button
                            type="button"
                            onClick={() => toggle(tKey)}
                            title={t.ticketId}
                            className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-200/50 dark:text-gray-400 dark:hover:bg-gray-800/50"
                          >
                            <Chevron open={tOpen} size={ICON_SIZE.chevronDense} />
                            <span className="shrink-0 text-gray-400 dark:text-gray-500">
                              <Icon d={NAV_ICONS.orgTickets} size={ICON_SIZE.inlineGlyph} />
                            </span>
                            <Truncated text={t.title} className="min-w-0 flex-1" />
                            {t.running && <SessionActivityIcon activity="running" />}
                          </button>
                          {tOpen && (
                            <ul className="space-y-0.5">
                              {t.sessions.map((s: OrgTicketSessionItem) =>
                                row(
                                  `${t.ticketId}\0${s.sessionId}`,
                                  s.sessionId,
                                  s.agentId,
                                  s.title ?? S.company.sessionList.untitledSession,
                                  s.status,
                                  s.lastActiveAt ?? null,
                                  true,
                                ),
                              )}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </FolderSection>
                </>
              ))}
          </div>
        );
      })}
    </>
  );
}
