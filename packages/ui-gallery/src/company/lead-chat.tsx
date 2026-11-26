/**
 * The line to the lead once the company runs: the one way in for anything new. The lead never
 * starts work from a sentence. It answers with a draft ticket, who does it, who checks it, the
 * workbench it will be accepted in, its limits and any outward action, and files it only when the
 * reader confirms. There is no all-hands channel; members hand work over on tickets.
 *
 * What the reader types and does not send stays in the box, and the column marks the lead's row.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button, Card, MessageBubble, Textarea } from "@prismshadow/penguin-ui";
import { EXECUTOR_OF, FIXTURES } from "./fixtures";
import type { FixtureId } from "./fixtures";
import { suggestions, ticketOf } from "./model";
import type { CompanyState } from "./model";
import { Byline, PersonAvatar } from "./people";
import { useWords } from "./use-words";

function DraftTicket({
  state,
  request,
  text,
  filed,
  onFile,
  onOpen,
}: {
  state: CompanyState;
  request: FixtureId | null;
  text: string | null;
  filed: string | null;
  onFile: () => void;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  const L = W.lead;
  const fixture = FIXTURES[request ?? "pricing"];
  const action = fixture.outward;
  const rows: [string, ReactNode][] = [
    [L.owner, <Byline key="owner" id={EXECUTOR_OF[fixture.workbench]} />],
    [L.verifier, <Byline key="verifier" id="verifier" />],
    [L.workbench, W.workbenches[fixture.workbench]],
    [
      L.limits,
      `${W.money(state.settings.budget)} / ${W.ticket.roundsOf(0, state.settings.rounds)}`,
    ],
    [
      L.outward,
      action === undefined
        ? L.none
        : `${W.outward.actions[action]} · ${W.outward.grades[state.settings.grades[action]]}`,
    ],
  ];
  return (
    <Card padding="sm" className="space-y-2">
      <p className="text-xs font-medium text-fg-muted">{L.previewTitle}</p>
      <p className="text-sm font-medium text-fg">
        {request === null ? text : W.tickets[request].title}
      </p>
      {request === null && <p className="text-xs text-fg-muted">{L.yours}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="whitespace-nowrap text-fg-muted">{label}</dt>
            <dd className="min-w-0 text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        {filed === null ? (
          <Button size="sm" variant="primary" onClick={onFile}>
            {L.confirm}
          </Button>
        ) : (
          <Button size="sm" onClick={() => onOpen(filed)}>
            {ticketOf(state, filed) === undefined ? L.filed : L.open}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function LeadChat({
  state,
  draft,
  onDraft,
  onAsk,
  onFile,
  onOpen,
}: {
  state: CompanyState;
  draft: string;
  onDraft: (text: string) => void;
  onAsk: (request: FixtureId | null, text: string | null) => void;
  onFile: (line: number) => void;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  const L = W.lead;
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end", behavior: "smooth" });
  }, [state.chat.length]);
  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    onAsk(null, text);
    onDraft("");
  };
  const left = suggestions(state);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          <div className="flex gap-3">
            <PersonAvatar id="lead" size={24} />
            <p className="min-w-0 flex-1 text-sm leading-relaxed text-fg">{L.intro}</p>
          </div>
          {state.chat.map((line, i) =>
            line.from === "person" ? (
              <div key={i} className="flex justify-end">
                <MessageBubble variant="user">
                  {line.request === null ? line.text : W.tickets[line.request].title}
                </MessageBubble>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <PersonAvatar id="lead" size={24} />
                <div className="min-w-0 flex-1">
                  <DraftTicket
                    state={state}
                    request={line.request}
                    text={line.text}
                    filed={line.filed}
                    onFile={() => onFile(i)}
                    onOpen={onOpen}
                  />
                </div>
              </div>
            ),
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl shrink-0 space-y-2 px-4 pb-4">
        {left.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>{L.suggestions}</span>
            {left.map((id) => (
              <Button key={id} size="sm" variant="secondary" onClick={() => onAsk(id, null)}>
                {W.tickets[id].title}
              </Button>
            ))}
          </div>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          className="flex items-end gap-2"
        >
          <div className="min-w-0 flex-1">
            <Textarea
              size="sm"
              rows={2}
              aria-label={L.placeholder}
              placeholder={L.placeholder}
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
            />
          </div>
          <Button size="sm" variant="primary" type="submit" disabled={draft.trim() === ""}>
            {L.send}
          </Button>
        </form>
      </div>
    </div>
  );
}
