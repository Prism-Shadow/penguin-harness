import {
  Button,
  Card,
  CollapsibleSection,
  Drawer,
  KeyValue,
  KeyValueRow,
  PageFrame,
  PageHeader,
  Pill,
  ProgressBar,
  RuledSection,
} from "@prismshadow/penguin-ui";
import { STAGE_TONE, useCompanyApp } from "./context";
import { money } from "./fixtures";
import { navigateHost } from "./frame";
import { BOARD_STAGES, boardColumn, memberById, ticketById } from "./model";
import type { Need, Stage, Ticket } from "./model";

function BoardCard({ ticket }: { ticket: Ticket }) {
  const { w, org, openTicket } = useCompanyApp();
  return (
    <Card as="li" padding="none" interactive>
      <button
        type="button"
        onClick={() => openTicket(ticket.id)}
        className="block w-full space-y-2 p-3 text-left rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg-subtle/60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="text-xs text-fg-muted tabular-nums">{ticket.id}</span>
          {ticket.stage === "halted" && <Pill tone="danger">{w.stage.halted}</Pill>}
          <span className="ml-auto shrink-0 text-xs text-fg-muted">{ticket.updated}</span>
        </span>
        <span className="block text-sm font-medium text-fg">{ticket.title}</span>
        <span className="block text-xs text-fg-muted">
          {memberById(org, ticket.executor)?.name} ·{" "}
          {w.ticket.roundsValue(ticket.rounds, ticket.maxRounds)} ·{" "}
          {w.ticket.costValue(money(ticket.spent), money(ticket.budget))}
        </span>
      </button>
    </Card>
  );
}

function Column({ stage }: { stage: Stage }) {
  const { w, org } = useCompanyApp();
  const tickets = boardColumn(org, stage);
  return (
    <RuledSection title={w.stage[stage]} count={tickets.length} level={3}>
      {tickets.length === 0 ? (
        <p className="text-xs text-fg-muted">{w.board.empty}</p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((ticket) => (
            <BoardCard key={ticket.id} ticket={ticket} />
          ))}
        </ul>
      )}
    </RuledSection>
  );
}

export function TicketsPage() {
  const { w } = useCompanyApp();
  return (
    <PageFrame width="full">
      <PageHeader title={w.board.title} info={w.board.info} />
      <div className="@container">
        <div className="grid grid-cols-1 gap-6 @3xl:grid-cols-4">
          {BOARD_STAGES.map((stage) => (
            <Column key={stage} stage={stage} />
          ))}
        </div>
      </div>
    </PageFrame>
  );
}

function Track({ ticket }: { ticket: Ticket }) {
  const { w } = useCompanyApp();
  const current = ticket.stage === "halted" ? "yours" : ticket.stage;
  const reached = BOARD_STAGES.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      {BOARD_STAGES.map((stage, index) => (
        <li
          key={stage}
          className="flex items-center gap-1.5"
          aria-current={index === reached ? "step" : undefined}
        >
          {index > 0 && (
            <span aria-hidden="true" className="text-fg-subtle">
              →
            </span>
          )}
          {index === reached ? (
            <Pill tone={STAGE_TONE[ticket.stage]}>{w.stage[ticket.stage]}</Pill>
          ) : (
            <span className={index < reached ? "text-fg" : "text-fg-subtle"}>{w.stage[stage]}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

function WorkbenchButton({ need }: { need: Extract<Need, { kind: "accept" }> }) {
  return (
    <Button size="sm" onClick={() => navigateHost(need.workbenchApp)}>
      {need.workbench}
    </Button>
  );
}

export function TicketDrawer() {
  const { w, org, place, openTicket } = useCompanyApp();
  const ticket = place.ticket === null ? undefined : ticketById(org, place.ticket);
  return (
    <Drawer
      open={ticket !== undefined}
      side="right"
      title={ticket === undefined ? "" : `${ticket.id} · ${ticket.title}`}
      onClose={() => openTicket(null)}
      closeLabel={w.ticket.close}
    >
      {ticket !== undefined && (
        <div className="space-y-5 p-4">
          <Track ticket={ticket} />
          <KeyValue size="sm">
            <KeyValueRow label={w.ticket.executor}>
              {memberById(org, ticket.executor)?.name}
            </KeyValueRow>
            <KeyValueRow label={w.ticket.verifier}>
              {memberById(org, ticket.verifier)?.name}
            </KeyValueRow>
            <KeyValueRow label={w.ticket.source}>{w.source[ticket.source]}</KeyValueRow>
            <KeyValueRow label={w.ticket.rounds}>
              {w.ticket.roundsValue(ticket.rounds, ticket.maxRounds)}
            </KeyValueRow>
            <KeyValueRow label={w.ticket.cost}>
              <span className="block">
                {w.ticket.costValue(money(ticket.spent), money(ticket.budget))}
              </span>
              <ProgressBar
                className="mt-1.5"
                size="xs"
                value={ticket.spent}
                max={ticket.budget}
                tone={ticket.spent >= ticket.budget * 0.9 ? "attention" : "accent"}
                label={w.ticket.cost}
              />
            </KeyValueRow>
            {ticket.need?.kind === "accept" && (
              <KeyValueRow label={w.ticket.workbench}>
                <WorkbenchButton need={ticket.need} />
              </KeyValueRow>
            )}
            {ticket.outcome !== undefined && (
              <KeyValueRow label={w.ticket.outcome}>{ticket.outcome}</KeyValueRow>
            )}
          </KeyValue>
          <CollapsibleSection title={w.ticket.log(ticket.log.length)} defaultOpen={false}>
            <ol className="space-y-1.5 px-3 pb-3">
              {ticket.log.map((line, index) => (
                <li key={index} className="text-xs">
                  <span className="text-fg-muted">{line.at}</span>
                  <span className="ml-2 text-fg">{line.text}</span>
                </li>
              ))}
            </ol>
          </CollapsibleSection>
        </div>
      )}
    </Drawer>
  );
}
