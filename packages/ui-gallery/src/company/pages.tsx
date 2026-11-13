/**
 * The prototype's pages, in the shipped company mode's page frame and with its controls.
 *
 * - The inbox takes the overview's place as the page an organization opens on. It keeps the
 *   overview's inbox rows and filter, and drops the four KPI tiles for one line: what is in
 *   progress and what it has cost. Its filter is the reader's own views of their tickets.
 * - The lead is the one conversation: what the reader says becomes a ticket, and the lead's
 *   lines name tickets, never the work.
 * - The board is the shipped five columns, unchanged; a card that waits says what for.
 * - Setting up asks one sentence, in the frame of the shipped empty landing.
 * - A page the spec leaves alone says so instead of being redrawn.
 */
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Button,
  EmptyState,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_SIZE,
  MessageBubble,
  PageFrame,
  PageHeader,
  Pill,
  RuledSection,
  Segmented,
  Switch,
  Textarea,
} from "@prismshadow/penguin-ui";
import { S } from "../../../web/src/lib/strings";
import {
  PriorityBadge,
  TicketStatusBadge,
  TitleButton,
} from "../../../web/src/features/company/shared";
import { toneDot } from "../../../web/src/lib/tone";
import type { FixtureId } from "./fixtures";
import { inboxCounts, spendOf, ticketsIn } from "./model";
import type { ChatLine, CompanyState, Ticket } from "./model";
import { INBOX_VIEWS, TICKET_STATUSES, waitOf } from "./spec";
import type { InboxView, TicketStatus } from "./spec";
import { PersonAvatar, PersonName } from "./people";
import { gistOf, lineOf, titleOf } from "./text";
import { money } from "./ticket-dialog";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";
/** The company's monthly budget in the sample: the shipped default for a new organization. */
const BUDGET = 100;

/** What a ticket waits for, or else where it stands: one mark per row. */
function Standing({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const wait = waitOf(ticket);
  return wait !== null ? (
    <Pill tone="attention">{W.waits[wait]}</Pill>
  ) : (
    <TicketStatusBadge status={ticket.status} />
  );
}

export function InboxPage({
  state,
  onOpen,
  onTalk,
  onAuto,
}: {
  state: CompanyState;
  onOpen: (id: string) => void;
  onTalk: () => void;
  onAuto: (id: FixtureId, auto: boolean) => void;
}) {
  const W = useWords();
  const [view, setView] = useState<InboxView>("waiting");
  const counts = inboxCounts(state);
  const tickets = ticketsIn(state, view);
  return (
    <PageFrame width="xl">
      <PageHeader
        title={W.inbox.title}
        info={W.inbox.info}
        description={state.mission ?? W.org.mission}
        actions={
          <Button size="sm" onClick={onTalk}>
            {W.inbox.talk}
          </Button>
        }
      />
      <p className={`text-xs ${QUIET}`}>
        {W.inbox.summary(counts.working, money(spendOf(state)), money(BUDGET))}
      </p>

      <div className="mt-4 max-w-2xl" role="group" aria-label={W.inbox.title}>
        <Segmented
          cols={5}
          value={view}
          onChange={setView}
          options={INBOX_VIEWS.map((option) => ({
            value: option,
            label: `${W.views[option]} ${counts[option]}`,
          }))}
        />
      </div>

      {tickets.length === 0 ? (
        <p className={`mt-4 py-1 text-xs ${QUIET}`}>{W.inbox.empty[view]}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="flex items-start gap-3 py-2.5 text-sm">
              <span className="flex w-20 shrink-0 pt-0.5">
                <Standing ticket={ticket} />
              </span>
              <span className="min-w-0 flex-1">
                <TitleButton
                  className={`block max-w-full truncate ${ticket.unread ? "font-semibold" : ""}`}
                  onClick={() => onOpen(ticket.id)}
                >
                  {titleOf(ticket, W)}
                  {ticket.unread && <span className="sr-only"> ({W.inbox.unread})</span>}
                </TitleButton>
                <span className={`block truncate text-xs ${QUIET}`}>{lineOf(ticket, W)}</span>
              </span>
              <span className={`hidden shrink-0 pt-0.5 text-xs sm:inline ${QUIET}`}>
                {W.sources[ticket.source]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <RuledSection
        title={W.inbox.schedules}
        info={W.schedule.info}
        count={state.schedules.length}
        className="mt-10"
      >
        {state.schedules.length === 0 ? (
          <p className={`py-1 text-xs ${QUIET}`}>{W.inbox.schedulesEmpty}</p>
        ) : (
          <ul className="space-y-1">
            {state.schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{W.tickets[schedule.id].title}</span>
                <label className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                  {W.schedule.auto}
                  <Switch checked={schedule.auto} onChange={(auto) => onAuto(schedule.id, auto)} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </RuledSection>
    </PageFrame>
  );
}

function ChatMessage({
  line,
  state,
  onOpen,
}: {
  line: ChatLine;
  state: CompanyState;
  onOpen: (id: string) => void;
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
  return (
    <div className="text-sm leading-relaxed text-fg">
      <p>{W.lead.lines[line.line]}</p>
      <ul className="mt-2 space-y-1">
        {line.tickets.flatMap((id) => {
          const ticket = ticketOf(id);
          return ticket === undefined
            ? []
            : [
                <li key={id} className="flex items-center gap-2">
                  <Standing ticket={ticket} />
                  <TitleButton className="truncate" onClick={() => onOpen(id)}>
                    {titleOf(ticket, W)}
                  </TitleButton>
                </li>,
              ];
        })}
      </ul>
    </div>
  );
}

export function LeadPage({
  state,
  onSay,
  onOpen,
}: {
  state: CompanyState;
  onSay: (text: string) => void;
  onOpen: (id: string) => void;
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
              <ChatMessage key={i} line={line} state={state} onOpen={onOpen} />
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

export function SetupPage({ onStart }: { onStart: (mission: string) => void }) {
  const W = useWords();
  const [mission, setMission] = useState("");
  const start = (event: FormEvent) => {
    event.preventDefault();
    onStart(mission);
  };
  return (
    <PageFrame width="full" contentClassName="flex min-h-full flex-col justify-center">
      <form onSubmit={start} className="mx-auto w-full max-w-xl py-8 text-center md:py-14">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-line-muted text-fg-muted">
          <GlyphIcon d={ICONS.building} size={ICON_SIZE.sectionMark + 6} />
        </span>
        <Heading level={1} display className="mt-4">
          {W.setup.title}
        </Heading>
        <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">{W.setup.body}</p>
        <div className="mt-6 text-left">
          <Textarea
            size="sm"
            rows={3}
            aria-label={W.setup.title}
            placeholder={W.setup.placeholder}
            value={mission}
            onChange={(event) => setMission(event.target.value)}
          />
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="primary" type="submit" disabled={mission.trim() === ""}>
            {W.setup.start}
          </Button>
        </div>
        <div className="mt-8 text-left">
          <p className={`text-xs font-semibold ${QUIET}`}>{W.setup.examplesLabel}</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {W.setup.examples.map((example) => (
              <li key={example}>
                <TitleButton onClick={() => setMission(example)}>{example}</TitleButton>
              </li>
            ))}
          </ul>
        </div>
      </form>
    </PageFrame>
  );
}

/** A page the spec leaves as it is: named, and not redrawn. */
export function KeptPage({ title }: { title: ReactNode }) {
  const W = useWords();
  return (
    <PageFrame width="xl">
      <PageHeader title={title} />
      <EmptyState title={W.kept.title} description={W.kept.body} />
    </PageFrame>
  );
}
