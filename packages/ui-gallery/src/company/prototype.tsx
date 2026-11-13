/**
 * The company-mode prototype: the proposed company mode as something to click through, built of
 * the Web App's own shell, sidebar, page frame, ticket badges and dialog, on staged data
 * (model.ts). It is the spec's main exhibit: what the mode shows first, where a decision is
 * taken, and what never reaches the reader.
 *
 * What it changes in the shipped sidebar: the inbox, the lead, the board and the team (in the org
 * chart's place, team-page.tsx) and the handbook (handbook-page.tsx) are the rows, with no fold:
 * the calendar's schedules are on the inbox and the finance page's figures on the inbox, the
 * team and each ticket, so neither keeps a page; the channel
 * list and the desks give way to one list of the work sessions that are not over, each opening
 * the conversation itself (session-page.tsx), with a link back to its ticket.
 *
 * No agent runs here. The bar under the page moves every work session one step when the reader
 * asks, so they see a ticket come to the inbox and nothing else change.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  AppShell,
  Button,
  Drawer,
  ICONS,
  ICON_SIZE,
  MobileTopBar,
  NavRow,
  Pill,
  SidebarFrame,
  SidebarListHeader,
  SidebarNavArea,
  toastInfo,
  UserAvatar,
} from "@prismshadow/penguin-ui";
import { S } from "../../../web/src/lib/strings";
import { COMPANY_NAV_ICONS } from "../../../web/src/features/company/company-nav-icons";
import { OrgStatusPill } from "../../../web/src/features/company/shared";
import type { CompanyStart } from "./frame";
import {
  acceptTicket,
  answerTicket,
  approveTicket,
  costOf,
  freshState,
  inboxCounts,
  letTimePass,
  liveSessions,
  readTicket,
  rejectTicket,
  returnTicket,
  sayInSession,
  sayToLead,
  sessionsOf,
  sessionStatus,
  setScheduleAuto,
  startCompany,
  triageTicket,
  weekState,
} from "./model";
import type { CompanyState } from "./model";
import { entryWords, HandbookPage } from "./handbook-page";
import { BoardPage, InboxPage, LeadPage, SetupPage } from "./pages";
import { PersonAvatar, whoOf } from "./people";
import { SessionPage } from "./session-page";
import { TeamPage } from "./team-page";
import { titleOf } from "./text";
import { TicketDialog } from "./ticket-dialog";
import type { TicketActions } from "./ticket-dialog";
import { useWords } from "./use-words";

type Page = "inbox" | "lead" | "tickets" | "team" | "handbook" | "session";

export function CompanyPrototype({ start }: { start: CompanyStart }) {
  const W = useWords();
  const [state, setState] = useState<CompanyState>(() =>
    start === "fresh" ? freshState() : weekState(),
  );
  const [page, setPage] = useState<Page>("inbox");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [handbookPath, setHandbookPath] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const open = state.tickets.find((ticket) => ticket.id === openId);
  const openTicket = (id: string) => {
    setState((current) => readTicket(current, id));
    setOpenId(id);
  };
  const go = (next: Page) => {
    setPage(next);
    setMenuOpen(false);
  };
  const openSession = (id: string) => {
    setOpenId(null);
    setSessionId(id);
    go("session");
  };
  const openHandbook = (path: string) => {
    setOpenId(null);
    setHandbookPath(path);
    go("handbook");
  };
  const actions: TicketActions = {
    accept: (id) => setState((current) => acceptTicket(current, id)),
    reject: (id) => setState((current) => rejectTicket(current, id)),
    answer: (id, option, note) => setState((current) => answerTicket(current, id, option, note)),
    approve: (id) => setState((current) => approveTicket(current, id)),
    sendBack: (id, note) => setState((current) => returnTicket(current, id, note)),
    triage: (id, action) => setState((current) => triageTicket(current, id, action)),
  };
  const pass = () => {
    const passed = letTimePass(state);
    setState(passed.state);
    if (passed.events.length === 0) {
      toastInfo(W.pass.nothing);
      return;
    }
    for (const event of passed.events) {
      // A progress line reaches nobody: only what waits on the reader, or what a patrol files, is said.
      if (event.kind === "progress" || event.kind === "closed") continue;
      if (event.kind === "retro") {
        toastInfo(W.pass.events.retro(event.id));
        continue;
      }
      const ticket = passed.state.tickets.find((candidate) => candidate.id === event.id);
      if (ticket !== undefined) toastInfo(W.pass.events[event.kind](titleOf(ticket, W)));
    }
  };

  const running = state.stage === "running";
  const waiting = inboxCounts(state).waiting;
  const sessions = liveSessions(state);
  const shown = state.sessions.find((session) => session.id === sessionId);
  const ticketOfSession = (ticketId: string) =>
    state.tickets.find((ticket) => ticket.id === ticketId);
  const orgName = W.org.name;

  const sidebar = (
    <SidebarFrame
      switcher={
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{orgName}</span>
          {running && <OrgStatusPill org={{ status: "active" }} />}
        </div>
      }
      pinned={
        <SidebarNavArea>
          <NavRow
            label={W.nav.inbox}
            glyph={ICONS.bell}
            active={page === "inbox"}
            onClick={() => go("inbox")}
            {...(waiting > 0 ? { badge: <Pill tone="attention">{waiting}</Pill> } : {})}
          />
          <NavRow
            label={W.nav.lead}
            glyph={<PersonAvatar byline="lead" size={ICON_SIZE.navRow} />}
            active={page === "lead"}
            disabled={!running}
            onClick={() => go("lead")}
          />
          <NavRow
            label={S.nav.org.tickets}
            glyph={ICONS[COMPANY_NAV_ICONS.tickets]}
            active={page === "tickets"}
            disabled={!running}
            onClick={() => go("tickets")}
          />
          <NavRow
            label={W.nav.team}
            glyph={ICONS[COMPANY_NAV_ICONS.chart]}
            active={page === "team"}
            disabled={!running}
            onClick={() => go("team")}
          />
          <NavRow
            label={W.nav.handbook}
            glyph={ICONS[COMPANY_NAV_ICONS.handbook]}
            active={page === "handbook"}
            disabled={!running}
            onClick={() => {
              setHandbookPath(null);
              go("handbook");
            }}
          />
        </SidebarNavArea>
      }
      account={
        <div className="flex items-center gap-2 px-2 py-2 text-sm">
          <UserAvatar userId="you" displayName={W.nav.you} />
          <span className="min-w-0 truncate">{W.nav.you}</span>
        </div>
      }
    >
      {running && (
        <>
          <SidebarListHeader label={W.nav.sessions}>
            <span className="px-1 text-xs tabular-nums text-fg-subtle">{sessions.length}</span>
          </SidebarListHeader>
          <div className="px-2 pt-1">
            {sessions.length === 0 ? (
              <p className="px-2 py-1 text-xs text-fg-subtle">{W.nav.sessionsEmpty}</p>
            ) : (
              sessions.flatMap((session) => {
                const ticket = ticketOfSession(session.ticket);
                if (ticket === undefined) return [];
                const status = sessionStatus(state, session);
                return [
                  <NavRow
                    key={session.id}
                    density="sm"
                    label={titleOf(ticket, W)}
                    glyph={<PersonAvatar byline={ticket.owner} size={ICON_SIZE.rowLead} />}
                    active={page === "session" && sessionId === session.id}
                    tooltip={whoOf(ticket.owner, W)}
                    tooltipExtra
                    onClick={() => openSession(session.id)}
                    {...(status === "answer" || status === "review"
                      ? { badge: <Pill tone="attention">{W.waits[status]}</Pill> }
                      : {})}
                  />,
                ];
              })
            )}
          </div>
        </>
      )}
    </SidebarFrame>
  );

  let body: ReactNode;
  if (!running) {
    body = (
      <SetupPage onStart={(mission) => setState((current) => startCompany(current, mission))} />
    );
  } else if (page === "inbox") {
    body = (
      <InboxPage
        state={state}
        onOpen={openTicket}
        onTalk={() => go("lead")}
        onAuto={(id, auto) => setState((current) => setScheduleAuto(current, id, auto))}
      />
    );
  } else if (page === "lead") {
    body = (
      <LeadPage
        state={state}
        onSay={(text) => setState((current) => sayToLead(current, text))}
        onOpen={openTicket}
      />
    );
  } else if (page === "tickets") {
    body = <BoardPage state={state} onOpen={openTicket} />;
  } else if (page === "team") {
    body = <TeamPage state={state} onHire={() => go("lead")} onOpenSession={openSession} />;
  } else if (page === "session") {
    const ticket = shown === undefined ? undefined : ticketOfSession(shown.ticket);
    body =
      shown === undefined || ticket === undefined ? null : (
        <SessionPage
          key={shown.id}
          session={shown}
          ticket={ticket}
          status={sessionStatus(state, shown)}
          actions={actions}
          onSay={(text) => setState((current) => sayInSession(current, shown.id, text))}
          onOpenTicket={() => openTicket(ticket.id)}
        />
      );
  } else {
    body = (
      <HandbookPage
        state={state}
        selected={handbookPath}
        onSelect={setHandbookPath}
        onOpenTicket={openTicket}
      />
    );
  }

  return (
    <AppShell
      nav={sidebar}
      overlays={
        <>
          <Drawer open={menuOpen} side="left" onClose={() => setMenuOpen(false)}>
            {sidebar}
          </Drawer>
          {open !== undefined && (
            <TicketDialog
              ticket={open}
              sessions={sessionsOf(state, open.id)}
              statusOf={(session) => sessionStatus(state, session)}
              cost={costOf(state, open)}
              filed={state.handbook
                .filter((entry) => entry.ticket === open.id)
                .map((entry) => ({ path: entry.path, title: entryWords(entry, state, W).title }))}
              actions={actions}
              onOpenSession={openSession}
              onOpenHandbook={openHandbook}
              onClose={() => setOpenId(null)}
            />
          )}
        </>
      }
    >
      <MobileTopBar
        title={orgName}
        menuLabel={W.nav.openMenu}
        onMenu={() => setMenuOpen(true)}
        {...(waiting > 0 ? { menuBadge: <Pill tone="attention">{waiting}</Pill> } : {})}
      />
      <main className="min-h-0 flex-1 overflow-y-auto">{body}</main>
      {running && (
        <div
          data-slot="prototype-bar"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2 text-xs text-fg-muted"
        >
          <span className="min-w-0 flex-1">{W.pass.hint}</span>
          <Button size="sm" onClick={pass}>
            {W.pass.button}
          </Button>
        </div>
      )}
    </AppShell>
  );
}
