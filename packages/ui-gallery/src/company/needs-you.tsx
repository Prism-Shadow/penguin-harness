/**
 * What a ticket needs from the reader, as one block wherever the ticket is read (its record, or
 * the work session waiting on the reader): accept or reject a proposal, pick an option of its one
 * question, accept a delivery or send it back with a note. And the one pill a session's state is
 * read by: running, waiting on the reader for what, or over.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Button, Pill, RadioGroup, Textarea } from "@prismshadow/penguin-ui";
import { FIXTURES } from "./fixtures";
import type { SessionStatus, Ticket } from "./model";
import type { Wait } from "./spec";
import { optionsOf, questionOf, resultOf } from "./text";
import { useWords } from "./use-words";

export interface TicketActions {
  accept: (id: string) => void;
  reject: (id: string) => void;
  answer: (id: string, option: number, note: string) => void;
  approve: (id: string) => void;
  sendBack: (id: string, note: string) => void;
  triage: (id: string, action: "snooze" | "archive" | "restore") => void;
}

const QUIET = "text-fg-muted";
const BODY = "text-sm leading-relaxed text-fg";

export function Deliverable({ path }: { path: string }) {
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
