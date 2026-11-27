import { useMemo, useState } from "react";
import {
  Button,
  ListRow,
  PageFrame,
  PageHeader,
  Pill,
  RuledSection,
  SettingsList,
  Textarea,
  toastSuccess,
} from "@prismshadow/penguin-ui";
import { A2uiActionsProvider, ChoiceBlock } from "@prismshadow/penguin-ui/a2ui";
import { STAGE_TONE, useCompanyApp } from "./context";
import { LEAD_SESSION, money } from "./fixtures";
import { navigateHost } from "./frame";
import { BUDGET_STEP, inProgress, memberById, settled, waitingOnYou } from "./model";
import type { Need, Ticket } from "./model";

function TicketMeta({ ticket }: { ticket: Ticket }) {
  const { w, org } = useCompanyApp();
  const executor = memberById(org, ticket.executor)?.name ?? ticket.executor;
  const verifier = memberById(org, ticket.verifier)?.name ?? ticket.verifier;
  return (
    <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-muted">
      <span>
        {w.ticket.executor} {executor}
      </span>
      <span>
        {w.ticket.verifier} {verifier}
      </span>
      <span>
        {w.ticket.rounds} {w.ticket.roundsValue(ticket.rounds, ticket.maxRounds)}
      </span>
      <span>
        {w.ticket.cost} {w.ticket.costValue(money(ticket.spent), money(ticket.budget))}
      </span>
    </span>
  );
}

function needLabel(need: Need, w: ReturnType<typeof useCompanyApp>["w"]): string {
  if (need.kind === "decision") return w.inbox.decision;
  if (need.kind === "accept") return w.inbox.accept;
  return w.inbox.breaker;
}

function Decision({ ticket, need }: { ticket: Ticket; need: Extract<Need, { kind: "decision" }> }) {
  const { w, lang, act } = useCompanyApp();
  const actions = useMemo(
    () => ({
      interactive: true,
      lang,
      fill: (text: string) => {
        if (text.trim() === "") return;
        act.decide(ticket.id, text);
        toastSuccess(w.inbox.answered(text));
      },
    }),
    [act, lang, ticket.id, w],
  );
  return (
    <A2uiActionsProvider value={actions}>
      <ChoiceBlock
        spec={{
          type: "choice",
          question: need.question,
          options: need.options.map((option) => ({
            label: option.label,
            ...(option.description !== undefined ? { description: option.description } : {}),
            ...(option.recommended ? { recommended: true } : {}),
          })),
        }}
      />
    </A2uiActionsProvider>
  );
}

function Acceptance({ ticket, need }: { ticket: Ticket; need: Extract<Need, { kind: "accept" }> }) {
  const { w, act } = useCompanyApp();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-fg-muted">{w.inbox.verdict}</p>
        <p className="mt-0.5 text-sm text-fg">{need.verdict}</p>
      </div>
      <p className="text-xs text-fg-muted">
        {w.grade.label} · {w.grade[need.grade]}
      </p>
      {note === null ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => act.accept(ticket.id)}>
            {w.inbox.acceptWork}
          </Button>
          <Button size="sm" onClick={() => navigateHost(need.workbenchApp)}>
            {w.inbox.openWorkbench}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNote("")}>
            {w.inbox.sendBack}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Textarea
            size="sm"
            label={w.inbox.sendBackNote}
            placeholder={w.inbox.sendBackPlaceholder}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={note.trim() === ""}
              onClick={() => {
                act.sendBack(ticket.id, note);
                setNote(null);
              }}
            >
              {w.inbox.confirmSendBack}
            </Button>
            <Button size="sm" onClick={() => setNote(null)}>
              {w.inbox.cancel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Breaker({ ticket, need }: { ticket: Ticket; need: Extract<Need, { kind: "breaker" }> }) {
  const { w, act } = useCompanyApp();
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-fg-muted">
          {need.reason === "rounds" ? w.inbox.roundsOut(ticket.maxRounds) : w.inbox.budgetOut}
        </p>
        <p className="mt-0.5 text-sm text-fg">{need.verdict}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => act.resume(ticket.id)}>
          {need.reason === "rounds" ? w.inbox.moreRound : w.inbox.moreBudget(money(BUDGET_STEP))}
        </Button>
        <Button size="sm" onClick={() => navigateHost(LEAD_SESSION)}>
          {w.inbox.takeOver}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => act.stop(ticket.id)}>
          {w.inbox.stop}
        </Button>
      </div>
    </div>
  );
}

function NeedCard({ ticket }: { ticket: Ticket }) {
  const { w, openTicket } = useCompanyApp();
  const need = ticket.need;
  if (need === undefined) return null;
  return (
    <li className="space-y-3 py-5 first:pt-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs text-fg-muted tabular-nums">{ticket.id}</span>
        <button
          type="button"
          onClick={() => openTicket(ticket.id)}
          className="min-w-0 truncate text-left text-sm font-medium text-fg hover:text-link"
        >
          {ticket.title}
        </button>
        <Pill tone={need.kind === "breaker" ? "danger" : "attention"}>{needLabel(need, w)}</Pill>
        <span className="ml-auto text-xs text-fg-muted">{ticket.updated}</span>
      </div>
      <TicketMeta ticket={ticket} />
      {need.kind === "decision" && <Decision ticket={ticket} need={need} />}
      {need.kind === "accept" && <Acceptance ticket={ticket} need={need} />}
      {need.kind === "breaker" && <Breaker ticket={ticket} need={need} />}
    </li>
  );
}

export function TicketRows({ tickets, label }: { tickets: readonly Ticket[]; label: string }) {
  const { w, openTicket } = useCompanyApp();
  return (
    <SettingsList label={label}>
      {tickets.map((ticket) => (
        <ListRow
          key={ticket.id}
          as="li"
          title={ticket.title}
          titleTrail={<Pill tone={STAGE_TONE[ticket.stage]}>{w.stage[ticket.stage]}</Pill>}
          description={ticket.outcome ?? `${ticket.id} · ${ticket.updated}`}
          meta={<TicketMeta ticket={ticket} />}
          onClick={() => openTicket(ticket.id)}
        />
      ))}
    </SettingsList>
  );
}

export function InboxPage() {
  const { w, org } = useCompanyApp();
  const yours = waitingOnYou(org);
  const working = inProgress(org);
  const done = settled(org);
  return (
    <PageFrame width="lg">
      <PageHeader title={w.inbox.title} info={w.inbox.info} />
      <div className="space-y-8">
        <RuledSection title={w.inbox.yours} count={yours.length}>
          {yours.length === 0 ? (
            <p className="text-sm text-fg-muted">{w.inbox.nothingYours}</p>
          ) : (
            <ul className="divide-y divide-line-muted">
              {yours.map((ticket) => (
                <NeedCard key={ticket.id} ticket={ticket} />
              ))}
            </ul>
          )}
        </RuledSection>
        <RuledSection title={w.inbox.working} count={working.length}>
          {working.length === 0 ? (
            <p className="text-sm text-fg-muted">{w.inbox.nothingWorking}</p>
          ) : (
            <TicketRows tickets={working} label={w.inbox.working} />
          )}
        </RuledSection>
        <RuledSection title={w.inbox.settled} count={done.length}>
          {done.length === 0 ? (
            <p className="text-sm text-fg-muted">{w.inbox.nothingSettled}</p>
          ) : (
            <TicketRows tickets={done} label={w.inbox.settled} />
          )}
        </RuledSection>
      </div>
    </PageFrame>
  );
}
