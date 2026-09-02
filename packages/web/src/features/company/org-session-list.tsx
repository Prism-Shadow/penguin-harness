/**
 * Company mode's session list: one group per organization of the current Project, each
 * holding a Desks folder (one row per employee — its avatar, its name, the running
 * hourglass as in the ordinary list, when it was last active) and a Tickets folder (one
 * sub-folder per ticket, wearing the ticket's status pill, with its contributing sessions).
 * Every row opens the ordinary chat page — a desk or ticket session is a normal Session —
 * and carries the development list's hover affordance: an ellipsis that opens a small menu
 * (the employee on the org chart, a fresh desk, the ticket's details). There is no "new
 * chat" here: talking to an employee means opening its desk, which the org chart and the
 * overview do.
 *
 * Loading discipline: a group shows a skeleton only until the store's first sessions fetch
 * completes; a fetch that failed shows one error line with its retry instead — a skeleton
 * that never resolves is the one thing this list must not do.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type {
  OrgSessionsResponse,
  OrgTicketSessionItem,
  OrgTicketStatus,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatRelativeShort } from "../../lib/format";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { useLocale } from "../../state/locale";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Dropdown } from "../../components/ui/dropdown";
import { FolderSection, GroupHeader, Icon } from "../../components/ui/group-list";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { COMPANY_MODE_ICON, NAV_ICONS } from "../../components/ui/icons";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { SessionActivityIcon } from "../../components/ui/session-activity-icon";
import {
  ELLIPSIS_ICON,
  overflowMenuGlyph,
  overflowMenuRowClass,
} from "../../components/ui/session-row-menu";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";
import { Chevron } from "../../components/ui/chevron";
import { orgKey, orgPagePath } from "./company-nav";
import { orgRowActivity, orgSessionGroup } from "./org-sessions";
import { groupRender } from "./shell-org-status";
import { TicketStatusBadge } from "./shared";

/** Open-state key of a folder or ticket sub-folder ("\0" never appears in an id). */
const folderKey = (group: string, part: string) => `${part}\0${group}`;

/** A fresh desk (lucide refresh-cw): the row menu's "new desk session" entry. */
const RENEW_ICON = "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5";

/**
 * The hover "more" button: faded out and pointer-inert until the row is hovered or the
 * button focused (the development list's treatment, and for the same reason — an invisible
 * button must not take taps), and held visible while its menu is open.
 */
const moreButtonClass = (open: boolean) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-all duration-150 hover:text-gray-700 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 dark:text-gray-500 dark:hover:text-gray-200 ${
    open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
  }`;

interface MenuEntry {
  key: string;
  icon: string;
  label: string;
  onSelect: () => void;
}

/** The row's overflow menu: the ellipsis trigger and a portaled panel of labelled entries. */
function RowMenu({ name, entries }: { name: string; entries: MenuEntry[] }) {
  const [open, setOpen] = useState(false);
  const label = S.company.sessionList.rowMenu(name);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-44"
      className="shrink-0"
      button={
        <button
          type="button"
          title={label}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={moreButtonClass(open)}
        >
          <GlyphIcon d={ELLIPSIS_ICON} size={ICON_SIZE.rowLead} filled />
        </button>
      }
    >
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className={overflowMenuRowClass}
          onClick={() => {
            setOpen(false);
            entry.onSelect();
          }}
        >
          {overflowMenuGlyph(entry.icon)}
          {entry.label}
        </button>
      ))}
    </Dropdown>
  );
}

/**
 * The trailing slot of a row: the resting last-active time, swapped for the hover menu
 * button — the button group is right-anchored so every row's ellipsis shares one x, and
 * the time fades on hover or while the button holds focus (the development row's slot).
 */
function TrailingSlot({ time, menu }: { time: string; menu: ReactNode }) {
  return (
    <div className="relative flex h-6 min-w-6 shrink-0 items-center justify-end">
      <div className="peer absolute right-0 top-1/2 flex -translate-y-1/2 items-center">{menu}</div>
      {time !== "" && (
        <span
          aria-hidden
          className="pointer-events-none px-1 text-[11px] text-gray-400 transition-opacity duration-150 group-hover:opacity-0 peer-focus-within:opacity-0 dark:text-gray-500"
        >
          {time}
        </span>
      )}
    </div>
  );
}

export function OrgSessionList({
  activeSessionId,
  onOpen,
}: {
  activeSessionId: string | null;
  onOpen: (sessionId: string, agentId: string) => void;
}) {
  const { locale } = useLocale();
  const navigate = useNavigate();
  const company = useCompany();
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  /** Collapsed organizations and folders (everything open by default: the list is short and every row is a place to go). */
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [renew, setRenew] = useState<{
    projectId: string;
    orgId: string;
    agentId: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (key: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isOpen = (key: string) => !closed.has(key);

  const orgs = company.organizations.filter((o) => o.projectId === projectId);
  const orgKeys = orgs.map((o) => orgKey(o.projectId, o.orgId)).join(",");
  // "Settled" = the store has completed a sessions fetch since this set of organizations
  // was listed: the map is replaced whole on every fetch, so a new identity is the signal.
  // The baseline resets with the organization set (a Project switch lists new keys the old
  // map cannot hold), so a group never reads as failed before its first fetch has run.
  const [baseline, setBaseline] = useState<{
    keys: string;
    map: ReadonlyMap<string, OrgSessionsResponse>;
  }>(() => ({ keys: orgKeys, map: company.orgSessions }));
  if (baseline.keys !== orgKeys) setBaseline({ keys: orgKeys, map: company.orgSessions });
  const settled = baseline.keys === orgKeys && company.orgSessions !== baseline.map;

  if (!company.orgsLoaded) return <SkeletonList rows={4} />;
  if (orgs.length === 0) {
    return (
      <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
        {S.company.noOrganizations}
      </p>
    );
  }

  const renewDesk = async () => {
    if (renew === null) return;
    setBusy(true);
    try {
      const desk = await api.renewOrgDesk(renew.projectId, renew.orgId, renew.agentId);
      toastSuccess(S.company.chart.renewed);
      setRenew(null);
      void company.reloadOrgSessions();
      onOpen(desk.sessionId, renew.agentId);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const row = (input: {
    key: string;
    sessionId: string;
    agentId: string;
    title: string;
    status: SessionStatus;
    lastActiveAt: string | null;
    indent: boolean;
    menu: MenuEntry[];
  }) => {
    const active = input.sessionId === activeSessionId;
    const activity = orgRowActivity(input.status);
    const time = input.lastActiveAt === null ? "" : formatRelativeShort(input.lastActiveAt, locale);
    return (
      <li
        key={input.key}
        className={`group flex items-center rounded-md pr-1 transition-colors duration-150 ${
          active
            ? "bg-gray-200/70 dark:bg-gray-800"
            : "hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
        }`}
      >
        <button
          type="button"
          data-testid="session-row"
          data-session-id={input.sessionId}
          onClick={() => onOpen(input.sessionId, input.agentId)}
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 text-left ${
            input.indent ? "pl-6" : "pl-2.5"
          }`}
        >
          <AgentAvatar
            id={input.agentId}
            name={input.title}
            size={ICON_SIZE.rowLead}
            className="shrink-0 rounded"
          />
          <Truncated
            text={input.title}
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
        </button>
        <TrailingSlot time={time} menu={<RowMenu name={input.title} entries={input.menu} />} />
      </li>
    );
  };

  return (
    <>
      {orgs.map((o) => {
        const key = orgKey(o.projectId, o.orgId);
        const res = company.orgSessions.get(key);
        const group = res === undefined ? null : orgSessionGroup(res);
        const ticketStatus = new Map<string, OrgTicketStatus>(
          (res?.tickets ?? []).map((t) => [t.ticketId, t.status]),
        );
        const open = isOpen(key);
        const render = groupRender({
          loaded: group !== null,
          settled,
          count: group?.count ?? 0,
        });
        const page = (target: "chart" | "tickets", query = "") =>
          navigate(`${orgPagePath(o.projectId, o.orgId, target)}${query}`);
        const ticketEntry = (ticketId: string): MenuEntry => ({
          key: "ticket",
          icon: NAV_ICONS.orgTickets,
          label: S.company.sessionList.viewTicket,
          onSelect: () => page("tickets", `?ticket=${encodeURIComponent(ticketId)}`),
        });
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
            {open && render === "loading" && <SkeletonList rows={2} />}
            {open && render === "error" && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1">
                <span className={`text-xs ${toneInk.danger}`}>
                  {S.company.sessionList.loadFailed}
                </span>
                <Button size="sm" onClick={() => void company.reloadOrgSessions()}>
                  {S.common.retry}
                </Button>
              </div>
            )}
            {open && render === "empty" && (
              <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
                {S.company.sessionList.empty}
              </p>
            )}
            {open && render === "list" && group !== null && (
              <>
                <FolderSection
                  label={S.company.sessionList.desks(group.desks.length)}
                  open={isOpen(folderKey(key, "desks"))}
                  onToggle={() => toggle(folderKey(key, "desks"))}
                >
                  <ul className="space-y-0.5">
                    {group.desks.map((d) =>
                      row({
                        key: d.sessionId,
                        sessionId: d.sessionId,
                        agentId: d.agentId,
                        title: d.title,
                        status: d.status,
                        lastActiveAt: d.lastActiveAt,
                        indent: false,
                        menu: [
                          {
                            key: "chart",
                            icon: NAV_ICONS.orgChart,
                            label: S.company.sessionList.viewInChart,
                            onSelect: () => page("chart"),
                          },
                          {
                            key: "renew",
                            icon: RENEW_ICON,
                            label: S.company.chart.renewDesk,
                            onSelect: () =>
                              setRenew({
                                projectId: o.projectId,
                                orgId: o.orgId,
                                agentId: d.agentId,
                                name: d.title,
                              }),
                          },
                        ],
                      }),
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
                    const status = ticketStatus.get(t.ticketId);
                    return (
                      <div key={t.ticketId} className="mt-0.5">
                        {/* The ticket's own row: its title, its column, a running mark when
                            any contributing session is live; the menu opens its details. */}
                        <div className="group flex items-center rounded pr-1 transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/50">
                          <button
                            type="button"
                            onClick={() => toggle(tKey)}
                            aria-expanded={tOpen}
                            title={t.ticketId}
                            className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-1.5 pr-1 text-left text-xs text-gray-500 dark:text-gray-400"
                          >
                            <Chevron open={tOpen} size={ICON_SIZE.chevronDense} />
                            <span className="shrink-0 text-gray-400 dark:text-gray-500">
                              <Icon d={NAV_ICONS.orgTickets} size={ICON_SIZE.inlineGlyph} />
                            </span>
                            <Truncated text={t.title} className="min-w-0 flex-1" />
                            {t.running && <SessionActivityIcon activity="running" />}
                            {status !== undefined && <TicketStatusBadge status={status} />}
                          </button>
                          <TrailingSlot
                            time=""
                            menu={<RowMenu name={t.title} entries={[ticketEntry(t.ticketId)]} />}
                          />
                        </div>
                        {tOpen && (
                          <ul className="space-y-0.5">
                            {t.sessions.map((s: OrgTicketSessionItem) =>
                              row({
                                key: `${t.ticketId}\0${s.sessionId}`,
                                sessionId: s.sessionId,
                                agentId: s.agentId,
                                title: s.title ?? S.company.sessionList.untitledSession,
                                status: s.status,
                                lastActiveAt: s.lastActiveAt ?? null,
                                indent: true,
                                menu: [
                                  ticketEntry(t.ticketId),
                                  {
                                    key: "chart",
                                    icon: NAV_ICONS.orgChart,
                                    label: S.company.sessionList.viewInChart,
                                    onSelect: () => page("chart"),
                                  },
                                ],
                              }),
                            )}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </FolderSection>
              </>
            )}
          </div>
        );
      })}
      <ConfirmModal
        open={renew !== null}
        title={S.company.chart.renewDesk}
        tone="primary"
        confirmLabel={S.company.chart.renewDesk}
        busy={busy}
        onClose={() => (busy ? undefined : setRenew(null))}
        onConfirm={() => void renewDesk()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {renew !== null ? S.company.chart.renewDeskConfirm(renew.name) : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
