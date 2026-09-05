/**
 * The two session groups under the company sidebar's channel list, and the collapsed rail's
 * desk twins.
 *
 * 工位 is one row per employee, in chart order, expanded by default: the organization's
 * people are its primary objects, and a desk is where a person is talked to. A row whose
 * employee has never had a desk opened still stands there and opens one on click, exactly as
 * the org chart's card does. 工单会话 holds the sessions attached to tickets, newest first
 * under the ticket that names them, collapsed by default: they are work in progress, read
 * from the board far more often than from here.
 *
 * Both read the company store's caches (the organization's chart and its sessions route), so
 * opening a group costs no request; the session the shell is on is marked in place.
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk } from "../../lib/tone";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { FolderSection } from "../../components/ui/group-list";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";
import { NAV_ICONS } from "../../components/ui/icons";
import { orgKey } from "./company-nav";
import { deskRows, orgRowActivity, ticketSessionRows } from "./org-sessions";

/** A row of either group, at the channel rows' density so the whole sidebar reads as one list. */
const rowClass = (active: boolean) =>
  `flex w-full min-w-0 items-center ${ICON_GAP.row} rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-150 ${
    active
      ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
      : "text-gray-600 hover:bg-gray-200/50 dark:text-gray-400 dark:hover:bg-gray-800/70"
  }`;

/**
 * Opening a desk: the store's row when one exists, and otherwise the desk endpoint, which
 * creates it — the same call the org chart's card makes, so the two entry points cannot
 * disagree about what "open the desk" means.
 */
function useOpenSession(projectId: string, orgId: string, onNavigate?: () => void) {
  const navigate = useNavigate();
  const company = useCompany();
  const { setCurrentAgentId } = useProject();
  const [opening, setOpening] = useState<string | null>(null);

  /** Opens an existing Session: the current Agent follows it, as every other list does. */
  const openSession = (sessionId: string, agentId: string) => {
    if (agentId !== "") setCurrentAgentId(agentId);
    navigate(`/chat/${sessionId}`);
    onNavigate?.();
  };

  const openDesk = async (agentId: string, sessionId: string | null) => {
    if (opening !== null) return;
    if (sessionId !== null) {
      openSession(sessionId, agentId);
      return;
    }
    setOpening(agentId);
    try {
      const desk = await api.getOrgDesk(projectId, orgId, agentId);
      // Freshly created: the row has to learn its Session id to mark itself as the open one.
      void company.reloadOrgChart();
      void company.reloadOrgSessions();
      openSession(desk.sessionId, agentId);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setOpening(null);
    }
  };
  return { openSession, openDesk, opening };
}

export function OrgSessionGroups({
  projectId,
  orgId,
  activeSessionId,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  /** The Session the shell is on, so the groups can mark it. */
  activeSessionId: string | null;
  onNavigate?: () => void;
}) {
  const company = useCompany();
  const [desksOpen, setDesksOpen] = useState(true);
  const [ticketsOpen, setTicketsOpen] = useState(false);
  const sessions = company.orgSessions.get(orgKey(projectId, orgId));
  const desks = deskRows(company.orgChart, sessions);
  const tickets = ticketSessionRows(sessions);
  const { openSession, openDesk, opening } = useOpenSession(projectId, orgId, onNavigate);
  // Nothing has been read for this organization yet: a skeleton, not an "empty" claim.
  const chartFailed = company.orgChart === null && company.orgChartError !== null;
  const loading = company.orgChart === null && sessions === undefined && !chartFailed;

  return (
    <div className="mt-1">
      <FolderSection
        label={S.company.sessionList.desks(desks.length)}
        open={desksOpen}
        onToggle={() => setDesksOpen((v) => !v)}
      >
        {loading ? (
          <SkeletonList rows={2} />
        ) : chartFailed && desks.length === 0 ? (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1">
            <span className={`text-xs ${toneInk.danger}`}>{S.company.sessionList.loadFailed}</span>
            <Button size="sm" onClick={() => void company.reloadOrgChart()}>
              {S.common.retry}
            </Button>
          </div>
        ) : desks.length === 0 ? (
          <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
            {S.company.sessionList.noEmployees}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {desks.map((d) => {
              const active = d.sessionId !== null && d.sessionId === activeSessionId;
              const activity = orgRowActivity(d.status);
              const note = activity === "running" ? S.company.sessionList.running : null;
              return (
                <li key={d.agentId}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    disabled={opening === d.agentId}
                    title={d.jobTitle !== "" ? `${d.name} · ${d.jobTitle}` : d.name}
                    aria-label={
                      note !== null
                        ? `${S.company.sessionList.deskOf(d.name)} · ${note}`
                        : S.company.sessionList.deskOf(d.name)
                    }
                    onClick={() => void openDesk(d.agentId, d.sessionId)}
                    className={`${rowClass(active)} disabled:opacity-60`}
                  >
                    <AgentAvatar
                      id={d.agentId}
                      name={d.name}
                      size={ICON_SIZE.rowLead}
                      className="shrink-0 rounded"
                    />
                    <Truncated text={d.name} className="min-w-0 flex-1" />
                    {activity !== null && <SessionActivityIcon activity={activity} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </FolderSection>
      <FolderSection
        label={S.company.sessionList.ticketSessions(tickets.length)}
        open={ticketsOpen}
        onToggle={() => setTicketsOpen((v) => !v)}
      >
        {tickets.length === 0 ? (
          <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
            {S.company.sessionList.noTicketSessions}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {tickets.map((t) => {
              const active = t.sessionId === activeSessionId;
              const activity = orgRowActivity(t.status);
              const title = t.title === "" ? S.company.sessionList.untitledSession : t.title;
              return (
                <li key={`${t.ticketId}/${t.sessionId}`}>
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    title={`${title} · ${t.ticketTitle}`}
                    aria-label={`${title} · ${t.ticketTitle}`}
                    onClick={() => openSession(t.sessionId, t.agentId)}
                    className={`${rowClass(active)} items-start`}
                  >
                    <span className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500">
                      <GlyphIcon d={NAV_ICONS.orgTickets} size={ICON_SIZE.rowLead} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Truncated text={title} className="block" />
                      {/* The ticket is the row's subtitle: two sessions of one ticket are
                          told apart by their own titles, and a session is only ever read
                          against the ticket it is working. */}
                      <Truncated
                        text={t.ticketTitle}
                        className="block text-[11px] text-gray-400 dark:text-gray-500"
                      />
                    </span>
                    {activity !== null && (
                      <span className="mt-0.5">
                        <SessionActivityIcon activity={activity} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </FolderSection>
    </div>
  );
}

/** The collapsed rail's desks: the same rows as avatars, each with its running dot. */
export function DeskRailRows({ projectId, orgId }: { projectId: string; orgId: string }) {
  const company = useCompany();
  const desks = deskRows(company.orgChart, company.orgSessions.get(orgKey(projectId, orgId)));
  const { openDesk, opening } = useOpenSession(projectId, orgId);
  if (desks.length === 0) return null;
  return (
    <>
      {desks.map((d) => {
        const running = orgRowActivity(d.status) !== null;
        const name = running
          ? `${S.company.sessionList.deskOf(d.name)} · ${S.company.sessionList.running}`
          : S.company.sessionList.deskOf(d.name);
        return (
          <button
            key={d.agentId}
            type="button"
            title={name}
            aria-label={name}
            disabled={opening === d.agentId}
            onClick={() => void openDesk(d.agentId, d.sessionId)}
            className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 hover:bg-gray-200/70 disabled:opacity-60 dark:hover:bg-gray-800"
          >
            <AgentAvatar id={d.agentId} name={d.name} size={18} className="rounded" />
            {running && (
              <span
                aria-hidden
                className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${toneDot.busy}`}
              />
            )}
          </button>
        );
      })}
    </>
  );
}
