/**
 * The company-mode prototype: the proposed company mode as something to click through, built of
 * the Web App's own shell, rows, page frame and controls, on staged data (model.ts). It opens in
 * one of two places, and either can be restarted from the other:
 *
 * - setting up (`fresh`): a conversation with the lead, from the welcome to the plan the reader
 *   confirms (onboarding.tsx), after which the new company's first tickets start moving;
 * - day to day (`week`): a company a week in, opened on the first ticket that waits on the reader.
 *
 * Two columns once the company runs. The left is the line to the lead, the company's pages, and
 * the inbox in three groups (inbox.tsx); the right reads what the left names. No agent runs here:
 * the bar under the page moves every ticket one step when the reader asks, so they see what
 * reaches the inbox and what never does. The bar also holds the list of things to try.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AppShell,
  Button,
  Drawer,
  GlyphIcon,
  ICONS,
  MobileTopBar,
  Pill,
  SidebarFrame,
  toastInfo,
  UserAvatar,
} from "@prismshadow/penguin-ui";
import type { A2uiDrafts } from "@prismshadow/penguin-ui";
import type { CompanyStart } from "./frame";
import {
  acceptWork,
  answerAsk,
  answerHalt,
  answerProposal,
  askLead,
  did,
  fileRequest,
  freshState,
  groupCounts,
  letTimePass,
  openDraft,
  readTicket,
  rollback,
  runReview,
  sendBack,
  setGrade,
  setLimits,
  setModel,
  setTrigger,
  startCompany,
  submitBenchmark,
  ticketOf,
  ticketsIn,
  ticketWait,
  TOUR,
  weekState,
} from "./model";
import type { CompanyState, PassEvent } from "./model";
import type { Wait } from "./spec";
import { InboxList, PinnedRows, SetupSteps } from "./inbox";
import type { CompanyPage } from "./inbox";
import { LeadChat } from "./lead-chat";
import type { Drafts, TicketActions } from "./needs-you";
import { Onboarding } from "./onboarding";
import { HandbookPage, ReviewPage, RulesPage, TeamPage } from "./pages";
import { titleOf } from "./text";
import { TicketView } from "./ticket-view";
import type { TicketTab } from "./ticket-view";
import { useWords } from "./use-words";

type Pane = "ticket" | "lead" | CompanyPage;

const LEAD_DRAFT = "lead:composer";

interface View {
  state: CompanyState;
  pane: Pane;
  selected: string | null;
  tab: TicketTab;
  /** The sample company, rather than one the reader set up. */
  sample: boolean;
}

/** The order the opening ticket is picked in: a question first, then a breaker, then the rest. */
const OPEN_FIRST: Wait[] = ["ask", "halt", "decide", "accept"];

/** The ticket that waits on the reader most pressingly, else the first that moves. */
function firstTicket(state: CompanyState): string | null {
  const waiting = ticketsIn(state, "decide");
  for (const wait of OPEN_FIRST) {
    const found = waiting.find((ticket) => ticketWait(ticket) === wait);
    if (found !== undefined) return found.id;
  }
  return ticketsIn(state, "moving")[0]?.id ?? null;
}

/** What a pass says out loud, most important first; the rest only shows in the inbox. */
const SAID_FIRST: PassEvent["kind"][] = ["arrived", "halted", "asked", "passed", "returned"];
const SAID_AT_MOST = 3;

function opening(start: CompanyStart): View {
  if (start === "fresh") {
    return { state: freshState(), pane: "lead", selected: null, tab: "record", sample: false };
  }
  const state = weekState();
  const selected = firstTicket(state);
  return {
    state: selected === null ? state : readTicket(state, selected),
    pane: "ticket",
    selected,
    tab: "record",
    sample: true,
  };
}

function Tour({
  state,
  onRestart,
}: {
  state: CompanyState;
  onRestart: (start: CompanyStart) => void;
}) {
  const W = useWords();
  const lists = [
    {
      title: W.tour.onboarding,
      items: TOUR.onboarding,
      start: "fresh" as const,
      label: W.tour.switchTo.onboarding,
    },
    {
      title: W.tour.daily,
      items: TOUR.daily,
      start: "week" as const,
      label: W.tour.switchTo.daily,
    },
  ];
  return (
    <div className="space-y-6 px-4 py-4">
      {lists.map((list) => (
        <section key={list.title} aria-label={list.title} className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{list.title}</h3>
            <Button size="sm" variant="ghost" onClick={() => onRestart(list.start)}>
              {list.label}
            </Button>
          </div>
          <ul className="space-y-1.5">
            {list.items.map((item) => {
              const done = state.did.includes(item);
              return (
                <li key={item} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                      done
                        ? "border-transparent bg-tone-success-bg text-tone-success-fg"
                        : "border-line"
                    }`}
                  >
                    {done && <GlyphIcon d={ICONS.check} size={11} />}
                  </span>
                  <span className={done ? "text-fg-muted line-through" : "text-fg"}>
                    {W.tour.items[item]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CompanyPrototype({ start }: { start: CompanyStart }) {
  const W = useWords();
  const [view, setView] = useState<View>(() => opening(start));
  const { state, pane, selected, tab } = view;
  const setState = useCallback(
    (change: (current: CompanyState) => CompanyState) =>
      setView((current) => ({ ...current, state: change(current.state) })),
    [],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  // Every unsent word, by `<ticket id>:<what>`: decision cards keep theirs here through A2UI.
  const [held, setHeld] = useState<Record<string, unknown>>({});
  const heldRef = useRef(held);
  heldRef.current = held;

  const store = useMemo<A2uiDrafts>(
    () => ({
      load: (key) => heldRef.current[key],
      save: (key, value) => setHeld((current) => ({ ...current, [key]: value })),
      clear: (key) =>
        setHeld((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        }),
    }),
    [],
  );
  const drafts = useMemo<Drafts>(
    () => ({
      store,
      text: (key) => {
        const value = held[key];
        return typeof value === "string" ? value : "";
      },
      setText: (key, value) => (value === "" ? store.clear(key) : store.save(key, value)),
    }),
    [held, store],
  );
  const hasDraft = (id: string) =>
    Object.entries(held).some(([key, value]) => key.startsWith(`${id}:`) && value !== "");
  const forget = (id: string) =>
    setHeld((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${id}:`))),
    );

  const running = state.stage === "running";
  const show = (next: Pane) => {
    setView((current) => ({ ...current, pane: next }));
    setMenuOpen(false);
  };
  const openTicket = (id: string, onTab: TicketTab = "record") => {
    setView((current) => ({
      ...current,
      state: readTicket(current.state, id),
      pane: "ticket",
      selected: id,
      tab: onTab,
    }));
    setMenuOpen(false);
  };
  const setTab = (next: TicketTab) =>
    setView((current) => ({
      ...current,
      tab: next,
      state: next === "runs" ? did(current.state, "trace") : current.state,
    }));
  const restart = (from: CompanyStart) => {
    setView(opening(from));
    setHeld({});
    setTourOpen(false);
  };

  const actions: TicketActions = {
    answerAsk: (id, option, note, file) => {
      setState((current) => answerAsk(current, id, option, note, file));
      forget(id);
    },
    answerHalt: (id, choice) => setState((current) => answerHalt(current, id, choice)),
    accept: (id) => setState((current) => acceptWork(current, id)),
    sendBack: (id, text, paragraph) =>
      setState((current) => sendBack(current, id, text, paragraph ?? null)),
    openDraft: (id, index) => setState((current) => openDraft(current, id, index)),
    proposal: (id, accepted) => setState((current) => answerProposal(current, id, accepted)),
  };

  const pass = () => {
    const passed = letTimePass(state);
    setView((current) => ({ ...current, state: passed.state }));
    if (passed.events.length === 0) {
      toastInfo(W.pass.nothing);
      return;
    }
    const said = passed.events
      .filter((event) => SAID_FIRST.includes(event.kind))
      .sort((a, b) => SAID_FIRST.indexOf(a.kind) - SAID_FIRST.indexOf(b.kind))
      .slice(0, SAID_AT_MOST);
    for (const event of said) {
      const ticket = ticketOf(passed.state, event.id);
      if (ticket !== undefined) toastInfo(W.pass.events[event.kind](titleOf(ticket, W)));
    }
  };

  const waiting = groupCounts(state).decide;
  const open = pane === "ticket" && selected !== null ? ticketOf(state, selected) : undefined;
  const orgName = view.sample ? W.org.sample : W.org.fresh;
  const tagline = view.sample
    ? W.org.tagline
    : state.scenario === null
      ? W.steps.title
      : W.scenarios[state.scenario].label;
  const leadDraft = drafts.text(LEAD_DRAFT) !== "";
  const tourTotal = TOUR.onboarding.length + TOUR.daily.length;

  const sidebar = (
    <SidebarFrame
      switcher={
        <div className="flex min-w-0 flex-1 flex-col px-2 py-1.5">
          <span className="min-w-0 truncate text-sm font-semibold">{orgName}</span>
          <span className="min-w-0 truncate text-xs text-fg-muted">{tagline}</span>
        </div>
      }
      pinned={
        running ? (
          <PinnedRows
            current={pane === "ticket" ? null : pane}
            leadDraft={leadDraft}
            onLead={() => show("lead")}
            onPage={show}
          />
        ) : null
      }
      account={
        <div className="flex items-center gap-2 px-2 py-2 text-sm">
          <UserAvatar userId="you" displayName={W.you} />
          <span className="min-w-0 truncate">{W.you}</span>
        </div>
      }
    >
      {running ? (
        <InboxList
          state={state}
          selected={open?.id ?? null}
          hasDraft={hasDraft}
          onOpen={(id) => openTicket(id)}
        />
      ) : (
        <SetupSteps step={setupStep} />
      )}
    </SidebarFrame>
  );

  let body: ReactNode;
  if (!running) {
    body = (
      <Onboarding
        onDid={(item) => setState((current) => did(current, item))}
        onStep={setSetupStep}
        onStart={(setup) =>
          setView((current) => {
            const next = startCompany(current.state, setup);
            const first = firstTicket(next);
            return {
              state: first === null ? next : readTicket(next, first),
              pane: first === null ? "lead" : "ticket",
              selected: first,
              tab: "record",
              sample: false,
            };
          })
        }
      />
    );
  } else if (pane === "lead") {
    body = (
      <LeadChat
        state={state}
        draft={drafts.text(LEAD_DRAFT)}
        onDraft={(text) => drafts.setText(LEAD_DRAFT, text)}
        onAsk={(request, text) => setState((current) => askLead(current, request, text))}
        onFile={(line) => setState((current) => fileRequest(current, line))}
        onOpen={(id) => openTicket(id)}
      />
    );
  } else if (pane === "team") {
    body = (
      <TeamPage
        state={state}
        onModel={(member, model) => setState((c) => setModel(c, member, model))}
      />
    );
  } else if (pane === "rules") {
    body = (
      <RulesPage
        state={state}
        onLimits={(limits) => setState((c) => setLimits(c, limits))}
        onGrade={(action, grade) => setState((c) => setGrade(c, action, grade))}
        onTrigger={(trigger, on) => setState((c) => setTrigger(c, trigger, on))}
      />
    );
  } else if (pane === "handbook") {
    body = (
      <HandbookPage
        state={state}
        onOpen={(id) => openTicket(id)}
        onRollback={(member, v) => setState((c) => rollback(c, member, v))}
      />
    );
  } else if (pane === "review") {
    body = (
      <ReviewPage
        state={state}
        onRun={() => setState(runReview)}
        onSubmit={() => setState(submitBenchmark)}
        onOpen={(id) => openTicket(id)}
      />
    );
  } else if (open !== undefined) {
    body = (
      <TicketView
        key={open.id}
        ticket={open}
        state={state}
        actions={actions}
        drafts={drafts}
        tab={tab}
        onTab={setTab}
      />
    );
  } else {
    body = <p className="px-6 py-8 text-sm text-fg-muted">{W.nav.pick}</p>;
  }

  return (
    <AppShell
      nav={sidebar}
      overlays={
        <>
          <Drawer open={menuOpen} side="left" onClose={() => setMenuOpen(false)}>
            {sidebar}
          </Drawer>
          <Drawer
            open={tourOpen}
            side="right"
            title={W.tour.title}
            onClose={() => setTourOpen(false)}
          >
            <Tour state={state} onRestart={restart} />
          </Drawer>
        </>
      }
    >
      <MobileTopBar
        title={orgName}
        menuLabel={W.nav.openMenu}
        onMenu={() => setMenuOpen(true)}
        {...(waiting > 0 ? { menuBadge: <Pill tone="attention">{waiting}</Pill> } : {})}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</main>
      <div
        data-slot="prototype-bar"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2 text-xs text-fg-muted"
      >
        <span className="min-w-0 flex-1">{W.pass.hint}</span>
        <Button size="sm" variant="ghost" onClick={() => setTourOpen(true)}>
          {W.tour.open(state.did.length, tourTotal)}
        </Button>
        {running && (
          <Button size="sm" variant="primary" onClick={pass}>
            {W.pass.button}
          </Button>
        )}
      </div>
    </AppShell>
  );
}
