/**
 * The company-mode prototype: the proposed company mode as something to click through, built of
 * the Web App's own shell, rows, page frame, ticket badges and controls, on staged data
 * (model.ts). It is the spec's main exhibit: what the mode shows first, where a decision is
 * taken, and what never reaches the reader.
 *
 * Two columns. The left is the inbox, and it is the whole navigation (inbox-list.tsx): the line
 * to the lead, what waits on the reader, what is in progress, the schedules. The right reads what
 * the left names: a ticket, its record and its work sessions as tabs (ticket-pane.tsx), the
 * lead's conversation, or the schedules. It opens on the first ticket that waits on the reader.
 * The team, the handbook and the board are on the bar above the right column, with what the
 * company has spent; they are where the reader looks now and then, not where the work is.
 *
 * No agent runs here. The bar under the page moves every work session one step when the reader
 * asks, so they see a ticket come to the inbox and nothing else change.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AppShell,
  Button,
  Drawer,
  MobileTopBar,
  Pill,
  SidebarFrame,
  toastInfo,
  UserAvatar,
} from "@prismshadow/penguin-ui";
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
  readTicket,
  rejectTicket,
  returnTicket,
  sayInSession,
  sayToLead,
  sessionsOf,
  sessionStatus,
  setScheduleAuto,
  spendOf,
  startCompany,
  ticketsIn,
  triageTicket,
  weekState,
} from "./model";
import type { CompanyState } from "./model";
import { entryWords, HandbookPage } from "./handbook-page";
import { InboxList, TalkRow } from "./inbox-list";
import type { AsideView } from "./inbox-list";
import type { TicketActions } from "./needs-you";
import { BoardPage, LeadPage, SchedulesPage, SetupPage } from "./pages";
import { TeamPage } from "./team-page";
import { money, titleOf } from "./text";
import { TicketPane } from "./ticket-pane";
import type { TicketTab } from "./ticket-pane";
import { useWords } from "./use-words";

/** What the right column shows. */
type Pane = "ticket" | "lead" | "schedules" | "team" | "handbook" | "board";

/** The bar's pages, in its order. */
const BAR: readonly ("team" | "handbook" | "board")[] = ["team", "handbook", "board"];

/** The first ticket that waits on the reader, else the first in progress. */
function firstTicket(state: CompanyState): string | null {
  return (ticketsIn(state, "waiting")[0] ?? ticketsIn(state, "working")[0])?.id ?? null;
}

interface View {
  state: CompanyState;
  pane: Pane;
  selected: string | null;
}

/** Where the prototype opens: the week on its first waiting ticket, read; a new company on setup. */
function opening(start: CompanyStart): View {
  if (start === "fresh") return { state: freshState(), pane: "lead", selected: null };
  const state = weekState();
  const selected = firstTicket(state);
  return {
    state: selected === null ? state : readTicket(state, selected),
    pane: "ticket",
    selected,
  };
}

export function CompanyPrototype({ start }: { start: CompanyStart }) {
  const W = useWords();
  const [first] = useState(() => opening(start));
  const [state, setState] = useState<CompanyState>(first.state);
  const [pane, setPane] = useState<Pane>(first.pane);
  const [selected, setSelected] = useState<string | null>(first.selected);
  const [tab, setTab] = useState<TicketTab>("record");
  const [aside, setAside] = useState<AsideView | null>(null);
  const [handbookPath, setHandbookPath] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // Bumped each time the reader asks for the lead, so its box takes the focus again.
  const [talkTurn, setTalkTurn] = useState(0);

  const running = state.stage === "running";
  const show = (next: Pane) => {
    setPane(next);
    setMenuOpen(false);
  };
  const openTicket = (id: string, onTab: TicketTab = "record") => {
    setState((current) => readTicket(current, id));
    setSelected(id);
    setTab(onTab);
    show("ticket");
  };
  const openSession = (id: string) => {
    const session = state.sessions.find((candidate) => candidate.id === id);
    if (session !== undefined) openTicket(session.ticket, id);
  };
  const openHandbook = (path: string) => {
    setHandbookPath(path);
    show("handbook");
  };
  const talk = () => {
    if (!running) return;
    setTalkTurn((turn) => turn + 1);
    show("lead");
  };

  // ⌘K or Ctrl+K reaches the lead from anywhere in the window.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        talk();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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

  const waiting = inboxCounts(state).waiting;
  const open =
    pane === "ticket" ? state.tickets.find((ticket) => ticket.id === selected) : undefined;
  const orgName = W.org.name;

  const sidebar = (
    <SidebarFrame
      switcher={
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{orgName}</span>
          {running && <OrgStatusPill org={{ status: "active" }} />}
        </div>
      }
      pinned={<TalkRow active={pane === "lead"} disabled={!running} onTalk={talk} />}
      account={
        <div className="flex items-center gap-2 px-2 py-2 text-sm">
          <UserAvatar userId="you" displayName={W.nav.you} />
          <span className="min-w-0 truncate">{W.nav.you}</span>
        </div>
      }
    >
      <InboxList
        state={state}
        selected={open?.id ?? null}
        aside={aside}
        schedulesOpen={pane === "schedules"}
        onOpen={(id) => openTicket(id)}
        onAside={setAside}
        onSchedules={() => show("schedules")}
      />
    </SidebarFrame>
  );

  let body: ReactNode;
  if (!running) {
    body = (
      <SetupPage onStart={(mission) => setState((current) => startCompany(current, mission))} />
    );
  } else if (pane === "lead") {
    body = (
      <LeadPage
        key={talkTurn}
        state={state}
        focus={talkTurn > 0}
        onSay={(text) => setState((current) => sayToLead(current, text))}
        onOpen={(id) => openTicket(id)}
      />
    );
  } else if (pane === "schedules") {
    body = (
      <SchedulesPage
        state={state}
        onAuto={(id, auto) => setState((current) => setScheduleAuto(current, id, auto))}
      />
    );
  } else if (pane === "board") {
    body = <BoardPage state={state} onOpen={(id) => openTicket(id)} />;
  } else if (pane === "team") {
    body = <TeamPage state={state} onHire={talk} onOpenSession={openSession} />;
  } else if (pane === "handbook") {
    body = (
      <HandbookPage
        state={state}
        selected={handbookPath}
        onSelect={setHandbookPath}
        onOpenTicket={(id) => openTicket(id)}
      />
    );
  } else if (open !== undefined) {
    body = (
      <TicketPane
        key={open.id}
        ticket={open}
        sessions={sessionsOf(state, open.id)}
        statusOf={(session) => sessionStatus(state, session)}
        cost={costOf(state, open)}
        filed={state.handbook
          .filter((entry) => entry.ticket === open.id)
          .map((entry) => ({ path: entry.path, title: entryWords(entry, state, W).title }))}
        actions={actions}
        tab={tab}
        onTab={setTab}
        onSay={(session, text) => setState((current) => sayInSession(current, session, text))}
        onOpenHandbook={openHandbook}
      />
    );
  } else {
    body = <p className="px-6 py-8 text-sm text-fg-muted">{W.nav.pick}</p>;
  }

  const budget = Object.values(state.budgets).reduce((sum, value) => sum + value, 0);
  return (
    <AppShell
      nav={sidebar}
      overlays={
        <Drawer open={menuOpen} side="left" onClose={() => setMenuOpen(false)}>
          {sidebar}
        </Drawer>
      }
    >
      <MobileTopBar
        title={orgName}
        menuLabel={W.nav.openMenu}
        onMenu={() => setMenuOpen(true)}
        {...(waiting > 0 ? { menuBadge: <Pill tone="attention">{waiting}</Pill> } : {})}
      />
      {running && (
        <div
          data-slot="company-bar"
          className="flex shrink-0 flex-wrap items-center justify-end gap-x-1 gap-y-1 border-b border-line px-3 py-1.5"
        >
          <span className="hidden min-w-0 flex-1 truncate px-1 text-xs tabular-nums text-fg-muted sm:block">
            {W.nav.spend(money(spendOf(state)), money(budget))}
          </span>
          {BAR.map((page) => (
            <Button
              key={page}
              size="sm"
              variant="ghost"
              aria-pressed={pane === page}
              className={pane === page ? "text-fg" : "text-fg-muted"}
              onClick={() => {
                if (page === "handbook") setHandbookPath(null);
                show(page);
              }}
            >
              {W.nav[page]}
            </Button>
          ))}
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</main>
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
