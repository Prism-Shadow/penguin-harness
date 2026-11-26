/**
 * A ticket: who holds it, where it stands on the state machine, what it may still spend and how
 * often it may still be sent back, then what it asks of the reader, if anything. Below, three
 * tabs: the ticket itself (goal, criteria, review, the calls made on it, the result), the
 * workbench its domain is accepted in, and its runs: the bill, and the execution log folded away.
 */
import {
  CollapsibleSection,
  PageFrame,
  PageHeader,
  Pill,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
} from "@prismshadow/penguin-ui";
import type { ReactNode } from "react";
import { MODEL_NAME } from "./fixtures";
import { ticketWait } from "./model";
import type { CompanyState, Decision, Ticket } from "./model";
import { NeedsYou } from "./needs-you";
import type { Drafts, TicketActions } from "./needs-you";
import { Byline, memberName } from "./people";
import { HOLDER, MAIN_LINE } from "./spec";
import { titleOf } from "./text";
import { useWords } from "./use-words";
import type { Words } from "./words";
import { Workbench } from "./workbench";

export type TicketTab = "record" | "workbench" | "runs";

function Stepper({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const at = MAIN_LINE.indexOf(ticket.status);
  const waiting = ticketWait(ticket) !== null;
  return (
    <ol aria-label={W.rules.flow} className="flex flex-wrap items-stretch gap-1 text-xs">
      {MAIN_LINE.map((status, index) => {
        const holder = HOLDER[status];
        const current = index === at;
        const tone = current
          ? waiting
            ? "bg-tone-attention-bg text-tone-attention-fg"
            : "bg-tone-success-bg text-tone-success-fg"
          : index < at
            ? "text-fg-muted"
            : "text-fg-subtle";
        return (
          <li key={status} className="flex items-center gap-1">
            {index > 0 && (
              <span aria-hidden className="text-fg-subtle">
                →
              </span>
            )}
            <span
              aria-current={current ? "step" : undefined}
              className={`rounded-md border border-line px-2 py-1 whitespace-nowrap ${tone}`}
            >
              <span className={current ? "font-semibold" : ""}>{W.statuses[status]}</span>
              {holder !== null && <span className="ml-1 opacity-80">· {W.holders[holder]}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function decisionText(decision: Decision, ticket: Ticket, W: Words): string {
  switch (decision.kind) {
    case "ask": {
      const label =
        W.tickets[ticket.fixture].ask?.options[decision.option]?.label ?? decision.option;
      const said = W.decision.ask(label);
      return decision.note === "" ? said : `${said}${W.colon}${decision.note}`;
    }
    case "halt":
      return `${decision.halt === "budget" ? W.needs.haltBudgetTitle : W.needs.haltRoundsTitle}${W.colon}${W.decision.halt[decision.choice]}`;
    case "accept":
      return decision.outward === null
        ? W.decision.accept
        : W.decision.acceptWith(W.outward.actions[decision.outward]);
    case "sendBack":
      return W.decision.sendBack;
    case "proposal":
      return decision.accepted ? W.decision.proposalYes : W.decision.proposalNo;
    case "drop":
      return W.decision.drop;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-xs font-medium text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function Record({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const words = W.tickets[ticket.fixture];
  const delivered = ticket.status === "deciding" || ticket.status === "done";
  return (
    <div className="space-y-5 text-sm">
      <Section title={W.ticket.goal}>
        <p className="leading-relaxed text-fg">{ticket.text ?? words.goal}</p>
      </Section>
      <Section title={W.ticket.criteria}>
        <ul className="list-disc space-y-0.5 pl-5 text-fg">
          {words.criteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </Section>
      <Section title={W.ticket.review}>
        {ticket.review.length === 0 ? (
          <p className="text-fg-muted">{W.ticket.reviewEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {ticket.review.map((entry, i) => (
              <li key={i} className="leading-relaxed">
                <span className="text-fg-muted">
                  {entry.by === "verifier"
                    ? `${W.ticket.round(entry.round)} · ${memberName("verifier", W)}`
                    : entry.paragraph !== null
                      ? `${W.ticket.youSaid} · ${W.ticket.onParagraph(entry.paragraph + 1)}`
                      : W.ticket.youSaid}
                  {W.colon}
                </span>
                <span className="text-fg">
                  {entry.by === "verifier" ? (words.findings?.[entry.finding] ?? "") : entry.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={W.ticket.decisions}>
        {ticket.decisions.length === 0 ? (
          <p className="text-fg-muted">{W.ticket.decisionsEmpty}</p>
        ) : (
          <ul className="space-y-1">
            {ticket.decisions.map((decision, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-fg">
                {decisionText(decision, ticket, W)}
                {decision.kind === "ask" && decision.filed && (
                  <Pill tone="info">{W.ticket.filedToHandbook}</Pill>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={W.ticket.result}>
        <p className={delivered ? "leading-relaxed text-fg" : "text-fg-muted"}>
          {delivered && words.result !== "" ? words.result : W.ticket.resultPending}
        </p>
      </Section>
    </div>
  );
}

function Runs({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const R = W.runs;
  if (ticket.runs.length === 0) return <p className="text-sm text-fg-muted">{R.empty}</p>;
  const tools = ticket.runs.reduce((sum, run) => sum + run.tools, 0);
  const tokens = ticket.runs.reduce((sum, run) => sum + run.tokens, 0);
  return (
    <div className="space-y-4">
      <Table size="sm" caption={R.bill}>
        <TableHead>
          <TableHeaderCell>{R.step}</TableHeaderCell>
          <TableHeaderCell>{R.who}</TableHeaderCell>
          <TableHeaderCell>{R.model}</TableHeaderCell>
          <TableHeaderCell align="right">{R.tokens}</TableHeaderCell>
          <TableHeaderCell align="right">{R.cache}</TableHeaderCell>
          <TableHeaderCell align="right">{R.cost}</TableHeaderCell>
        </TableHead>
        <TableBody>
          {ticket.runs.map((run, i) => (
            <TableRow key={i}>
              <TableCell nowrap>{R.steps[run.step]}</TableCell>
              <TableCell nowrap>{memberName(run.by, W)}</TableCell>
              <TableCell nowrap>{MODEL_NAME[run.model]}</TableCell>
              <TableCell numeric>{W.tokens(run.tokens)}</TableCell>
              <TableCell numeric>{`${Math.round(run.cache * 100)}%`}</TableCell>
              <TableCell numeric>{W.money(run.usd)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="font-medium">{R.total}</TableCell>
            <TableCell />
            <TableCell />
            <TableCell numeric className="font-medium">
              {W.tokens(tokens)}
            </TableCell>
            <TableCell />
            <TableCell numeric className="font-medium">
              {W.money(ticket.spent)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <CollapsibleSection title={R.log} meta={R.logMeta(tools)} defaultOpen={false}>
        <p className="text-xs text-fg-muted">{R.logNote}</p>
        <ol className="mt-2 space-y-1 font-mono text-xs text-fg">
          {ticket.runs.map((run, i) => (
            <li key={i}>
              {`#${i + 1} ${memberName(run.by, W)} · ${R.logLine(R.steps[run.step], run.tools)}`}
            </li>
          ))}
        </ol>
      </CollapsibleSection>
    </div>
  );
}

export function TicketView({
  ticket,
  state,
  actions,
  drafts,
  tab,
  onTab,
}: {
  ticket: Ticket;
  state: CompanyState;
  actions: TicketActions;
  drafts: Drafts;
  tab: TicketTab;
  onTab: (tab: TicketTab) => void;
}) {
  const W = useWords();
  const owner = state.members[ticket.owner];
  const budgetShare = ticket.budget === 0 ? 0 : ticket.spent / ticket.budget;
  const offLine = ticket.status === "proposed" || ticket.status === "dropped";
  return (
    <PageFrame width="lg">
      <PageHeader
        title={titleOf(ticket, W)}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-fg-muted">{W.ticket.owner}</span>
              <Byline id={ticket.owner} />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-fg-muted">{W.ticket.verifier}</span>
              <Byline id="verifier" />
            </span>
            <span className="text-fg-muted whitespace-nowrap">
              {W.machines[owner.machine].name} · {MODEL_NAME[owner.model]}
            </span>
            <Pill>{W.sources[ticket.source]}</Pill>
          </span>
        }
      />
      <div className="space-y-4">
        {ticket.status === "dropped" && <p className="text-sm text-fg-muted">{W.ticket.dropped}</p>}
        {!offLine && <Stepper ticket={ticket} />}
        {!offLine && (
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div className="space-y-1">
              <p className="flex justify-between gap-2">
                <span className="text-fg-muted">{W.ticket.budget}</span>
                <span className="tabular-nums text-fg">
                  {W.ticket.spentOf(W.money(ticket.spent), W.money(ticket.budget))}
                </span>
              </p>
              <ProgressBar
                size="xs"
                value={Math.min(1, budgetShare)}
                max={1}
                tone={
                  ticket.halt === "budget" ? "danger" : budgetShare >= 0.8 ? "attention" : "accent"
                }
                label={W.ticket.budget}
              />
            </div>
            <div className="space-y-1">
              <p className="flex justify-between gap-2">
                <span className="text-fg-muted">{W.ticket.rounds}</span>
                <span className="tabular-nums text-fg">
                  {W.ticket.roundsOf(ticket.rounds.used, ticket.rounds.limit)}
                </span>
              </p>
              <ProgressBar
                size="xs"
                value={ticket.rounds.used}
                max={Math.max(1, ticket.rounds.limit)}
                tone={ticket.halt === "rounds" ? "danger" : "accent"}
                label={W.ticket.rounds}
              />
            </div>
          </div>
        )}
        <NeedsYou
          ticket={ticket}
          state={state}
          actions={actions}
          drafts={drafts}
          onWorkbench={tab === "workbench" ? null : () => onTab("workbench")}
        />
        <Tabs
          items={[
            { key: "record", label: W.ticket.tabs.record },
            { key: "workbench", label: W.ticket.tabs.workbench },
            { key: "runs", label: W.ticket.tabs.runs },
          ]}
          active={tab}
          onChange={onTab}
        />
        <div className="pb-8">
          {tab === "record" && <Record ticket={ticket} />}
          {tab === "workbench" && <Workbench ticket={ticket} actions={actions} drafts={drafts} />}
          {tab === "runs" && <Runs ticket={ticket} />}
        </div>
      </div>
    </PageFrame>
  );
}
