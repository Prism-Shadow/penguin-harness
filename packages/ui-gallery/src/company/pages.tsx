/**
 * The prototype's pages, in the shipped company mode's page frame and with its controls.
 *
 * - The schedules: the daily patrol and the weekly retrospective, each filing tickets on its own.
 * - The lead is the one conversation: what the reader says becomes a ticket, and the lead's
 *   lines name tickets, never the work.
 * - The board is the shipped five columns, unchanged; a card that waits says what for.
 * - The lead's first answer takes its proposals one by one, or all at once. Setting up is
 *   setup-page.tsx.
 */
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Button,
  ICON_SIZE,
  MessageBubble,
  PageFrame,
  PageHeader,
  Segmented,
  Textarea,
} from "@prismshadow/penguin-ui";
import { S } from "../../../web/src/lib/strings";
import { PriorityBadge, TitleButton } from "../../../web/src/features/company/shared";
import { toneDot } from "../../../web/src/lib/tone";
import type { ChatLine, CompanyState, PatrolMode, ScheduleId } from "./model";
import { TICKET_STATUSES, waitOf } from "./spec";
import type { TicketStatus } from "./spec";
import { PersonAvatar, PersonName } from "./people";
import { gistOf, titleOf } from "./text";
import { Standing } from "./ticket-pane";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";

/**
 * The schedules, where the inbox column's schedule rows open: when each runs, and how the patrol
 * runs, the same three ways the setup offered (off, proposing, or starting work). A
 * retrospective's proposals always wait for the reader.
 */
export function SchedulesPage({
  state,
  onPatrol,
}: {
  state: CompanyState;
  onPatrol: (mode: PatrolMode) => void;
}) {
  const W = useWords();
  const row = (id: ScheduleId, control: ReactNode) => (
    <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate">{W.schedule.names[id]}</span>
        <span className={`block text-xs ${QUIET}`}>{W.schedule.when[id]}</span>
      </span>
      {control}
    </li>
  );
  return (
    <PageFrame width="lg">
      <PageHeader title={W.inbox.schedules} info={W.schedule.info} />
      <ul className="divide-y divide-line">
        {row("retro", <span className={`shrink-0 text-xs ${QUIET}`}>{W.schedule.autoOff}</span>)}
        {row(
          "patrol",
          <div className="w-full sm:w-72">
            <Segmented<PatrolMode>
              cols={3}
              value={state.settings.patrol}
              onChange={onPatrol}
              options={(["off", "propose", "auto"] as const).map((mode) => ({
                value: mode,
                label: W.schedule.modes[mode],
              }))}
            />
          </div>,
        )}
      </ul>
    </PageFrame>
  );
}

/** What the reader can do to a proposal from the lead's conversation. */
export interface ProposalActions {
  accept: (id: string) => void;
  reject: (id: string) => void;
  acceptAll: (ids: readonly string[]) => void;
}

function ChatMessage({
  line,
  state,
  onOpen,
  actions,
}: {
  line: ChatLine;
  state: CompanyState;
  onOpen: (id: string) => void;
  actions: ProposalActions;
}) {
  const W = useWords();
  const ticketOf = (id: string) => state.tickets.find((ticket) => ticket.id === id);
  if (line.from === "person") {
    const about = "about" in line ? ticketOf(line.about) : undefined;
    return (
      <div className="flex justify-end">
        <MessageBubble variant="user">
          {"text" in line ? line.text : about !== undefined ? gistOf(about, W) : ""}
        </MessageBubble>
      </div>
    );
  }
  const tickets = line.tickets.flatMap((id) => {
    const ticket = ticketOf(id);
    return ticket === undefined ? [] : [ticket];
  });
  // The lead's first answer is decided where it is said: each proposal, or all that still wait.
  const deciding = line.line === "proposals";
  const open = deciding ? tickets.filter((ticket) => waitOf(ticket) === "accept") : [];
  return (
    <div className="text-sm leading-relaxed text-fg">
      <p>{W.lead.lines[line.line]}</p>
      <ul
        className={deciding ? "mt-3 divide-y divide-line border-y border-line" : "mt-2 space-y-1"}
      >
        {tickets.map((ticket) => (
          <li
            key={ticket.id}
            className={
              deciding
                ? "flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
                : "flex items-center gap-2"
            }
          >
            <span
              className={deciding ? "min-w-0 flex-1 basis-60" : "flex min-w-0 items-center gap-2"}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Standing ticket={ticket} />
                <TitleButton className="truncate" onClick={() => onOpen(ticket.id)}>
                  {titleOf(ticket, W)}
                </TitleButton>
              </span>
              {deciding && <span className={`block text-xs ${QUIET}`}>{gistOf(ticket, W)}</span>}
            </span>
            {deciding && waitOf(ticket) === "accept" && (
              <span className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => actions.reject(ticket.id)}>
                  {W.ticket.reject}
                </Button>
                <Button size="sm" onClick={() => actions.accept(ticket.id)}>
                  {W.ticket.accept}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {open.length > 1 && (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="primary"
            onClick={() => actions.acceptAll(open.map((ticket) => ticket.id))}
          >
            {W.lead.acceptAll}
          </Button>
        </div>
      )}
    </div>
  );
}

export function LeadPage({
  state,
  focus = false,
  onSay,
  onOpen,
  actions,
}: {
  state: CompanyState;
  /** The reader asked for the lead: its box takes the focus. */
  focus?: boolean;
  onSay: (text: string) => void;
  onOpen: (id: string) => void;
  actions: ProposalActions;
}) {
  const W = useWords();
  const [draft, setDraft] = useState("");
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (draft.trim() === "") return;
    onSay(draft);
    setDraft("");
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <PersonAvatar byline="lead" size={18} />
        <h1 className="shrink-0 text-sm font-semibold">
          <PersonName byline="lead" />
        </h1>
        <span className={`min-w-0 truncate text-xs ${QUIET}`}>{W.lead.info}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          {state.chat.length === 0 ? (
            <p className={`text-xs ${QUIET}`}>{W.lead.empty}</p>
          ) : (
            state.chat.map((line, i) => (
              <ChatMessage key={i} line={line} state={state} onOpen={onOpen} actions={actions} />
            ))
          )}
        </div>
      </div>
      <form
        onSubmit={send}
        className="mx-auto flex w-full max-w-3xl shrink-0 items-end gap-2 px-4 pb-4"
      >
        <div className="min-w-0 flex-1">
          <Textarea
            size="sm"
            rows={2}
            aria-label={W.lead.placeholder}
            placeholder={W.lead.placeholder}
            autoFocus={focus}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)
                send(event);
            }}
          />
        </div>
        <Button size="sm" variant="primary" type="submit" disabled={draft.trim() === ""}>
          {W.lead.send}
        </Button>
      </form>
    </div>
  );
}

/** The shipped board's column marks, by status. */
const COLUMN_BAR: Record<TicketStatus, string> = {
  proposed: "bg-line-emphasis",
  in_progress: "bg-accent",
  review: toneDot.attention,
  done: toneDot.success,
  rejected: toneDot.danger,
};

export function BoardPage({
  state,
  onOpen,
}: {
  state: CompanyState;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  const T = S.company.tickets;
  return (
    <PageFrame width="full">
      <PageHeader title={S.nav.org.tickets} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        {TICKET_STATUSES.map((status) => {
          const tickets = state.tickets.filter((ticket) => ticket.status === status).reverse();
          return (
            <section
              key={status}
              aria-label={T.columns[status] ?? status}
              className="flex min-h-40 flex-col rounded-md border border-line bg-surface-muted md:min-h-[26rem]"
            >
              <div className={`h-1 rounded-t-md ${COLUMN_BAR[status]}`} />
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="text-xs font-semibold text-fg">{T.columns[status] ?? status}</span>
                <span className={`text-xs tabular-nums ${QUIET}`}>{tickets.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {tickets.length === 0 && (
                  <p className={`py-6 text-center text-xs ${QUIET}`}>{T.columnEmpty}</p>
                )}
                {tickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => onOpen(ticket.id)}
                    className="rounded-md border border-line bg-surface p-2.5 text-left text-sm transition-[border-color] duration-150 hover:border-line-emphasis"
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">{titleOf(ticket, W)}</span>
                      <span className="shrink-0">
                        <PriorityBadge priority={ticket.priority} />
                      </span>
                    </span>
                    <span className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${QUIET}`}>
                      <PersonAvatar byline={ticket.owner} size={ICON_SIZE.rowLead} />
                      <PersonName byline={ticket.owner} />
                      {waitOf(ticket) !== null && (
                        <span className="ml-auto">
                          <Standing ticket={ticket} />
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </PageFrame>
  );
}
