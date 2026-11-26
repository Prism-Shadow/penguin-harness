/**
 * What a ticket asks of the reader, at the head of the ticket, in the one shape its wait takes.
 *
 * A question the work stopped on is an A2UI form, the same block a reply in a conversation draws:
 * the options with the executor's recommendation marked, a note, and whether the call goes into
 * the handbook. Submitting it writes the answer back to the ticket instead of filling a composer.
 * While the reader has changed something and not submitted, the form's draft is kept, and the
 * inbox marks the ticket as holding one.
 *
 * A breaker says what the server stopped and offers the three ways on; verified work offers the
 * workbench and the approval its outward action's grade asks for; a proposal from the lead is
 * accepted or declined.
 */
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { parseFormFill } from "@prismshadow/a2ui";
import type { A2uiForm } from "@prismshadow/a2ui";
import {
  A2uiActionsProvider,
  A2uiBlock,
  Button,
  Card,
  Checkbox,
  Pill,
  Textarea,
} from "@prismshadow/penguin-ui";
import type { A2uiActions, A2uiDrafts } from "@prismshadow/penguin-ui";
import { useLocale } from "../../../web/src/state/locale";
import { FIXTURES } from "./fixtures";
import { ticketWait } from "./model";
import type { CompanyState, HaltChoice, Ticket } from "./model";
import { useWords } from "./use-words";
import type { Words } from "./words";

export interface TicketActions {
  answerAsk: (id: string, option: string, note: string, file: boolean) => void;
  answerHalt: (id: string, choice: HaltChoice) => void;
  accept: (id: string) => void;
  sendBack: (id: string, text: string, paragraph?: number | null) => void;
  openDraft: (id: string, index: number) => void;
  proposal: (id: string, accepted: boolean) => void;
}

/** The reader's unsent words, kept per ticket so the inbox can mark them. */
export interface Drafts {
  store: A2uiDrafts;
  text: (key: string) => string;
  setText: (key: string, value: string) => void;
}

/** The ticket's question as an A2UI form: the decision, a note, and the handbook switch. */
export function askForm(ticket: Ticket, W: Words): A2uiForm | null {
  const staged = FIXTURES[ticket.fixture].ask;
  const words = W.tickets[ticket.fixture].ask;
  if (staged === undefined || words === undefined) return null;
  return {
    type: "form",
    id: "decision",
    fields: [
      {
        id: "decision",
        label: W.needs.askField,
        kind: "single",
        required: true,
        options: staged.options.map((option) => ({
          label: words.options[option]!.label,
          description: words.options[option]!.description,
          ...(option === staged.recommended ? { recommended: true } : {}),
        })),
        default: words.options[staged.recommended]!.label,
      },
      {
        id: "note",
        label: W.needs.noteField,
        kind: "textarea",
        placeholder: W.needs.notePlaceholder,
        maxLength: 500,
      },
      { id: "handbook", label: W.needs.fileField, kind: "switch", default: true },
    ],
    submitLabel: W.needs.submit,
  };
}

function Frame({
  title,
  tone = "attention",
  label,
  children,
}: {
  title: string;
  tone?: "attention" | "danger" | "success" | "info";
  label: string;
  children: ReactNode;
}) {
  return (
    <Card as="section" padding="md" aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <Pill tone={tone}>{label}</Pill>
      </div>
      {children}
    </Card>
  );
}

function AskCard({
  ticket,
  actions,
  drafts,
}: {
  ticket: Ticket;
  actions: TicketActions;
  drafts: Drafts;
}) {
  const W = useWords();
  const lang = useLocale().locale === "zh" ? "zh" : "en";
  const spec = useMemo(() => askForm(ticket, W), [ticket, W]);
  const staged = FIXTURES[ticket.fixture].ask;
  const value = useMemo<A2uiActions>(
    () => ({
      interactive: true,
      lang,
      drafts: drafts.store,
      draftScope: ticket.id,
      fill: (text) => {
        if (spec === null || staged === undefined) return;
        const answers = parseFormFill(spec, text) ?? {};
        const picked = answers.decision;
        const words = W.tickets[ticket.fixture].ask!;
        const option =
          staged.options.find((candidate) => words.options[candidate]!.label === picked) ??
          staged.recommended;
        const note = typeof answers.note === "string" ? answers.note : "";
        actions.answerAsk(ticket.id, option, note, answers.handbook !== false);
      },
    }),
    [actions, drafts.store, lang, spec, staged, ticket.fixture, ticket.id, W],
  );
  const words = W.tickets[ticket.fixture].ask;
  if (spec === null || words === undefined) return null;
  return (
    <Frame title={W.needs.askTitle} label={W.waits.ask}>
      <p className="text-sm text-fg">
        {words.question} <span className="text-fg-muted">{words.context}</span>
      </p>
      <A2uiActionsProvider value={value}>
        <A2uiBlock source={JSON.stringify(spec)} />
      </A2uiActionsProvider>
    </Frame>
  );
}

function HaltCard({ ticket, actions }: { ticket: Ticket; actions: TicketActions }) {
  const W = useWords();
  const next = ticket.script[ticket.at]?.usd ?? 0;
  const budget = ticket.halt === "budget";
  const findings = W.tickets[ticket.fixture].findings ?? [];
  const last = ticket.script[ticket.at];
  const disagreement = !budget && last?.k === "fail" ? findings[last.finding] : undefined;
  const choices: { choice: HaltChoice; label: string; primary?: boolean }[] = budget
    ? [
        { choice: "more", label: W.needs.moreBudget(W.money(ticket.budget * 2)), primary: true },
        { choice: "stop", label: W.needs.stop },
      ]
    : [
        { choice: "decide", label: W.needs.decide, primary: true },
        { choice: "more", label: W.needs.moreRound },
        { choice: "stop", label: W.needs.stop },
      ];
  return (
    <Frame
      title={budget ? W.needs.haltBudgetTitle : W.needs.haltRoundsTitle}
      tone="danger"
      label={W.waits.halt}
    >
      <p className="text-sm text-fg">
        {budget
          ? W.needs.haltBudget(W.money(ticket.spent), W.money(next), W.money(ticket.budget))
          : W.needs.haltRounds(ticket.rounds.limit)}
      </p>
      {disagreement !== undefined && (
        <p className="text-sm text-fg-muted">
          {W.needs.disagreement}
          {W.colon}
          {disagreement}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {choices.map(({ choice, label, primary }) => (
          <Button
            key={choice}
            size="sm"
            variant={primary ? "primary" : "secondary"}
            onClick={() => actions.answerHalt(ticket.id, choice)}
          >
            {label}
          </Button>
        ))}
      </div>
    </Frame>
  );
}

/** Sending verified work back: the reader's words, kept as a draft until they send them. */
export function SendBack({
  ticket,
  actions,
  drafts,
  paragraph = null,
  label,
  placeholder,
  submit,
  onDone,
}: {
  ticket: Ticket;
  actions: TicketActions;
  drafts: Drafts;
  paragraph?: number | null;
  label: string;
  placeholder: string;
  submit: string;
  onDone: () => void;
}) {
  const W = useWords();
  const key = `${ticket.id}:back:${paragraph ?? "all"}`;
  const text = drafts.text(key);
  return (
    <div className="space-y-2">
      <Textarea
        size="sm"
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        autoFocus
        onChange={(event) => drafts.setText(key, event.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={text.trim() === ""}
          onClick={() => {
            actions.sendBack(ticket.id, text, paragraph);
            drafts.setText(key, "");
            onDone();
          }}
        >
          {submit}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            drafts.setText(key, "");
            onDone();
          }}
        >
          {W.needs.cancel}
        </Button>
      </div>
    </div>
  );
}

function DecideCard({
  ticket,
  state,
  actions,
  drafts,
  onWorkbench,
}: {
  ticket: Ticket;
  state: CompanyState;
  actions: TicketActions;
  drafts: Drafts;
  onWorkbench: (() => void) | null;
}) {
  const W = useWords();
  const [checked, setChecked] = useState(false);
  const [back, setBack] = useState(drafts.text(`${ticket.id}:back:all`) !== "");
  const action = ticket.outward;
  const grade = action === null ? null : state.settings.grades[action];
  const draftCount = W.drafts[ticket.fixture]?.length ?? 0;
  const allOpened = draftCount === 0 || ticket.opened.length >= draftCount;
  const ready = grade === "review" ? checked : grade === "draft" ? allOpened : true;
  return (
    <Frame title={W.needs.decideTitle} tone="success" label={W.waits.decide}>
      <p className="text-sm text-fg">{W.needs.decideLine}</p>
      {action !== null && grade !== null && (
        <p className="text-sm">
          <span className="text-fg">{W.outward.actions[action]}</span>
          <span className="text-fg-muted">
            {" · "}
            {W.outward.grades[grade]}
            {" · "}
            {W.outward.gradeHint[grade]}
          </span>
        </p>
      )}
      {grade === "draft" && <p className="text-sm text-fg-muted">{W.needs.draftLine}</p>}
      {grade === "review" && (
        <Checkbox size="sm" checked={checked} onChange={setChecked} label={W.needs.reviewCheck} />
      )}
      {back ? (
        <SendBack
          ticket={ticket}
          actions={actions}
          drafts={drafts}
          label={W.needs.sendBack}
          placeholder={W.needs.sendBackPlaceholder}
          submit={W.needs.sendBackSubmit}
          onDone={() => setBack(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {onWorkbench !== null && (
            <Button size="sm" onClick={onWorkbench}>
              {W.needs.openWorkbench}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={!ready}
            onClick={() => actions.accept(ticket.id)}
          >
            {action === null ? W.needs.acceptOnly : W.needs.approve[action]}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBack(true)}>
            {W.needs.sendBack}
          </Button>
        </div>
      )}
    </Frame>
  );
}

function ProposalCard({ ticket, actions }: { ticket: Ticket; actions: TicketActions }) {
  const W = useWords();
  return (
    <Frame title={W.needs.proposalTitle} tone="info" label={W.waits.accept}>
      <p className="text-sm text-fg">{W.tickets[ticket.fixture].goal}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => actions.proposal(ticket.id, true)}>
          {W.needs.adopt}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.proposal(ticket.id, false)}>
          {W.needs.decline}
        </Button>
      </div>
    </Frame>
  );
}

export function NeedsYou({
  ticket,
  state,
  actions,
  drafts,
  onWorkbench,
}: {
  ticket: Ticket;
  state: CompanyState;
  actions: TicketActions;
  drafts: Drafts;
  /** Opens the workbench, or null when it is on show. */
  onWorkbench: (() => void) | null;
}) {
  const wait = ticketWait(ticket);
  if (wait === "ask") return <AskCard ticket={ticket} actions={actions} drafts={drafts} />;
  if (wait === "halt") return <HaltCard ticket={ticket} actions={actions} />;
  if (wait === "accept") return <ProposalCard ticket={ticket} actions={actions} />;
  if (wait === "decide") {
    return (
      <DecideCard
        key={ticket.id}
        ticket={ticket}
        state={state}
        actions={actions}
        drafts={drafts}
        onWorkbench={onWorkbench}
      />
    );
  }
  return null;
}
