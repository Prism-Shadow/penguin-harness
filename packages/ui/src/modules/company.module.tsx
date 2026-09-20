/**
 * Company board: the surfaces of company mode, over Docs Expert Co.
 *
 * - Board: the tickets in their columns — priority, the run or block state, owner and spend;
 * - Calendar: the week's events at their local times, past ones marked with their outcome, and the
 *   current time;
 * - Org: the employee tree with each employee's state and spend against budget;
 * - Channel: the group chat — a system line, runs of messages by sender, the user's own messages.
 *
 * The board, calendar and org canvas stay in the web app (A-architecture §3.13); W6's
 * `ChannelBubble` is the one package component here. Static stand-ins until then.
 */
import type { ToneName } from "../tokens";
import { TICKET_STATUSES, fixturesFor } from "../fixtures";
import type {
  CalendarEventFixture,
  CalendarOutcome,
  EmployeeFixture,
  EmployeeState,
  Fixtures,
  TicketFixture,
} from "../fixtures";
import { defineModule, viewFor } from "../module";
import { AgentTile, UserAvatar } from "../screens/parts";
import { usd } from "../screens/format";
import { Badge, Count, GlyphIcon, IconButton, ProgressBar, RunSpinner, StatusWord } from "./parts";
import type { IconName } from "./parts";

const PRIORITY: Record<
  TicketFixture["priority"],
  { tone: ToneName; variant: "soft" | "outline" | "solid" }
> = {
  P0: { tone: "danger", variant: "solid" },
  P1: { tone: "attention", variant: "outline" },
  P2: { tone: "neutral", variant: "outline" },
};

const employee = (f: Fixtures, id: string): EmployeeFixture | undefined =>
  f.company.employees.find((e) => e.agentId === id);

// ---------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------

function TicketCard({ f, ticket }: { f: Fixtures; ticket: TicketFixture }) {
  const owner = employee(f, ticket.ownerAgentId);
  const priority = PRIORITY[ticket.priority];
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-[var(--radius-inner)] border border-line bg-surface px-3 py-2.5">
      <p className="line-clamp-2 text-sm text-fg">{ticket.title}</p>
      <div className="flex items-center gap-2">
        <Badge tone={priority.tone} variant={priority.variant}>
          {ticket.priority}
        </Badge>
        {ticket.running && <RunSpinner label={f.copy.chat.runStates.running} />}
        {ticket.blocked && (
          <StatusWord tone="attention" icon="alert">
            {f.copy.company.blocked}
          </StatusWord>
        )}
      </div>
      {ticket.blocked && <p className="text-xs text-fg-muted">{ticket.blocked}</p>}
      <div className="flex items-center gap-1.5 text-xs text-fg-muted">
        {owner && <AgentTile id={owner.agentId} name={owner.name} size={16} />}
        <span className="min-w-0 flex-1 truncate">{owner?.name}</span>
        <span className="font-mono tabular-nums">
          {ticket.costUsd > 0 ? usd(ticket.costUsd) : "—"}
        </span>
      </div>
    </li>
  );
}

function Board({ f }: { f: Fixtures }) {
  const status = f.copy.company.ticketStatus;
  // Every state a ticket can be in gets a column, so a state cannot go missing from the board.
  const columns = TICKET_STATUSES;
  return (
    <div className="grid grid-cols-5 items-start gap-3">
      {columns.map((column) => {
        const tickets = f.company.tickets.filter((t) => t.status === column);
        return (
          <section
            key={column}
            className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-lg bg-surface-muted p-2 [--radius-inner:max(var(--ui-radius-xs),calc(var(--ui-radius-lg)-0.5rem))]"
          >
            <div className="flex items-center gap-2 px-1 pt-1">
              <span className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-medium) text-fg">
                {status[column]}
              </span>
              <Count n={tickets.length} />
            </div>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {tickets.map((ticket) => (
                <TicketCard key={ticket.ticketId} f={f} ticket={ticket} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

/** The working day the week view draws: 09:00 to 18:00, one row an hour. */
const FIRST_HOUR = 9;
const END_HOUR = 18;
const HOURS = Array.from({ length: END_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
const ROW_REM = 2.75;

/**
 * The mock week, read off the fixture: the Monday it starts on, the instant it calls "now", the
 * zone's offset, and which column that instant falls in. Nothing about the week is written here,
 * so moving it in the fixture moves the past/upcoming split and the now-line with it.
 */
function week(f: Fixtures) {
  const { weekStartIso, nowIso, utcOffsetH } = f.company.calendar;
  const offsetMs = utcOffsetH * 3_600_000;
  const start = Date.parse(`${weekStartIso}T00:00:00.000Z`) - offsetMs;
  const now = Date.parse(nowIso);
  return { start, now, offsetMs, today: Math.floor((now - start) / 86_400_000) };
}

interface Occurrence {
  event: CalendarEventFixture;
  day: number;
  startH: number;
  outcome: CalendarOutcome | "upcoming";
}

function occurrences(f: Fixtures): Occurrence[] {
  const { start: weekStart, now, offsetMs } = week(f);
  const out: Occurrence[] = [];
  for (const event of f.company.calendar.events) {
    const first = Date.parse(event.startAtIso);
    const step = event.period ? Number.parseInt(event.period, 10) * 86_400_000 : 0;
    // A one-off event has no step: the loop below breaks after its single occurrence.
    for (let at = first; at < weekStart + 7 * 86_400_000; at += step) {
      const day = Math.floor((at - weekStart) / 86_400_000);
      const local = new Date(at + offsetMs);
      const startH = local.getUTCHours() + local.getUTCMinutes() / 60;
      const past = at + event.durationMin * 60_000 <= now;
      const next = event.nextFireAtIso ? Date.parse(event.nextFireAtIso) : Infinity;
      const outcome: Occurrence["outcome"] = !event.enabled
        ? "paused"
        : !past
          ? "upcoming"
          : at + step >= next && event.lastOutcome
            ? event.lastOutcome
            : "fired";
      if (day >= 0 && day < 7) out.push({ event, day, startH, outcome });
      if (!step) break;
    }
  }
  return out;
}

const OUTCOME_MARK: Record<Occurrence["outcome"], { icon: IconName; tone: string } | null> = {
  fired: { icon: "check", tone: "text-fg-subtle" },
  queued: { icon: "clock", tone: "text-tone-attention-fg" },
  paused: { icon: "minus", tone: "text-fg-subtle" },
  missed: { icon: "cross", tone: "text-tone-danger-fg" },
  error: { icon: "circleCross", tone: "text-tone-danger-fg" },
  upcoming: null,
};

function Calendar({ f }: { f: Fixtures }) {
  const c = f.copy.company;
  const all = occurrences(f);
  const { start, now, offsetMs, today } = week(f);
  // The week's day names with their dates, in the fixture's own language: `Mon 14`.
  const days = f.usage.days.map(
    ({ day }, i) => `${day} ${new Date(start + offsetMs + i * 86_400_000).getUTCDate()}`,
  );
  const outcome = (o: Occurrence) =>
    o.outcome === "upcoming" ? c.upcoming : c.outcomes[o.outcome];
  const nowLocal = new Date(now + offsetMs);
  const nowH = nowLocal.getUTCHours() + nowLocal.getUTCMinutes() / 60;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] border-b border-line pb-2 text-xs text-fg-muted">
        <span />
        {days.map((day, i) => (
          <span
            key={day}
            className={`px-1 ${i === today ? "font-(--ui-weight-medium) text-fg" : ""}`}
          >
            {day}
          </span>
        ))}
      </div>
      <div className="relative grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]">
        <div>
          {HOURS.map((h) => (
            <p
              key={h}
              className="text-right font-mono text-xs tabular-nums text-fg-subtle"
              style={{ height: `${ROW_REM}rem` }}
            >
              <span className="-translate-y-2 inline-block pr-2">
                {String(h).padStart(2, "0")}:00
              </span>
            </p>
          ))}
        </div>
        {days.map((day, dayIndex) => (
          <div key={day} className="relative border-l border-line-muted">
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-t border-line-muted"
                style={{ height: `${ROW_REM}rem` }}
              />
            ))}
            {all
              .filter((o) => o.day === dayIndex && o.startH >= FIRST_HOUR && o.startH < END_HOUR)
              .map((o) => {
                const owner = employee(f, o.event.agentId);
                const mark = OUTCOME_MARK[o.outcome];
                return (
                  <div
                    key={o.event.name}
                    title={`${o.event.title} · ${outcome(o)}`}
                    className={`absolute inset-x-0.5 overflow-hidden rounded-sm border border-line px-1 py-0.5 text-xs ${
                      o.outcome === "upcoming"
                        ? "bg-surface text-fg"
                        : "bg-surface-muted text-fg-muted"
                    }`}
                    style={{
                      top: `${(o.startH - FIRST_HOUR) * ROW_REM}rem`,
                      height: `${Math.max((o.event.durationMin / 60) * ROW_REM, 1.25)}rem`,
                    }}
                  >
                    <span className="flex items-center gap-1">
                      {owner && <AgentTile id={owner.agentId} name={owner.name} size={12} />}
                      <span className="min-w-0 flex-1 truncate">{o.event.title}</span>
                      {mark && <GlyphIcon name={mark.icon} size={11} className={mark.tone} />}
                    </span>
                  </div>
                );
              })}
            {dayIndex === today && (
              <div
                className="absolute inset-x-0 h-px bg-fg"
                style={{ top: `${(nowH - FIRST_HOUR) * ROW_REM}rem` }}
              >
                <span className="absolute bottom-0.5 right-1 text-xs leading-none font-(--ui-weight-medium) text-fg">
                  {c.now}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-12 text-xs text-fg-muted">
        {(["fired", "queued", "missed", "paused"] as const).map((kind) => {
          const mark = OUTCOME_MARK[kind]!;
          return (
            <span key={kind} className="flex items-center gap-1">
              <GlyphIcon name={mark.icon} size={11} className={mark.tone} />
              {c.outcomes[kind]}
            </span>
          );
        })}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Org chart
// ---------------------------------------------------------------------------------------------

const STATE_WORD: Record<EmployeeState, { tone: ToneName; icon?: IconName | "spinner" }> = {
  running: { tone: "success", icon: "spinner" },
  idle: { tone: "neutral" },
  paused: { tone: "attention", icon: "minus" },
};

function OrgNode({ f, person }: { f: Fixtures; person: EmployeeFixture }) {
  const c = f.copy.company;
  const state = STATE_WORD[person.state];
  const over = person.budgetUsd !== undefined && person.spendUsd > person.budgetUsd;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] w-48 gap-2 rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <AgentTile id={person.agentId} name={person.name} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-(--ui-weight-medium) text-fg">
            {person.name}
          </span>
          <span className="block truncate text-xs text-fg-muted">{person.title}</span>
        </span>
      </div>
      <StatusWord tone={state.tone} icon={state.icon}>
        {c.employeeStates[person.state]}
      </StatusWord>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
        {person.budgetUsd !== undefined && (
          <ProgressBar
            value={person.spendUsd / person.budgetUsd}
            tone={over ? "danger" : "neutral"}
            label={person.name}
          />
        )}
        <span
          className={`flex justify-between text-xs tabular-nums ${over ? "text-tone-danger-fg" : "text-fg-muted"}`}
        >
          <span>{usd(person.spendUsd)}</span>
          <span>
            {person.budgetUsd !== undefined
              ? over
                ? c.overBudget
                : usd(person.budgetUsd)
              : c.noBudget}
          </span>
        </span>
      </div>
    </div>
  );
}

/** A connector stub: the vertical hairline between a node and its parent's rule. */
function Stub() {
  return <span aria-hidden className="mx-auto block h-4 w-px bg-line-emphasis" />;
}

function Org({ f }: { f: Fixtures }) {
  const people = f.company.employees;
  const root = people.find((p) => p.reportsTo === null)!;
  const reports = people.filter((p) => p.reportsTo === root.agentId);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] justify-items-center py-4">
      <OrgNode f={f} person={root} />
      <Stub />
      <div className="relative grid grid-cols-3 items-start gap-6">
        <span
          aria-hidden
          className="absolute left-[calc((100%-3rem)/6)] right-[calc((100%-3rem)/6)] top-0 h-px bg-line-emphasis"
        />
        {reports.map((person) => {
          const children = people.filter((p) => p.reportsTo === person.agentId);
          return (
            <div
              key={person.agentId}
              className="grid grid-cols-[minmax(0,1fr)] justify-items-center"
            >
              <Stub />
              <OrgNode f={f} person={person} />
              {children.map((child) => (
                <div
                  key={child.agentId}
                  className="grid grid-cols-[minmax(0,1fr)] justify-items-center"
                >
                  <Stub />
                  <OrgNode f={f} person={child} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------------------------

/** One message in a run: the sender's name and time lead only the first of their run. */
function ChannelBubble({
  f,
  from,
  time,
  text,
  first,
}: {
  f: Fixtures;
  from: string;
  time: string;
  text: string;
  first: boolean;
}) {
  const own = from === f.user.id;
  const sender = employee(f, from);
  return (
    <div className={`flex gap-2 ${own ? "flex-row-reverse" : ""} ${first ? "pt-3" : "pt-1"}`}>
      <span className="w-7 shrink-0">
        {first &&
          (own ? (
            <UserAvatar name={f.user.name} size={28} />
          ) : (
            sender && <AgentTile id={sender.agentId} name={sender.name} size={28} />
          ))}
      </span>
      <div
        className={`grid grid-cols-[minmax(0,1fr)] max-w-[75%] gap-1 ${own ? "justify-items-end" : ""}`}
      >
        {first && (
          <span className="flex items-baseline gap-2 text-xs">
            <span className="font-(--ui-weight-medium) text-fg">
              {own ? f.user.name : sender?.name}
            </span>
            {!own && <span className="text-fg-muted">{sender?.title}</span>}
            <span className="font-mono tabular-nums text-fg-subtle">{time}</span>
          </span>
        )}
        <p
          className={`rounded-lg px-3 py-2 text-sm text-fg ${own ? "bg-accent-muted" : "bg-surface-muted"}`}
        >
          {text}
        </p>
      </div>
    </div>
  );
}

function Channel({ f }: { f: Fixtures }) {
  const c = f.copy.company;
  const name = f.company.org.id;
  const people = f.company.employees;
  const messages = f.company.channel.messages;
  // The system line the running ticket's first Session posted.
  const ticket = f.company.tickets.find((t) => t.running);
  const owner = ticket && employee(f, ticket.ownerAgentId);
  return (
    <div className="flex h-[40rem] flex-col overflow-hidden rounded-lg border border-line bg-canvas">
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <GlyphIcon name="hash" size={16} className="text-fg-muted" />
        <span className="text-sm font-(--ui-weight-medium) text-fg">{name}</span>
        <span className="flex -space-x-1 pl-2">
          {people.map((p) => (
            <span key={p.agentId} className="rounded-sm ring-2 ring-canvas">
              <AgentTile id={p.agentId} name={p.name} size={18} />
            </span>
          ))}
        </span>
        <span className="text-xs text-fg-muted">{c.members(people.length + 1)}</span>
        <span className="min-w-0 flex-1" />
        <IconButton label={c.searchMessages} icon="search" size="sm" />
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
        {ticket && owner && (
          <p className="flex items-center gap-3 pt-4 text-xs text-fg-subtle">
            <span className="h-px flex-1 bg-line-muted" />
            {c.started(owner.name, ticket.ticketId)}
            <span className="h-px flex-1 bg-line-muted" />
          </p>
        )}
        {messages.map((message, i) => (
          <ChannelBubble
            key={`${message.from}-${message.time}`}
            f={f}
            from={message.from}
            time={message.time}
            text={message.text}
            first={i === 0 || messages[i - 1]!.from !== message.from}
          />
        ))}
      </div>
      <div className="border-t border-line px-4 py-3">
        <span className="flex h-9 items-center rounded-md border border-line bg-surface px-3 text-sm text-fg-subtle">
          {c.messagePlaceholder(name)}
        </span>
      </div>
    </div>
  );
}

const VARIANTS = { board: Board, calendar: Calendar, org: Org, channel: Channel } as const;

export const module = defineModule({
  id: "company",
  title: "Company board",
  description:
    "Company mode's surfaces: the ticket board, the week's calendar with outcomes, the org chart with employee states, and the group chat.",
  width: "wide",
  variants: [
    { key: "board", title: "Board" },
    { key: "calendar", title: "Calendar" },
    { key: "org", title: "Org" },
    { key: "channel", title: "Channel" },
  ],
  parts: [
    "chat-channel-bubble",
    "feedback-badge",
    "icons-avatars",
    "icons-status-icon",
    "feedback-progress-bar",
  ],
  render: (variant, { lang }) => {
    const View = viewFor(VARIANTS, variant);
    return <View f={fixturesFor(lang)} />;
  },
});
