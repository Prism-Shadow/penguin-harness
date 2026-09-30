/**
 * The Desks and Temporary groups under the company sidebar's channel list, and the collapsed
 * rail's twins.
 *
 * Desks: one row per employee, in chart order, expanded by default: the organization's people
 * are its primary objects, and a desk is where a person is talked to. Every employee has a desk
 * session from the moment it is hired, so a row normally carries one; a row whose id these
 * caches have not learned yet still stands there and opens the desk on click, exactly as the
 * org chart's card does.
 *
 * Temporary: ticket sessions have no group of their own. Each exists because a ticket started
 * it, and it is opened from that ticket's dialog. The ones opened from there are listed below the
 * desks, newest first, until the reader removes one with its ✕ or all of them with the header's
 * "Close all"; the group shows only while it lists something (temp-session.ts).
 *
 * A row that names a desk session carries the development list's row menu (right-click, and
 * the hover ellipsis), pared down to the two actions an organization leaves to the reader:
 * copy the Session id, and bind the desk to a messaging bot. A desk's title and its lifecycle are
 * the organization's — the employee names it, hiring and firing open and close it — so
 * rename, archive, delete and pin are not offered here. The binding's own indicator is read
 * from the organization's sessions route, which marks a desk the way the Session's own row is
 * marked; the session list store never holds a desk, so it cannot say.
 *
 * The group reads the company store's caches (the organization's chart and its sessions
 * route), so opening it costs no request; the session the shell is on is marked in place. The
 * run marks come from the session list's live statuses wherever it holds the row — those
 * caches are only re-read on an organization event, and a run ending publishes none
 * (org-sessions.ts).
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneDot, toneInk } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { useLiveSessionStatuses } from "../../state/sessions";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { Button } from "../../components/ui/button";
import { useRowContextMenu } from "../../components/ui/context-menu";
import { writeClipboard } from "../../components/ui/copy-button";
import { Dropdown } from "../../components/ui/dropdown";
import { FolderSection, Icon } from "../../components/ui/group-list";
import { CloseIcon, MESSAGING_RELAY_ICON } from "../../components/ui/icons";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import {
  DESK_ROW_ACTIONS,
  SessionRowHoverActions,
  SessionRowMenuRows,
} from "../../components/ui/session-row-menu";
import type { SessionRowAction, SessionRowState } from "../../components/ui/session-row-menu";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";
import { MessagingBindingModal } from "../messaging/messaging-binding-modal";
import { orgKey } from "./company-nav";
import { deskRows, orgRowActivity, ticketSessionTitles } from "./org-sessions";
import type { OrgDeskRow } from "./org-sessions";
import {
  dismissAllTempSessions,
  dismissTempSession,
  tempSessionRows,
  useTempSessions,
} from "./temp-session";
import type { TempSessionRow } from "./temp-session";

/**
 * The row's surface — the hover and active fill — on the wrapper rather than on the button,
 * so the row's menu affordances sit inside the same lit box the reader is pointing at, and
 * `group` reaches them.
 */
const rowSurface = (active: boolean) =>
  `group flex select-none items-center rounded-md pr-1 transition-colors duration-150 ${
    active ? "bg-gray-200/70 dark:bg-gray-800" : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
  }`;

/** The row's own button, at the channel rows' density so the whole sidebar reads as one list. */
const rowButton = (active: boolean) =>
  `flex min-w-0 flex-1 items-center ${ICON_GAP.row} px-2.5 py-1.5 text-left text-sm transition-colors duration-150 disabled:opacity-60 ${
    active ? "font-medium text-gray-900 dark:text-gray-100" : "text-gray-600 dark:text-gray-400"
  }`;

/**
 * A desk is neither archivable nor pinnable, so the two toggles the shared menu labels read
 * are constant here — it offers neither action (DESK_ROW_ACTIONS).
 */
const DESK_ROW_STATE: SessionRowState = { archived: false, pinned: false };

/**
 * Opening a desk: the store's row when one exists, and otherwise the desk endpoint, which
 * creates it — the same call the org chart's card makes, so the two entry points cannot
 * disagree about what "open the desk" means. `openSession` is how a Temporary row opens its
 * session.
 */
function useOpenDesk(projectId: string, orgId: string, onNavigate?: () => void) {
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
  return { openDesk, openSession, opening };
}

/**
 * One desk row. The menu hangs off a desk this list knows the id of; while it does not (the
 * caches have not caught up with a hire, or the desk has yet to be provisioned) there is no
 * Session to copy or bind, so the row stays a plain button until a click opens one.
 */
function DeskRow({
  row,
  active,
  opening,
  onOpen,
  onMessaging,
}: {
  row: OrgDeskRow;
  active: boolean;
  /** This row's desk is being created right now (the click that creates it is in flight). */
  opening: boolean;
  onOpen: () => void;
  onMessaging: (sessionId: string) => void;
}) {
  const ctx = useRowContextMenu();
  const sessionId = row.sessionId;
  /** The enabled messaging binding of this desk's Session, as the organization's sessions route marks it. */
  const messagingChannel = row.messagingChannel;
  const activity = orgRowActivity(row.status);
  const deskName = S.company.sessionList.deskOf(row.name);
  const label =
    activity === "running" ? `${deskName} · ${S.company.sessionList.running}` : deskName;

  /** Run one action on this desk's Session, closing the menu first if it was open. */
  const run = (action: SessionRowAction) => {
    ctx.close();
    if (sessionId === null) return;
    if (action === "messaging") {
      onMessaging(sessionId);
      return;
    }
    if (action === "copy") {
      // The panel closes under the click, so the confirmation is a toast rather than
      // feedback on the row that ran it — the development list's rule for the same action.
      writeClipboard(sessionId);
      toastSuccess(S.common.copied);
    }
  };
  /**
   * Menu items hand focus back to the row before acting: the panel unmounts under the user,
   * and the menu is the only keyboard route to these actions.
   */
  const runFromMenu = (action: SessionRowAction) => {
    ctx.returnFocus()?.focus();
    run(action);
  };

  return (
    <li>
      <div
        ref={sessionId === null ? undefined : ctx.rowRef}
        // Right-click / Shift+F10 / press-and-hold open the row's menu; the native menu is
        // suppressed inside that handler only, so the rest of the app keeps the browser's own.
        {...(sessionId === null ? {} : ctx.rowProps)}
        className={rowSurface(active)}
      >
        <button
          type="button"
          aria-current={active ? "true" : undefined}
          disabled={opening}
          title={row.jobTitle !== "" ? `${row.name} · ${row.jobTitle}` : row.name}
          aria-label={label}
          // A press-and-hold that opened the menu must not also open the desk: touch screens
          // replay the held press as a click once the finger lifts.
          onClick={() => {
            if (ctx.consumeLongPressClick()) return;
            onOpen();
          }}
          className={rowButton(active)}
        >
          <AgentAvatar
            id={row.agentId}
            name={row.name}
            size={ICON_SIZE.rowLead}
            className="shrink-0 rounded"
          />
          <Truncated text={row.name} className="min-w-0 flex-1" />
          {/* Enabled-messaging indicator, the development row's own mark: one glyph for every
              channel, the channel named in the tooltip and the screen-reader text. */}
          {messagingChannel !== undefined && (
            <span
              title={S.messaging.enabledIndicator[messagingChannel]}
              className="shrink-0 text-gray-400 dark:text-gray-500"
            >
              <Icon d={MESSAGING_RELAY_ICON} size={ICON_SIZE.rowMark} />
              <span className="sr-only">{S.messaging.enabledIndicator[messagingChannel]}</span>
            </span>
          )}
          {activity !== null && <SessionActivityIcon activity={activity} />}
        </button>
        {/* The menu affordance's slot, laid out rather than overlaid and reserved on every row
            — including a desk that does not exist yet — so the names line up down the group
            and nothing floats over the run mark. No direct hover action goes in it: a desk has
            none that is both safe and one click, so it holds the ellipsis alone, which is also
            the pointer's way into a menu right-click leaves undiscoverable. */}
        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
          {sessionId !== null && (
            <SessionRowHoverActions
              actions={[]}
              state={DESK_ROW_STATE}
              onRun={run}
              onMore={ctx.openAt}
            />
          )}
        </span>
        {sessionId !== null && (
          <>
            {/* `contents` keeps this wrapper out of the row's flex layout: it draws no box of
                its own and the panel is portaled against the point the gesture landed on. */}
            <Dropdown
              open={ctx.open}
              setOpen={ctx.setOpen}
              portal={{ direction: "down", align: "left" }}
              anchorRect={ctx.anchor}
              anchorOwner={ctx.anchorOwner}
              returnFocus={ctx.returnFocus}
              className="contents"
              menuClass="w-36"
              button={null}
            >
              <SessionRowMenuRows
                actions={DESK_ROW_ACTIONS}
                state={DESK_ROW_STATE}
                onRun={runFromMenu}
              />
            </Dropdown>
          </>
        )}
      </div>
    </li>
  );
}

/** A Temporary row with what it draws besides its entry. */
interface TempRowView extends TempSessionRow {
  /** The employee's name, for the avatar and the tooltip. */
  name: string;
  activity: ReturnType<typeof orgRowActivity>;
}

/**
 * This organization's Temporary rows for the signed-in user, with what each draws: the title the
 * organization gives the session (the ticket's listing at open time until the route names it),
 * the employee's name, and the live run state. A desk session is left to its desk row.
 */
function useTempRows(
  projectId: string,
  orgId: string,
  desks: readonly OrgDeskRow[],
  activeSessionId: string | null,
): TempRowView[] {
  const company = useCompany();
  const { user } = useAuth();
  const live = useLiveSessionStatuses();
  const list = useTempSessions(user?.userId ?? null, projectId, orgId);
  const titles = ticketSessionTitles(company.orgSessions.get(orgKey(projectId, orgId)));
  return tempSessionRows(
    list,
    desks.map((d) => d.sessionId),
    activeSessionId,
  ).map((row) => {
    const named = titles.get(row.sessionId);
    const title = named ?? (row.title !== "" ? row.title : S.company.sessionList.untitledSession);
    const name =
      company.orgChart?.employees.find((e) => e.agentId === row.agentId)?.name ?? row.agentId;
    const status = live.get(row.sessionId);
    return { ...row, title, name, activity: status === undefined ? null : orgRowActivity(status) };
  });
}

/**
 * One Temporary row: the employee's avatar, the session's title and its run mark, then a ✕ that
 * removes the row and nothing else. The page stays where it is, even on this session.
 */
function TempRow({
  row,
  onOpen,
  onDismiss,
}: {
  row: TempRowView;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const label =
    row.activity === "running" ? `${row.title} · ${S.company.sessionList.running}` : row.title;
  const remove = S.company.sessionList.closeTemporary;
  return (
    <li>
      <div className={rowSurface(row.active)}>
        <button
          type="button"
          aria-current={row.active ? "true" : undefined}
          title={`${row.name} · ${row.title}`}
          aria-label={label}
          onClick={onOpen}
          className={rowButton(row.active)}
        >
          <AgentAvatar
            id={row.agentId}
            name={row.name}
            size={ICON_SIZE.rowLead}
            className="shrink-0 rounded"
          />
          <Truncated text={row.title} className="min-w-0 flex-1" />
          {row.activity !== null && <SessionActivityIcon activity={row.activity} />}
        </button>
        {/* The same trailing slot a desk row keeps for its menu, so the run marks line up
            across the two groups. */}
        <button
          type="button"
          title={remove}
          aria-label={remove}
          onClick={onDismiss}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
        >
          <CloseIcon />
        </button>
      </div>
    </li>
  );
}

/**
 * The collapsed rail's Temporary entries, after the desks and a hairline: avatars with their
 * running dots, drawn the way the desks are.
 */
export function TempSessionRailRows({ projectId, orgId }: { projectId: string; orgId: string }) {
  const company = useCompany();
  const live = useLiveSessionStatuses();
  const desks = deskRows(company.orgChart, company.orgSessions.get(orgKey(projectId, orgId)), live);
  const rows = useTempRows(projectId, orgId, desks, null);
  const { openSession } = useOpenDesk(projectId, orgId);
  if (rows.length === 0) return null;
  return (
    <>
      <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-gray-200 dark:bg-gray-800" />
      {rows.map((row) => {
        const entry = S.company.sessionList.temporaryEntry(row.title);
        const name = row.activity !== null ? `${entry} · ${S.company.sessionList.running}` : entry;
        return (
          <button
            key={row.sessionId}
            type="button"
            title={name}
            aria-label={name}
            onClick={() => openSession(row.sessionId, row.agentId)}
            className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 hover:bg-gray-200/70 dark:hover:bg-gray-800"
          >
            <AgentAvatar id={row.agentId} name={row.name} size={18} className="rounded" />
            {row.activity !== null && (
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

export function OrgSessionGroups({
  projectId,
  orgId,
  activeSessionId,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  /** The Session the shell is on, so the group can mark it. */
  activeSessionId: string | null;
  onNavigate?: () => void;
}) {
  const company = useCompany();
  const { user } = useAuth();
  const [desksOpen, setDesksOpen] = useState(true);
  const [tempOpen, setTempOpen] = useState(true);
  /** The desk whose messaging binding is open in the dialog; null when none is. */
  const [messagingSessionId, setMessagingSessionId] = useState<string | null>(null);
  const live = useLiveSessionStatuses();
  const orgSessions = company.orgSessions.get(orgKey(projectId, orgId));
  const desks = deskRows(company.orgChart, orgSessions, live);
  const { openDesk, openSession, opening } = useOpenDesk(projectId, orgId, onNavigate);
  const tempRows = useTempRows(projectId, orgId, desks, activeSessionId);
  // Nothing has been read for this organization yet: a skeleton, not an "empty" claim.
  const chartFailed = company.orgChart === null && company.orgChartError !== null;
  const loading = company.orgChart === null && orgSessions === undefined && !chartFailed;

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
            {desks.map((d) => (
              <DeskRow
                key={d.agentId}
                row={d}
                active={d.sessionId !== null && d.sessionId === activeSessionId}
                opening={opening === d.agentId}
                onOpen={() => void openDesk(d.agentId, d.sessionId)}
                onMessaging={setMessagingSessionId}
              />
            ))}
          </ul>
        )}
      </FolderSection>
      {tempRows.length > 0 && (
        <FolderSection
          label={S.company.sessionList.temporary(tempRows.length)}
          open={tempOpen}
          onToggle={() => setTempOpen((v) => !v)}
          // One click, no confirmation: nothing is lost, each session stays one click away in
          // its ticket. Nothing navigates, even when the session on screen was listed.
          action={
            <button
              type="button"
              onClick={() => dismissAllTempSessions(user?.userId ?? null, projectId, orgId)}
              className="shrink-0 rounded px-1.5 py-1 text-[11px] font-medium text-gray-400 transition-colors duration-150 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200"
            >
              {S.company.sessionList.closeAllTemporary}
            </button>
          }
        >
          <ul className="space-y-0.5">
            {tempRows.map((row) => (
              <TempRow
                key={row.sessionId}
                row={row}
                onOpen={() => openSession(row.sessionId, row.agentId)}
                onDismiss={() =>
                  dismissTempSession(user?.userId ?? null, projectId, orgId, row.sessionId)
                }
              />
            ))}
          </ul>
        </FolderSection>
      )}
      {/* Messaging binding dialog (the row menu's "Messaging binding…"): the row's indicator
          follows the dialog's own enable/disable outcome, written into the company store's
          copy of the sessions route. */}
      {messagingSessionId !== null && (
        <MessagingBindingModal
          sessionId={messagingSessionId}
          onClose={() => setMessagingSessionId(null)}
          // The row's Session id comes from the company store's cache of the organization's
          // sessions route. A desk exists from the hire and the reconcile pass re-opens one
          // whose session went missing, so a row naming an id the server cannot find should
          // not happen — but when it does, the cache is what is stale: re-read it, and the
          // editor's own toast has already said why the dialog closed.
          onLoadFailed={() => void company.reloadOrgSessions()}
          onChanged={company.setDeskMessagingChannel}
        />
      )}
    </div>
  );
}

/** The collapsed rail's desks: the same rows as avatars, each with its running dot. */
export function DeskRailRows({ projectId, orgId }: { projectId: string; orgId: string }) {
  const company = useCompany();
  const live = useLiveSessionStatuses();
  const desks = deskRows(company.orgChart, company.orgSessions.get(orgKey(projectId, orgId)), live);
  const { openDesk, opening } = useOpenDesk(projectId, orgId);
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
