/**
 * A work session, opened: the conversation an agent has while it works on one ticket, in the
 * layout of the lead's conversation. The head names who works in it, where it stands and the
 * ticket it works on (a link back to the record); the body is the conversation, from the ticket
 * it was handed to the last line; the foot lets the reader talk to it directly, without the lead.
 *
 * While the session waits on the reader, the same block the ticket shows closes the
 * conversation, so a question is answered, or a delivery accepted, wherever the reader is. The answer goes into
 * this conversation as the reader's message, and the session carries on in the same context.
 */
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, MessageBubble, Textarea } from "@prismshadow/penguin-ui";
import { TitleButton } from "../../../web/src/features/company/shared";
import { FIXTURES } from "./fixtures";
import type { SessionMessage, SessionStatus, Ticket, WorkSession } from "./model";
import {
  acceptanceOf,
  gistOf,
  optionsOf,
  progressOf,
  questionOf,
  resultOf,
  returnOf,
  titleOf,
} from "./text";
import { PersonAvatar, PersonName } from "./people";
import { NeedsYou, SessionStatusPill } from "./ticket-dialog";
import type { TicketActions } from "./ticket-dialog";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";
const BODY = "text-sm leading-relaxed text-fg";

export function SessionPage({
  session,
  ticket,
  status,
  actions,
  onSay,
  onOpenTicket,
}: {
  session: WorkSession;
  ticket: Ticket;
  status: SessionStatus;
  actions: TicketActions;
  onSay: (text: string) => void;
  onOpenTicket: () => void;
}) {
  const W = useWords();
  const [draft, setDraft] = useState("");
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (draft.trim() === "") return;
    onSay(draft);
    setDraft("");
  };
  const wait = status === "answer" || status === "review" ? status : null;
  // Like any conversation, it opens at its newest line and follows what is added.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [session.messages.length, status]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-3">
        <PersonAvatar byline={ticket.owner} size={18} />
        <h1 className="shrink-0 text-sm font-semibold">
          <PersonName byline={ticket.owner} /> · {W.nav.sessionOf(session.n)}
        </h1>
        <SessionStatusPill status={status} />
        <span className={`flex min-w-0 items-center gap-1.5 text-xs ${QUIET}`}>
          {W.session.ticket}
          <TitleButton className="min-w-0 truncate" onClick={onOpenTicket}>
            {titleOf(ticket, W)}
          </TitleButton>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          <p className={`text-xs ${QUIET}`}>{W.session.info}</p>
          {session.messages.map((message, i) => (
            <Message
              key={i}
              message={message}
              ticket={ticket}
              sentBack={session.messages.slice(i + 1).some((later) => "sendBack" in later)}
            />
          ))}
          {status !== "running" && (
            <p className={`text-xs ${QUIET}`}>
              {status === "answer"
                ? W.session.waitingAnswer
                : status === "review"
                  ? W.session.waitingReview
                  : W.session.ended}
            </p>
          )}
          {wait !== null && <NeedsYou key={wait} ticket={ticket} wait={wait} actions={actions} />}
          <div ref={end} />
        </div>
      </div>
      {status !== "ended" && (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-4">
          <form onSubmit={send} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Textarea
                size="sm"
                rows={2}
                aria-label={W.session.placeholder}
                placeholder={W.session.placeholder}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)
                    send(event);
                }}
              />
            </div>
            <Button size="sm" variant="primary" type="submit" disabled={draft.trim() === ""}>
              {W.session.send}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * One line of the conversation. `sentBack` marks a delivery the person later sent back: the
 * ticket's result describes the last delivery, so an earlier one says only that it was done.
 */
function Message({
  message,
  ticket,
  sentBack,
}: {
  message: SessionMessage;
  ticket: Ticket;
  sentBack: boolean;
}) {
  const W = useWords();
  if (message.from === "brief") {
    const acceptance = acceptanceOf(ticket, W);
    return (
      <div className={`border-l-2 border-line pl-3 ${BODY}`}>
        <p className={`text-xs ${QUIET}`}>{W.session.brief}</p>
        <p className="mt-1 font-medium">{titleOf(ticket, W)}</p>
        <p className="mt-1">{gistOf(ticket, W)}</p>
        {acceptance.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {acceptance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  if (message.from === "person") {
    let text: string;
    if ("answer" in message) {
      const label = optionsOf(ticket, W)[message.answer]?.label ?? "";
      text = [W.session.answered(label), message.note].filter((part) => part !== "").join(" ");
    } else if ("sendBack" in message) {
      text = W.session.sentBack(returnOf(ticket, message.sendBack, W));
    } else {
      text = message.text;
    }
    return (
      <div className="flex justify-end">
        <MessageBubble variant="user">{text}</MessageBubble>
      </div>
    );
  }
  if (message.step === "progress") {
    // The line the session wrote to the ticket's progress is what it says here.
    const lines = progressOf({ ...ticket, progress: message.line + 1 }, W);
    return <p className={BODY}>{lines[message.line]}</p>;
  }
  if (message.step === "ask") {
    // The options are the block that takes the answer, and the answer names the one chosen.
    return <p className={BODY}>{questionOf(ticket, W)}</p>;
  }
  if (message.step === "close") return <p className={BODY}>{resultOf(ticket, W)}</p>;
  if (message.step === "deliver") {
    const deliverable = ticket.fixture === null ? undefined : FIXTURES[ticket.fixture].deliverable;
    return (
      <div className={BODY}>
        <p>{sentBack ? W.ticket.saidResult : resultOf(ticket, W)}</p>
        {deliverable !== undefined && (
          <p className={`mt-1 text-xs ${QUIET}`}>
            {W.ticket.deliverable} <span className="font-mono text-fg">{deliverable}</span>
          </p>
        )}
      </div>
    );
  }
  return <p className={BODY}>{W.session.noted}</p>;
}
