/**
 * The channel list's "Sessions" menu: an organization's desk sessions (one per employee) and
 * its ticket sessions (grouped under the ticket they contribute to), in a portal panel above
 * everything, each row opening the ordinary `/chat/:sessionId` page and wearing the same
 * live state the development list shows. The session the shell is on is marked.
 *
 * Company mode's sidebar lists channels, not conversations — this menu is where the
 * conversations went. It reads the store's per-organization sessions cache, so opening it
 * costs no request; the org chart, the ticket drawer and a channel's member popover reach
 * the same sessions by their own routes.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import type { SessionStatus } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CheckIcon, NAV_ICONS, ORG_SESSIONS_ICON } from "../../components/ui/icons";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { SkeletonList } from "../../components/ui/skeleton";
import { Truncated } from "../../components/ui/truncated";
import { orgKey } from "./company-nav";
import { orgRowActivity, orgSessionGroup } from "./org-sessions";

/** A row of the menu: the overflow menus' compact density, with room for an avatar. */
const rowClass = (active: boolean) =>
  `flex w-full items-center ${ICON_GAP.row} px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
    active
      ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
      : "hover:bg-gray-100 dark:hover:bg-gray-800"
  }`;

/** A group title inside the panel (desk sessions / ticket sessions), at the mention panel's density. */
function GroupTitle({ children }: { children: string }) {
  return (
    <p className="px-2.5 pb-0.5 pt-1.5 text-[11px] font-medium text-gray-400 dark:text-gray-500">
      {children}
    </p>
  );
}

export function ChannelSessionsMenu({
  projectId,
  orgId,
  activeSessionId,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  /** The Session the shell is on, so the menu can mark it. */
  activeSessionId: string | null;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const company = useCompany();
  const { setCurrentAgentId } = useProject();
  const res = company.orgSessions.get(orgKey(projectId, orgId));
  const group = res === undefined ? null : orgSessionGroup(res);

  const openSession = (sessionId: string, agentId: string) => {
    // The current Agent follows the opened Session's Agent, as every other list does.
    setCurrentAgentId(agentId);
    setOpen(false);
    navigate(`/chat/${sessionId}`);
    onNavigate?.();
  };

  const row = (input: {
    key: string;
    sessionId: string;
    agentId: string;
    title: string;
    status: SessionStatus;
    indent?: boolean;
  }) => {
    const active = input.sessionId === activeSessionId;
    const activity = orgRowActivity(input.status);
    return (
      <button
        key={input.key}
        type="button"
        role="menuitem"
        aria-current={active ? "true" : undefined}
        onClick={() => openSession(input.sessionId, input.agentId)}
        className={`${rowClass(active)} ${input.indent === true ? "pl-6" : ""}`}
      >
        <AgentAvatar
          id={input.agentId}
          name={input.title}
          size={ICON_SIZE.rowLead}
          className="shrink-0 rounded"
        />
        <Truncated text={input.title} className="min-w-0 flex-1" />
        {activity !== null && <SessionActivityIcon activity={activity} />}
        {active && (
          <span className="shrink-0 text-gray-500 dark:text-gray-400">
            <CheckIcon />
          </span>
        )}
      </button>
    );
  };

  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-72"
      className="shrink-0"
      button={
        <button
          type="button"
          title={S.company.sessionList.menu}
          aria-label={S.company.sessionList.menuLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`flex h-6 w-6 items-center justify-center rounded transition-colors duration-150 ${
            open
              ? "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
              : "text-gray-400 hover:bg-gray-200/70 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          }`}
        >
          <GlyphIcon d={ORG_SESSIONS_ICON} size={ICON_SIZE.iconButton} />
        </button>
      }
    >
      <div role="menu" aria-label={S.company.sessionList.menuLabel}>
        {group === null ? (
          company.orgsLoaded ? (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
              <span className={`text-xs ${toneInk.danger}`}>
                {S.company.sessionList.loadFailed}
              </span>
              <Button size="sm" onClick={() => void company.reloadOrgSessions()}>
                {S.common.retry}
              </Button>
            </div>
          ) : (
            <SkeletonList rows={3} />
          )
        ) : group.count === 0 ? (
          <p className="px-2.5 py-1.5 text-xs text-gray-400 dark:text-gray-500">
            {S.company.sessionList.empty}
          </p>
        ) : (
          <>
            {group.desks.length > 0 && (
              <>
                <GroupTitle>{S.company.sessionList.desks(group.desks.length)}</GroupTitle>
                {group.desks.map((d) =>
                  row({
                    key: d.sessionId,
                    sessionId: d.sessionId,
                    agentId: d.agentId,
                    title: d.title,
                    status: d.status,
                  }),
                )}
              </>
            )}
            {group.tickets.length > 0 && (
              <>
                <GroupTitle>
                  {S.company.sessionList.ticketSessions(
                    group.tickets.reduce((n, t) => n + t.sessions.length, 0),
                  )}
                </GroupTitle>
                {group.tickets.map((t) => (
                  <div key={t.ticketId}>
                    {/* The ticket names the sessions beneath it; it is a label, not a row —
                        a ticket itself is opened from the board. */}
                    <p
                      title={t.ticketId}
                      className={`flex items-center ${ICON_GAP.row} px-2.5 pt-1 text-[11px] text-gray-500 dark:text-gray-400`}
                    >
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">
                        <GlyphIcon d={NAV_ICONS.orgTickets} size={ICON_SIZE.inlineGlyph} />
                      </span>
                      <Truncated text={t.title} className="min-w-0 flex-1" />
                      {t.running && <SessionActivityIcon activity="running" />}
                    </p>
                    {t.sessions.map((s) =>
                      row({
                        key: `${t.ticketId}/${s.sessionId}`,
                        sessionId: s.sessionId,
                        agentId: s.agentId,
                        title: s.title ?? S.company.sessionList.untitledSession,
                        status: s.status,
                        indent: true,
                      }),
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </Dropdown>
  );
}
