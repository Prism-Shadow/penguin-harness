/**
 * The left column: the inbox as the company's whole navigation. At its head, the line to the lead,
 * for anything new (⌘K or Ctrl+K from anywhere). Under it, the tickets in three runs: what waits
 * on the reader, what is in progress, and the schedules that file tickets on their own. Each
 * ticket row reads like a mail: its title, and under it what it asks, what it delivered, or its
 * last progress line. The reader's own piles (later, handled, archived) are one line at the foot,
 * and each opens in the column's place, with the way back.
 *
 * The shipped sidebar's pages and the list of running sessions are gone from here: a session is a
 * tab of its ticket, and the team, the handbook and the board are on the main column's bar.
 */
import {
  Kbd,
  NAV_FILL,
  NavRow,
  Pill,
  SidebarListHeader,
  SidebarNavArea,
} from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { RETRO_EVERY } from "./fixtures";
import { closedSinceRetro, inboxCounts, ticketsIn } from "./model";
import type { CompanyState, Ticket } from "./model";
import { PersonAvatar } from "./people";
import { waitOf } from "./spec";
import type { InboxView } from "./spec";
import { lineOf, progressOf, titleOf } from "./text";
import { useWords } from "./use-words";

/** The reader's own piles, kept apart from the work: one line at the column's foot. */
export const ASIDE_VIEWS = ["later", "handled", "archived"] as const;
export type AsideView = (typeof ASIDE_VIEWS)[number];

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

export function InboxList({
  state,
  selected,
  aside,
  schedulesOpen,
  onOpen,
  onAside,
  onSchedules,
}: {
  state: CompanyState;
  /** The ticket on show in the main column, if one is. */
  selected: string | null;
  /** One of the reader's piles in the column's place, or null for the inbox. */
  aside: AsideView | null;
  /** The schedules are on show in the main column. */
  schedulesOpen: boolean;
  onOpen: (id: string) => void;
  onAside: (view: AsideView | null) => void;
  onSchedules: () => void;
}) {
  const W = useWords();
  const running = state.stage === "running";
  const counts = inboxCounts(state);
  const group = (view: InboxView, empty: string): ReactNode => {
    const tickets = ticketsIn(state, view);
    return (
      <section aria-label={W.views[view]}>
        <SidebarListHeader label={W.views[view]}>
          <span className="px-1 text-xs tabular-nums text-fg-subtle">{tickets.length}</span>
        </SidebarListHeader>
        {tickets.length === 0 ? (
          <p className="px-4 pb-3 pt-1 text-xs text-fg-subtle">{empty}</p>
        ) : (
          <TicketRows tickets={tickets} selected={selected} onOpen={onOpen} />
        )}
      </section>
    );
  };

  if (aside !== null) {
    return (
      <div className="flex flex-col">
        <div className="px-2 pt-1">
          <NavRow
            label={`‹ ${W.nav.inbox}`}
            density="sm"
            surface="muted"
            onClick={() => onAside(null)}
          />
        </div>
        {group(aside, W.inbox.empty[aside])}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {group("waiting", running ? W.inbox.empty.waiting : W.nav.notStarted)}
      {running && group("working", W.inbox.empty.working)}
      {running && (
        <section aria-label={W.inbox.schedules}>
          <SidebarListHeader label={W.inbox.schedules}>
            <span className="px-1 text-xs tabular-nums text-fg-subtle">
              {state.schedules.length}
            </span>
          </SidebarListHeader>
          <div className="flex flex-col gap-px px-2 pb-2">
            {state.schedules.map((schedule) => (
              <Row
                key={schedule.id}
                active={schedulesOpen}
                onClick={onSchedules}
                leading={<PersonAvatar byline="lead" size={16} />}
                title={W.tickets[schedule.id].title}
                line={schedule.auto ? W.schedule.autoOn : W.schedule.autoOff}
              />
            ))}
            <Row
              active={schedulesOpen}
              onClick={onSchedules}
              leading={<PersonAvatar byline="lead" size={16} />}
              title={W.inbox.retroTitle}
              line={W.inbox.retroProgress(closedSinceRetro(state), RETRO_EVERY)}
            />
          </div>
        </section>
      )}
      {running && (
        <p className="flex flex-wrap gap-x-1 px-4 pb-3 pt-2 text-xs text-fg-muted">
          {ASIDE_VIEWS.map((view, i) => (
            <span key={view} className="flex items-center gap-x-1">
              {i > 0 && <span aria-hidden="true">·</span>}
              <button
                type="button"
                className="rounded-sm hover:text-fg"
                onClick={() => onAside(view)}
              >
                {W.views[view]} <span className="tabular-nums">{counts[view]}</span>
              </button>
            </span>
          ))}
        </p>
      )}
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
