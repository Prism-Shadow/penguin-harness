/**
 * The company-mode player: one scripted day of one inbox, replayed event by event in the frame the
 * AMSP player uses (replay-frame.tsx). Tabs pick the run (a patrol that proposes work, a request
 * that stops on one question, a delivery), each starting from the inbox the one before it left.
 *
 * The left pane lists the events as they happen: the time, who acted, what they did. The right
 * pane is what the person has: the inbox, ordered as the spec orders it, and under it the file of
 * the run's ticket, its path and the fields the run writes.
 *
 * Colour says one thing (lib/company-tones.ts, with the legend in the events pane's header): an
 * event on the amber ground left a ticket waiting on the person, and the same amber names what
 * that ticket waits for in the inbox. An unread ticket is told by its title's weight, and by a
 * word for a screen reader.
 */
import { S } from "../lib/strings";
import { foldInbox, SCENARIOS, ticketFileLines, ticketPath } from "../lib/company-demo";
import type { Actor, DemoEvent, DemoTicket } from "../lib/company-demo";
import { inboxOrder, waitOf } from "../lib/company-spec";
import { COMPANY_TONES } from "../lib/company-tones";
import { ReplayFrame } from "./replay-frame";

/** A beat between events a reader can follow; the first one comes sooner. */
const FIRST_STEP_MS = 500;
const STEP_MS = 1100;
const delayOf = (_run: number, shown: number) => (shown === 0 ? FIRST_STEP_MS : STEP_MS);

const PANE = "min-w-0 bg-gray-50 px-3 pt-2 pb-2 dark:bg-gray-900";
const PANE_LABEL = "text-xs font-semibold text-gray-500 dark:text-gray-400";
const QUIET = "text-gray-500 dark:text-gray-400";

export function InboxPlayer() {
  const P = S.company.player;
  return (
    <ReplayFrame
      label={P.label}
      runs={SCENARIOS.map((scenario) => ({
        id: scenario.id,
        label: P.scenarios[scenario.id],
        total: scenario.steps.length,
      }))}
      delayOf={delayOf}
      labels={P}
    >
      {(run, shown) => <Panel run={run} shown={shown} />}
    </ReplayFrame>
  );
}

/** A run after its first `shown` events: the events beside the inbox and the ticket's file. */
function Panel({ run, shown }: { run: number; shown: number }) {
  const P = S.company.player;
  const { tickets, events } = foldInbox(run, shown);
  const subject = tickets.find((candidate) => candidate.id === SCENARIOS[run]!.subject);
  return (
    <div className="grid h-full gap-px bg-gray-200 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] dark:bg-gray-800">
      <section className={PANE}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className={PANE_LABEL}>{P.events}</h3>
          <span className={`inline-flex items-center gap-1.5 text-xs ${QUIET}`}>
            <span
              aria-hidden="true"
              className={`h-2.5 w-4 rounded-sm ${COMPANY_TONES.waiting.fill}`}
            />
            {P.reachesYou}
          </span>
        </div>
        <ol aria-live="off" className="mt-1 text-xs">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ol>
      </section>

      <section className={`${PANE} flex flex-col gap-3`}>
        <div>
          <h3 className={PANE_LABEL}>{P.inbox}</h3>
          {tickets.length === 0 ? (
            <p className={`mt-1 text-xs leading-5 ${QUIET}`}>{P.inboxEmpty}</p>
          ) : (
            <ul className="mt-1 text-xs">
              {inboxOrder(tickets).map((ticket) => (
                <InboxRow key={ticket.id} ticket={ticket} />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-gray-200 pt-2 dark:border-gray-800">
          <h3 className={PANE_LABEL}>{P.file}</h3>
          {subject === undefined ? (
            <p className={`mt-1 text-xs leading-5 ${QUIET}`}>{P.noFile}</p>
          ) : (
            <TicketFile ticket={subject} />
          )}
        </div>
      </section>
    </div>
  );
}

/** Who acted, in the ink of its side: the person dark, an agent in the working blue, the rest gray. */
const ACTOR_INK: Record<Actor, string> = {
  person: "font-semibold text-gray-900 dark:text-gray-100",
  lead: COMPANY_TONES.working.ink,
  session: COMPANY_TONES.working.ink,
  schedule: QUIET,
  server: QUIET,
};

/** One event, 20 pixels a line: the time, who acted, what they did, and what it left waiting. */
function EventRow({ event }: { event: DemoEvent }) {
  const P = S.company.player;
  return (
    <li className="py-px">
      <div
        className={`grid grid-cols-[5ch_minmax(0,1fr)] gap-x-2 rounded-sm px-1.5 leading-[18px] sm:grid-cols-[5ch_8ch_minmax(0,1fr)] ${
          event.reaches !== null ? COMPANY_TONES.waiting.ground : ""
        }`}
      >
        <span className={`font-mono tabular-nums ${QUIET}`}>{event.at}</span>
        <span className={`hidden sm:block ${ACTOR_INK[event.actor]}`}>{P.actors[event.actor]}</span>
        <span className="text-gray-800 [overflow-wrap:anywhere] dark:text-gray-200">
          <span className={`sm:hidden ${ACTOR_INK[event.actor]}`}>{P.actors[event.actor]} </span>
          {P.steps[event.id]}
          {event.reaches !== null && (
            <span className={`ml-2 whitespace-nowrap ${COMPANY_TONES.waiting.ink}`}>
              {P.waits[event.reaches]}
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

/** One ticket in the inbox: its title, heavier while unread, and what it waits for or where it stands. */
function InboxRow({ ticket }: { ticket: DemoTicket }) {
  const P = S.company.player;
  const wait = waitOf(ticket);
  const settled = ticket.status === "done" || ticket.status === "rejected";
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-gray-200 py-1 leading-5 last:border-b-0 dark:border-gray-800">
      <span
        className={`min-w-0 [overflow-wrap:anywhere] ${
          ticket.unread
            ? "font-semibold text-gray-900 dark:text-gray-100"
            : settled
              ? QUIET
              : "text-gray-700 dark:text-gray-300"
        }`}
      >
        {P.tickets[ticket.id].title}
        {ticket.unread && <span className="sr-only"> ({P.unread})</span>}
      </span>
      <span
        className={`shrink-0 whitespace-nowrap ${wait !== null ? COMPANY_TONES.waiting.ink : QUIET}`}
      >
        {wait !== null ? P.waits[wait] : P.statuses[ticket.status]}
      </span>
    </li>
  );
}

/** The ticket's file: its path, whose directory is its status, then the fields the run writes. */
function TicketFile({ ticket }: { ticket: DemoTicket }) {
  const P = S.company.player;
  return (
    <div className="mt-1 font-mono text-xs leading-[18px]">
      <p className={`[overflow-wrap:anywhere] ${QUIET}`}>{ticketPath(ticket)}</p>
      <pre className="mt-1 font-mono whitespace-pre-wrap text-gray-800 [overflow-wrap:anywhere] dark:text-gray-200">
        {ticketFileLines(ticket, P.tickets[ticket.id]).join("\n")}
      </pre>
    </div>
  );
}
