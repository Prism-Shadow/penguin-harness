/**
 * A ticket, opened in place, in the shipped ticket dialog's frame: the title and priority in the
 * head, then the status row, the sections, and the reader's triage in the foot.
 *
 * What the spec changes is the block under the status row. The shipped dialog says a ticket is
 * blocked and leaves the answer to a channel; here a ticket that waits on the reader says what it
 * waits for and takes the answer where it is read: accept or reject a proposal, pick an option of
 * its one question, accept a delivery or send it back with a note. The answer then stays on the
 * ticket, under Decisions.
 *
 * The ticket is the record; its work sessions are the conversations behind it. The Sessions
 * section lists them, and each opens the conversation itself.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Button,
  CloseButton,
  Modal,
  Pill,
  RadioGroup,
  RuledSection,
  Textarea,
} from "@prismshadow/penguin-ui";
import { S } from "../../../web/src/lib/strings";
import {
  PriorityBadge,
  TicketStatusBadge,
  TitleButton,
} from "../../../web/src/features/company/shared";
import { FIXTURES } from "./fixtures";
import type { SessionStatus, Ticket, WorkSession } from "./model";
import { waitOf } from "./spec";
import type { Wait } from "./spec";
import { acceptanceOf, gistOf, optionsOf, progressOf, questionOf, resultOf, titleOf } from "./text";
import { useWords } from "./use-words";

export interface TicketActions {
  accept: (id: string) => void;
  reject: (id: string) => void;
  answer: (id: string, option: number, note: string) => void;
  approve: (id: string) => void;
  sendBack: (id: string, note: string) => void;
  triage: (id: string, action: "snooze" | "archive" | "restore") => void;
}

export const money = (usd: number) => `$${usd.toFixed(2)}`;

const QUIET = "text-fg-muted";
const BODY = "text-sm leading-relaxed text-fg";

export function TicketDialog({
  ticket,
  sessions,
  statusOf,
  cost,
  actions,
  onOpenSession,
  onClose,
}: {
  ticket: Ticket;
  /** Its work sessions, oldest first. */
  sessions: readonly WorkSession[];
  statusOf: (session: WorkSession) => SessionStatus;
  cost: number;
  actions: TicketActions;
  onOpenSession: (id: string) => void;
  onClose: () => void;
}) {
  const W = useWords();
  const T = S.company.tickets;
  const title = titleOf(ticket, W);
  const wait = waitOf(ticket);
  const progress = progressOf(ticket, W);
  const acceptance = acceptanceOf(ticket, W);
  const deliverable = ticket.fixture === null ? undefined : FIXTURES[ticket.fixture].deliverable;
  const aside = ticket.snoozed || ticket.archived;
  return (
    <Modal open title={title} onClose={onClose} headerless bare widthClass="sm:max-w-3xl">
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
          <h2 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
            <span className="min-w-0 truncate">{title}</span>
            <span className="shrink-0">
              <PriorityBadge priority={ticket.priority} />
            </span>
          </h2>
          <CloseButton onClose={onClose} />
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-6">
          <div className={`flex flex-wrap items-center gap-2 text-xs ${QUIET}`}>
            {/* One mark, as on the inbox row: what it waits for, or else where it stands. */}
            {wait !== null ? (
              <Pill tone="attention">{W.waits[wait]}</Pill>
            ) : (
              <TicketStatusBadge status={ticket.status} />
            )}
            <span>
              {W.ticket.source} {W.sources[ticket.source]}
            </span>
            <span>
              {T.owner} {W.bylines[ticket.owner]}
            </span>
            <span className="ml-auto tabular-nums">
              {T.cost} <span className="font-medium text-fg">{money(cost)}</span>
            </span>
          </div>

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
              <Lines lines={ticket.returns} />
            </RuledSection>
          )}

          {ticket.delivered && (
            <RuledSection level={3} title={T.result}>
              <p className={BODY}>{resultOf(ticket, W)}</p>
              {deliverable !== undefined && <Deliverable path={deliverable} />}
            </RuledSection>
          )}

          <RuledSection level={3} title={T.sessions} count={sessions.length}>
            {sessions.length === 0 ? (
              <p className={`text-xs ${QUIET}`}>{W.ticket.sessionsEmpty}</p>
            ) : (
              <ul className="space-y-1.5">
                {sessions.map((session) => (
                  <li key={session.id} className="flex items-center gap-2 text-sm">
                    <SessionStatusPill status={statusOf(session)} />
                    <TitleButton
                      className="min-w-0 truncate"
                      onClick={() => onOpenSession(session.id)}
                    >
                      {W.ticket.sessionRow(
                        session.n,
                        W.bylines[ticket.owner],
                        session.messages.length,
                      )}
                    </TitleButton>
                  </li>
                ))}
              </ul>
            )}
          </RuledSection>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {aside ? (
            <Button size="sm" onClick={() => actions.triage(ticket.id, "restore")}>
              {W.ticket.restore}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                disabled={wait !== null}
                onClick={() => {
                  actions.triage(ticket.id, "snooze");
                  onClose();
                }}
              >
                {W.ticket.later}
              </Button>
              <Button
                size="sm"
                disabled={wait !== null}
                onClick={() => {
                  actions.triage(ticket.id, "archive");
                  onClose();
                }}
              >
                {W.ticket.archive}
              </Button>
              {wait !== null && (
                <span className={`min-w-0 text-xs ${QUIET}`}>{W.ticket.waitingFirst}</span>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
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

function Deliverable({ path }: { path: string }) {
  const W = useWords();
  return (
    <p className={`mt-2 text-xs ${QUIET}`}>
      {W.ticket.deliverable} <span className="font-mono text-fg">{path}</span>
    </p>
  );
}

/** Where a session stands, as one pill: running, waiting on the reader for what, or over. */
export function SessionStatusPill({ status }: { status: SessionStatus }) {
  const W = useWords();
  if (status === "running") return <Pill tone="success">{W.session.status.running}</Pill>;
  if (status === "ended") return <Pill>{W.session.status.ended}</Pill>;
  return <Pill tone="attention">{W.waits[status]}</Pill>;
}

/** The block that says what the ticket waits for and takes the reader's answer. */
export function NeedsYou({
  ticket,
  wait,
  actions,
}: {
  ticket: Ticket;
  wait: Wait;
  actions: TicketActions;
}) {
  const W = useWords();
  const options = optionsOf(ticket, W);
  const recommended = ticket.fixture === null ? 0 : (FIXTURES[ticket.fixture].recommended ?? 0);
  const [choice, setChoice] = useState(String(recommended));
  const [note, setNote] = useState("");
  const deliverable = ticket.fixture === null ? undefined : FIXTURES[ticket.fixture].deliverable;

  let body: ReactNode;
  if (wait === "accept") {
    body = (
      <>
        <p className={`font-medium ${BODY}`}>{W.ticket.asks.accept}</p>
        <p className={`mt-1 text-xs ${QUIET}`}>{W.ticket.kindNotes[ticket.kind]}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => actions.accept(ticket.id)}>
            {W.ticket.accept}
          </Button>
          <Button size="sm" onClick={() => actions.reject(ticket.id)}>
            {W.ticket.reject}
          </Button>
        </div>
      </>
    );
  } else if (wait === "answer") {
    body = (
      <>
        <RadioGroup
          label={<span className={`font-medium ${BODY}`}>{questionOf(ticket, W)}</span>}
          size="sm"
          value={choice}
          onChange={setChoice}
          options={options.map((option, i) => ({
            value: String(i),
            label: i === recommended ? W.ticket.recommended(option.label) : option.label,
            hint: option.hint,
          }))}
        />
        <Textarea
          size="sm"
          rows={2}
          className="mt-3"
          aria-label={W.ticket.notePlaceholder}
          placeholder={W.ticket.notePlaceholder}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={() => actions.answer(ticket.id, Number(choice), note)}
          >
            {W.ticket.answer}
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p className={`font-medium ${BODY}`}>{W.ticket.asks.review}</p>
        <p className={`mt-1 ${BODY}`}>{resultOf(ticket, W)}</p>
        {deliverable !== undefined && <Deliverable path={deliverable} />}
        <Textarea
          size="sm"
          rows={2}
          className="mt-3"
          aria-label={W.ticket.sendBackPlaceholder}
          placeholder={W.ticket.sendBackPlaceholder}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => actions.approve(ticket.id)}>
            {W.ticket.approve}
          </Button>
          <Button
            size="sm"
            disabled={note.trim() === ""}
            onClick={() => actions.sendBack(ticket.id, note)}
          >
            {W.ticket.sendBack}
          </Button>
        </div>
      </>
    );
  }

  return (
    <section aria-label={W.ticket.needsYou} className="rounded-md border border-line px-4 py-3">
      <h3 className={`mb-2 text-xs font-semibold ${QUIET}`}>{W.ticket.needsYou}</h3>
      {body}
    </section>
  );
}
