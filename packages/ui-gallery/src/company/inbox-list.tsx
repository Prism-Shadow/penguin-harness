/**
 * The left column: the inbox as the company's whole navigation. At its head, the line to the lead,
 * for anything new (⌘K or Ctrl+K from anywhere). Under it, one folding group per view of the
 * tickets, side by side at one level: what waits on the reader, what is in progress, what they
 * set aside for later, what is handled, what is archived; then the schedules, the daily patrol
 * and the weekly retrospective. What needs the reader or is moving starts open; the piles start
 * folded. Each ticket row reads like a mail: its title, and under it what it asks, what it
 * delivered, or its last progress line.
 *
 * The shipped sidebar's pages and the list of running sessions are gone from here: a session is a
 * tab of its ticket, and the team, the handbook and the board are on the main column's bar.
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
  SidebarNavArea,
} from "@prismshadow/penguin-ui";
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
    <div className="flex flex-col gap-1 px-2 pb-3">
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
  );
}

/** The pinned line to the lead, at the column's head. */
export function TalkRow({
  active,
  disabled,
  onTalk,
}: {
  active: boolean;
  disabled: boolean;
  onTalk: () => void;
}) {
  const W = useWords();
  return (
    <SidebarNavArea>
      <NavRow
        label={W.nav.talk}
        glyph={<PersonAvatar byline="lead" size={16} />}
        active={active}
        disabled={disabled}
        surface="muted"
        tooltip={W.nav.talkHint}
        tooltipExtra
        badge={<Kbd keys={TALK_KEYS} variant="plain" className="text-fg-subtle" />}
        onClick={onTalk}
      />
    </SidebarNavArea>
  );
}
