/**
 * The left column, laid out as the Agent sidebar is. Its fixed block holds the line to the lead,
 * for anything new (⌘K or Ctrl+K from anywhere), where New chat sits, and the team, the handbook
 * and the board as page rows. Under it, at the level of the Agent sidebar's Workspaces, the
 * inbox: one folding group per view of the
 * tickets, side by side at one level: what waits on the reader, what is in progress, what they
 * set aside for later, what is handled, what is archived; then the schedules, the daily patrol
 * and the weekly retrospective. What needs the reader or is moving starts open; the piles start
 * folded. Each ticket row reads like a mail: its title, and under it what it asks, what it
 * delivered, or its last progress line.
 *
 * The list of running sessions is gone from here: a session is a tab of its ticket.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Fold,
  GroupHeader,
  ICONS,
  Kbd,
  NAV_FILL,
  NavRow,
  Pill,
  SidebarListHeader,
  SidebarNavArea,
} from "@prismshadow/penguin-ui";
import { COMPANY_NAV_ICONS } from "../../../web/src/features/company/company-nav-icons";
import { ticketsIn } from "./model";
import type { CompanyState, Ticket } from "./model";
import { PersonAvatar } from "./people";
import { INBOX_VIEWS, waitOf } from "./spec";
import type { InboxView } from "./spec";
import { lineOf, progressOf, titleOf } from "./text";
import { useWords } from "./use-words";

/** The shortcut to the lead, as this platform writes it. */
export const TALK_KEYS: readonly string[] =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? ["⌘K"]
    : ["Ctrl", "K"];

const ROW = "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors";

function Row({
  active,
  onClick,
  leading,
  title,
  strong = false,
  mark,
  line,
}: {
  active: boolean;
  onClick: () => void;
  leading: ReactNode;
  title: string;
  /** Unread: the title in the heavier weight. */
  strong?: boolean;
  /** One mark at the title's end: what the ticket waits for. */
  mark?: ReactNode;
  line: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`${ROW} ${active ? `${NAV_FILL.selected} duration-200` : `${NAV_FILL.hover} duration-150`}`}
    >
      <span className="mt-0.5 shrink-0">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-sm text-fg ${strong ? "font-semibold" : ""}`}
          >
            {title}
          </span>
          {mark}
        </span>
        <span className="block truncate text-xs text-fg-muted">{line}</span>
      </span>
    </button>
  );
}

function TicketRows({
  tickets,
  selected,
  onOpen,
}: {
  tickets: readonly Ticket[];
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  return (
    <div className="flex flex-col gap-px px-2 pb-2">
      {tickets.map((ticket) => {
        const wait = waitOf(ticket);
        // In progress, a row says how far the work has got; otherwise what the ticket is.
        const last =
          wait === null && ticket.status === "in_progress"
            ? progressOf(ticket, W).at(-1)
            : undefined;
        return (
          <Row
            key={ticket.id}
            active={selected === ticket.id}
            onClick={() => onOpen(ticket.id)}
            leading={<PersonAvatar byline={ticket.owner} size={16} />}
            title={titleOf(ticket, W)}
            strong={ticket.unread}
            {...(wait !== null ? { mark: <Pill tone="attention">{W.waits[wait]}</Pill> } : {})}
            line={last ?? lineOf(ticket, W)}
          />
        );
      })}
    </div>
  );
}

/** Each group's glyph, by what it holds. */
const GROUP_GLYPH: Record<InboxView | "schedules", string> = {
  waiting: ICONS.bell,
  working: ICONS.play,
  later: ICONS.clock,
  handled: ICONS.checkCircle,
  archived: ICONS.archive,
  schedules: ICONS.calendar,
};

/** Open until the reader folds them: what needs them, what is moving, and the schedules. */
const OPEN_AT_FIRST: Record<InboxView | "schedules", boolean> = {
  waiting: true,
  working: true,
  later: false,
  handled: false,
  archived: false,
  schedules: true,
};

export function InboxList({
  state,
  selected,
  schedulesOpen,
  onOpen,
  onSchedules,
}: {
  state: CompanyState;
  /** The ticket on show in the main column, if one is. */
  selected: string | null;
  /** The schedules are on show in the main column. */
  schedulesOpen: boolean;
  onOpen: (id: string) => void;
  onSchedules: () => void;
}) {
  const W = useWords();
  const [open, setOpen] = useState(OPEN_AT_FIRST);
  const toggle = (group: InboxView | "schedules") =>
    setOpen((current) => ({ ...current, [group]: !current[group] }));
  if (state.stage !== "running") {
    return <p className="px-4 py-2 text-xs text-fg-subtle">{W.nav.notStarted}</p>;
  }
  return (
    <div className="flex flex-col pb-3">
      {/* The inbox's own header, at the level of the Agent sidebar's Workspaces. */}
      <SidebarListHeader label={W.nav.inbox}>{null}</SidebarListHeader>
      <div className="flex flex-col gap-1 px-2 pt-1">
        {INBOX_VIEWS.map((view) => {
          const tickets = ticketsIn(state, view);
          return (
            <section key={view} aria-label={W.views[view]}>
              <GroupHeader
                open={open[view]}
                onToggle={() => toggle(view)}
                glyph={GROUP_GLYPH[view]}
                label={W.views[view]}
                count={tickets.length}
              />
              <Fold open={open[view]}>
                {() =>
                  tickets.length === 0 ? (
                    <p className="px-7 pb-2 pt-0.5 text-xs text-fg-subtle">{W.inbox.empty[view]}</p>
                  ) : (
                    <TicketRows tickets={tickets} selected={selected} onOpen={onOpen} />
                  )
                }
              </Fold>
            </section>
          );
        })}
        <section aria-label={W.inbox.schedules}>
          <GroupHeader
            open={open.schedules}
            onToggle={() => toggle("schedules")}
            glyph={GROUP_GLYPH.schedules}
            label={W.inbox.schedules}
            count={state.schedules.length}
          />
          <Fold open={open.schedules}>
            {() => (
              <div className="flex flex-col gap-px pb-2">
                {state.schedules.map((schedule) => (
                  <Row
                    key={schedule.id}
                    active={schedulesOpen}
                    onClick={onSchedules}
                    leading={<PersonAvatar byline="lead" size={16} />}
                    title={W.schedule.names[schedule.id]}
                    line={`${W.schedule.when[schedule.id]} · ${
                      schedule.auto ? W.schedule.autoOn : W.schedule.autoOff
                    }`}
                  />
                ))}
              </div>
            )}
          </Fold>
        </section>
      </div>
    </div>
  );
}

/** The pages the column links to, under the line to the lead, as the Agent sidebar's page rows. */
export type CompanyPage = "team" | "handbook" | "board";

const PAGE_GLYPH: Record<CompanyPage, string> = {
  team: ICONS[COMPANY_NAV_ICONS.chart],
  handbook: ICONS[COMPANY_NAV_ICONS.handbook],
  board: ICONS[COMPANY_NAV_ICONS.tickets],
};

/**
 * The fixed block at the column's head, the place the Agent sidebar keeps New chat and its pages:
 * the line to the lead, in New chat's weight, then the team, the handbook and the board.
 */
export function PinnedRows({
  current,
  running,
  onTalk,
  onPage,
}: {
  /** What the main column shows, when it is one of these. */
  current: "lead" | CompanyPage | null;
  running: boolean;
  onTalk: () => void;
  onPage: (page: CompanyPage) => void;
}) {
  const W = useWords();
  return (
    <SidebarNavArea>
      <NavRow
        surface="muted"
        label={W.nav.talk}
        glyph={<PersonAvatar byline="lead" size={16} />}
        active={current === "lead"}
        disabled={!running}
        tooltip={W.nav.talkHint}
        tooltipExtra
        badge={<Kbd keys={TALK_KEYS} variant="plain" className="text-fg-subtle" />}
        onClick={onTalk}
        className="font-medium"
      />
      {(["team", "handbook", "board"] as const).map((page) => (
        <NavRow
          key={page}
          surface="muted"
          label={W.nav[page]}
          glyph={PAGE_GLYPH[page]}
          active={current === page}
          disabled={!running}
          onClick={() => onPage(page)}
        />
      ))}
    </SidebarNavArea>
  );
}
