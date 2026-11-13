/**
 * A ticket, read in the right-hand column: the record, with each of its work sessions one tab
 * over. The head names the ticket, its priority and the one mark the inbox row shows (what it
 * waits for, or else where it stands), then who owns it, where it came from and what it has cost.
 *
 * The record tab opens on what the ticket needs from the reader, when it needs anything: accept or
 * reject a proposal, pick an option of its one question, accept a delivery or send it back with a
 * note. The answer stays on the ticket, under Decisions. Under that come the shipped ticket's
 * sections, what it gave the handbook, and at the foot the reader's own triage.
 *
 * A session tab is the conversation behind the record (session-page.tsx). A ticket that waits on
 * the reader takes the same answer there, so the reader decides wherever they are reading.
 */
import { Button, Pill, RuledSection, Tabs } from "@prismshadow/penguin-ui";
import { S } from "../../../web/src/lib/strings";
import {
  PriorityBadge,
  TicketStatusBadge,
  TitleButton,
} from "../../../web/src/features/company/shared";
import { FIXTURES } from "./fixtures";
import type { SessionStatus, Ticket, WorkSession } from "./model";
import { Deliverable, NeedsYou } from "./needs-you";
import type { TicketActions } from "./needs-you";
import { PersonName } from "./people";
import { SessionConversation } from "./session-page";
import { waitOf } from "./spec";
import {
  acceptanceOf,
  gistOf,
  money,
  optionsOf,
  progressOf,
  questionOf,
  resultOf,
  returnOf,
  titleOf,
} from "./text";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";
const BODY = "text-sm leading-relaxed text-fg";

/** The record, or one of the ticket's sessions by its id. */
export type TicketTab = "record" | string;

/** One mark, as on the inbox row: what it waits for, or else where it stands. */
export function Standing({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const wait = waitOf(ticket);
  return wait !== null ? (
    <Pill tone="attention">{W.waits[wait]}</Pill>
  ) : (
    <TicketStatusBadge status={ticket.status} />
  );
}

export function TicketPane({
  ticket,
  sessions,
  statusOf,
  cost,
  filed,
  actions,
  tab,
  onTab,
  onSay,
  onOpenHandbook,
}: {
  ticket: Ticket;
  /** Its work sessions, oldest first. */
  sessions: readonly WorkSession[];
  statusOf: (session: WorkSession) => SessionStatus;
  cost: number;
  /** The handbook files it gave rise to: a decision, a lesson, a skill, a document. */
  filed: readonly { path: string; title: string }[];
  actions: TicketActions;
  tab: TicketTab;
  onTab: (tab: TicketTab) => void;
  onSay: (session: string, text: string) => void;
  onOpenHandbook: (path: string) => void;
}) {
  const W = useWords();
  const T = S.company.tickets;
  const shown = sessions.find((session) => session.id === tab);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-4 pt-4 sm:px-6">
        <h1 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <span className="min-w-0 truncate">{titleOf(ticket, W)}</span>
          <span className="shrink-0">
            <PriorityBadge priority={ticket.priority} />
          </span>
        </h1>
        <p className={`mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${QUIET}`}>
          <Standing ticket={ticket} />
          <span>
            {T.owner} <PersonName byline={ticket.owner} />
          </span>
          <span>
            {W.ticket.source} {W.sources[ticket.source]}
          </span>
          <span className="tabular-nums">
            {T.cost} <span className="font-medium text-fg">{money(cost)}</span>
          </span>
        </p>
        <div className="mt-3">
          <Tabs
            items={[
              { key: "record", label: W.nav.record },
              ...sessions.map((session) => ({
                key: session.id,
                label: W.nav.sessionOf(session.n),
              })),
            ]}
            active={shown === undefined ? "record" : shown.id}
            onChange={onTab}
          />
        </div>
      </header>
      {shown === undefined ? (
        <Record ticket={ticket} filed={filed} actions={actions} onOpenHandbook={onOpenHandbook} />
      ) : (
        <SessionConversation
          key={shown.id}
          session={shown}
          ticket={ticket}
          status={statusOf(shown)}
          actions={actions}
          onSay={(text) => onSay(shown.id, text)}
        />
      )}
    </div>
  );
}

function Record({
  ticket,
  filed,
  actions,
  onOpenHandbook,
}: {
  ticket: Ticket;
  filed: readonly { path: string; title: string }[];
  actions: TicketActions;
  onOpenHandbook: (path: string) => void;
}) {
  const W = useWords();
  const T = S.company.tickets;
  const wait = waitOf(ticket);
  const progress = progressOf(ticket, W);
  const acceptance = acceptanceOf(ticket, W);
  const deliverable = ticket.fixture === null ? undefined : FIXTURES[ticket.fixture].deliverable;
  const aside = ticket.snoozed || ticket.archived;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-3xl space-y-6 px-4 py-5 sm:px-6">
          {wait !== null && (
            // Remounted for each reason it waits, so a note typed for one is not left in the next.
            <NeedsYou key={wait} ticket={ticket} wait={wait} actions={actions} />
          )}

          <RuledSection level={3} title={T.goal}>
            <p className={BODY}>{gistOf(ticket, W)}</p>
          </RuledSection>

          {acceptance.length > 0 && (
            <RuledSection level={3} title={T.acceptance}>
              <Lines lines={acceptance} />
            </RuledSection>
          )}

          <RuledSection level={3} title={T.progress}>
            {progress.length === 0 ? (
              <p className={`text-xs ${QUIET}`}>{T.progressEmpty}</p>
            ) : (
              <Lines lines={progress} />
            )}
          </RuledSection>

          {(ticket.answer !== null || ticket.notes.length > 0) && (
            <RuledSection level={3} title={W.ticket.decisions}>
              {ticket.answer !== null && (
                <>
                  <p className={BODY}>
                    <span className={QUIET}>{questionOf(ticket, W)}</span>{" "}
                    <span className="font-medium">
                      {optionsOf(ticket, W)[ticket.answer]?.label}
                    </span>
                  </p>
                  {ticket.answerNote !== "" && (
                    <p className={`mt-1 ${BODY}`}>{ticket.answerNote}</p>
                  )}
                </>
              )}
              {ticket.notes.map((note, i) => (
                <p key={i} className={`mt-1 ${BODY}`}>
                  <span className={QUIET}>{W.ticket.saidInSession}</span> {note}
                </p>
              ))}
            </RuledSection>
          )}

          {ticket.returns.length > 0 && (
            <RuledSection level={3} title={W.ticket.returned}>
              <Lines lines={ticket.returns.map((note) => returnOf(ticket, note, W))} />
            </RuledSection>
          )}

          {ticket.delivered && (
            <RuledSection level={3} title={T.result}>
              <p className={BODY}>{resultOf(ticket, W)}</p>
              {deliverable !== undefined && <Deliverable path={deliverable} />}
            </RuledSection>
          )}

          {filed.length > 0 && (
            <RuledSection level={3} title={W.ticket.handbook} count={filed.length}>
              <ul className="space-y-1">
                {filed.map((entry) => (
                  <li key={entry.path} className="text-sm">
                    <TitleButton onClick={() => onOpenHandbook(entry.path)}>
                      {entry.title}
                    </TitleButton>
                  </li>
                ))}
              </ul>
            </RuledSection>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 sm:px-6">
        {aside ? (
          <Button size="sm" onClick={() => actions.triage(ticket.id, "restore")}>
            {W.ticket.restore}
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={wait !== null}
              onClick={() => actions.triage(ticket.id, "snooze")}
            >
              {W.ticket.later}
            </Button>
            <Button
              size="sm"
              disabled={wait !== null}
              onClick={() => actions.triage(ticket.id, "archive")}
            >
              {W.ticket.archive}
            </Button>
            {wait !== null && (
              <span className={`min-w-0 text-xs ${QUIET}`}>{W.ticket.waitingFirst}</span>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <ul className={`list-disc space-y-1 pl-5 ${BODY}`}>
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}
