/**
 * The A2APP workbench: where a domain's work is accepted, in the shape that domain is reviewed
 * in. Code as a diff with its checks; an experiment as its curves and the figures they end on; a
 * long document by version, with comments pinned to paragraphs; a contract or an account as a
 * ledger; and anything that goes out as prefilled drafts the reader sends themselves.
 *
 * The ticket holds the assignment, the state and the record of calls; the review itself happens
 * here. Work the verifier has not passed yet shows with a notice, never with a way to accept it.
 */
import { useState } from "react";
import type { A2uiChart } from "@prismshadow/a2ui";
import {
  Button,
  Card,
  ChartBlock,
  DiffViewer,
  Pill,
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toastInfo,
} from "@prismshadow/penguin-ui";
import { CURVES } from "./fixtures";
import type { Ticket } from "./model";
import { SendBack } from "./needs-you";
import type { Drafts, TicketActions } from "./needs-you";
import { ADDRESSES, CODE } from "./samples";
import { useWords } from "./use-words";
import type { LedgerRow } from "./words";

const RISK_TONE: Record<LedgerRow["risk"], "success" | "attention" | "danger"> = {
  ok: "success",
  watch: "attention",
  block: "danger",
};

function CodeBench({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const change = CODE[ticket.fixture];
  if (change === undefined) return <p className="text-sm text-fg-muted">{W.workbench.empty}</p>;
  const checks = [
    W.workbench.code.checkCi,
    W.workbench.code.checkTests,
    W.workbench.code.checkVerifier,
  ];
  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-fg">{W.workbench.code.pr(change.pr, change.branch)}</p>
      <div>
        <h3 className="text-xs font-medium text-fg-muted">{W.workbench.code.checks}</h3>
        <ul className="mt-1 flex flex-wrap gap-2">
          {checks.map((check) => (
            <li key={check}>
              <Pill tone="success">{check}</Pill>
            </li>
          ))}
        </ul>
      </div>
      {change.files.map((file) => (
        <section key={file.path} aria-label={file.path} className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-fg">
            {file.path}
            {file.before === "" && <Pill>{W.workbench.code.newFile}</Pill>}
          </p>
          <DiffViewer
            before={file.before}
            after={file.after}
            language="typescript"
            label={file.path}
          />
        </section>
      ))}
    </div>
  );
}

/** The rounds an experiment has run before it is delivered: enough to show the trend. */
const INTERIM_ROUNDS = 2;

function ExperimentBench({ delivered }: { delivered: boolean }) {
  const W = useWords();
  const E = W.workbench.experiment;
  const shown = delivered ? CURVES.rounds : INTERIM_ROUNDS;
  const rounds = Array.from({ length: CURVES.rounds }, (_, i) => String(i + 1));
  const upTo = (values: readonly number[]) => values.map((value, i) => (i < shown ? value : null));
  const last = (values: readonly number[]) => values[shown - 1]!;
  const chart: A2uiChart = {
    type: "chart",
    kind: "line",
    title: E.chart,
    categories: rounds,
    xLabel: E.round,
    yLabel: E.accuracy,
    series: [
      { label: E.current, values: upTo(CURVES.current) },
      { label: E.candidate, values: upTo(CURVES.candidate) },
      { label: E.longDocs, values: upTo(CURVES.longDocs) },
    ],
  };
  const rows: [string, string, string][] = [
    [E.overall, last(CURVES.current).toFixed(1), last(CURVES.candidate).toFixed(1)],
    [E.long, "80.9", last(CURVES.longDocs).toFixed(1)],
    [E.cost, W.money(CURVES.costPerThousand.current), W.money(CURVES.costPerThousand.candidate)],
  ];
  return (
    <div className="space-y-4">
      <ChartBlock spec={chart} />
      <Table size="sm">
        <TableHead>
          <TableHeaderCell>{E.metric}</TableHeaderCell>
          <TableHeaderCell align="right">{E.currentModel}</TableHeaderCell>
          <TableHeaderCell align="right">{E.candidateModel}</TableHeaderCell>
        </TableHead>
        <TableBody>
          {rows.map(([metric, current, candidate]) => (
            <TableRow key={metric}>
              <TableCell>{metric}</TableCell>
              <TableCell numeric>{current}</TableCell>
              <TableCell numeric>{candidate}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-sm text-fg-muted">{delivered ? E.reproduced : E.interim(shown)}</p>
    </div>
  );
}

function DocumentBench({
  ticket,
  actions,
  drafts,
}: {
  ticket: Ticket;
  actions: TicketActions;
  drafts: Drafts;
}) {
  const W = useWords();
  const D = W.workbench.document;
  const data = W.docs[ticket.fixture];
  const versions = data?.versions ?? [[W.tickets[ticket.fixture].result, ...D.generic]];
  const latest = Math.max(1, ticket.versions);
  const [version, setVersion] = useState(latest);
  const [commenting, setCommenting] = useState<number | null>(null);
  const shown = versions[Math.min(version, versions.length) - 1]!;
  const mine = ticket.review.flatMap((entry) =>
    entry.by === "person" && entry.paragraph !== null ? [entry] : [],
  );
  const comments = [
    ...(data?.comments ?? [])
      .filter((comment) => comment.version === version)
      .map((comment) => ({ ...comment, by: W.ticket.verifierSays })),
    ...mine
      .filter((entry) => entry.version === version)
      .map((entry) => ({ paragraph: entry.paragraph!, text: entry.text, by: W.ticket.youSaid })),
  ];
  const revised = new Set(
    mine.filter((entry) => entry.version < version).map((entry) => entry.paragraph!),
  );
  const canComment = ticket.status === "deciding" && version === latest;
  return (
    <div className="space-y-3">
      {latest > 1 && (
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <span>{D.version}</span>
          <Segmented
            value={String(version)}
            onChange={(value) => setVersion(Number(value))}
            options={Array.from({ length: latest }, (_, i) => ({
              value: String(i + 1),
              label: `v${i + 1}`,
            }))}
          />
        </div>
      )}
      <ol className="space-y-3">
        {shown.map((paragraph, index) => {
          const pinned = comments.filter((comment) => comment.paragraph === index);
          return (
            <li key={index} className="group rounded-md">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-fg-subtle">
                  {index + 1}
                </span>
                <p
                  className={`min-w-0 flex-1 text-sm leading-relaxed text-fg ${
                    pinned.length > 0 ? "rounded bg-tone-attention-bg px-1.5 py-0.5" : ""
                  }`}
                >
                  {paragraph}
                </p>
                {canComment && commenting !== index && (
                  <Button size="sm" variant="ghost" onClick={() => setCommenting(index)}>
                    {D.comment}
                  </Button>
                )}
              </div>
              {revised.has(index) && <p className="ml-8 mt-1 text-xs text-fg-muted">{D.revised}</p>}
              {pinned.map((comment) => (
                <p key={comment.text} className="ml-8 mt-1 text-xs text-fg-muted">
                  <span className="text-fg">{comment.by}</span>
                  {W.colon}
                  {comment.text}
                  {version < latest && <span className="text-fg-subtle"> · {D.resolved}</span>}
                </p>
              ))}
              {commenting === index && (
                <div className="ml-8 mt-2">
                  <SendBack
                    ticket={ticket}
                    actions={actions}
                    drafts={drafts}
                    paragraph={index}
                    label={W.ticket.onParagraph(index + 1)}
                    placeholder={D.commentPlaceholder}
                    submit={D.commentSubmit}
                    onDone={() => setCommenting(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Mail({ to, subject, body }: { to: string; subject: string; body: string }) {
  const W = useWords();
  return (
    <Card padding="sm" className="space-y-1 text-sm">
      <p>
        <span className="text-fg-muted">{W.workbench.outreach.to}</span>
        {W.colon}
        <span className="font-mono">{to}</span>
      </p>
      <p>
        <span className="text-fg-muted">{W.workbench.outreach.subject}</span>
        {W.colon}
        {subject}
      </p>
      <p className="whitespace-pre-line pt-2 leading-relaxed text-fg">{body}</p>
    </Card>
  );
}

function LedgerBench({ ticket }: { ticket: Ticket }) {
  const W = useWords();
  const L = W.workbench.ledger;
  const rows = W.ledger[ticket.fixture] ?? [];
  const mail = W.mail[ticket.fixture];
  const address = ticket.fixture === "resellerTerms" ? ADDRESSES.resellerTerms : null;
  return (
    <div className="space-y-4">
      <Table size="sm">
        <TableHead>
          <TableHeaderCell>{L.item}</TableHeaderCell>
          <TableHeaderCell>{L.text}</TableHeaderCell>
          <TableHeaderCell>{L.risk}</TableHeaderCell>
          <TableHeaderCell>{L.note}</TableHeaderCell>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.item}>
              <TableCell nowrap>{row.item}</TableCell>
              <TableCell>{row.text}</TableCell>
              <TableCell nowrap>
                <Pill tone={RISK_TONE[row.risk]}>{L.risks[row.risk]}</Pill>
              </TableCell>
              <TableCell>{row.note}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {mail !== undefined && address !== null && (
        <section aria-label={L.draft} className="space-y-2">
          <h3 className="text-xs font-medium text-fg-muted">{L.draft}</h3>
          <Mail to={address} subject={mail.subject} body={mail.body} />
        </section>
      )}
    </div>
  );
}

function OutreachBench({ ticket, actions }: { ticket: Ticket; actions: TicketActions }) {
  const W = useWords();
  const O = W.workbench.outreach;
  const drafts = W.drafts[ticket.fixture];
  const mail = W.mail[ticket.fixture];
  if (drafts === undefined && mail !== undefined) {
    return <Mail to={ADDRESSES.proInquiry} subject={mail.subject} body={mail.body} />;
  }
  const open = ticket.status === "deciding";
  return (
    <ul className="space-y-3">
      {(drafts ?? []).map((draft, index) => (
        <li key={draft.author}>
          <Card padding="sm" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Pill>{draft.where}</Pill>
              <span>{draft.author}</span>
            </div>
            <p className="text-sm text-fg-muted">
              {O.original}
              {W.colon}
              {draft.post}
            </p>
            <p className="text-sm text-fg">
              <span className="text-fg-muted">{O.reply}</span>
              {W.colon}
              {draft.draft}
            </p>
            {open && (
              <Button
                size="sm"
                disabled={ticket.opened.includes(index)}
                onClick={() => {
                  actions.openDraft(ticket.id, index);
                  toastInfo(O.toast(draft.where));
                }}
              >
                {ticket.opened.includes(index) ? O.opened : O.open}
              </Button>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export function Workbench({
  ticket,
  actions,
  drafts,
}: {
  ticket: Ticket;
  actions: TicketActions;
  drafts: Drafts;
}) {
  const W = useWords();
  const interim = ticket.workbench === "experiment" && ticket.runs.length > 0;
  if (ticket.versions === 0 && ticket.status !== "deciding" && !interim) {
    return <p className="text-sm text-fg-muted">{W.workbench.empty}</p>;
  }
  const verified = ticket.status === "deciding" || ticket.status === "done";
  let bench;
  switch (ticket.workbench) {
    case "code":
      bench = <CodeBench ticket={ticket} />;
      break;
    case "experiment":
      bench = <ExperimentBench delivered={ticket.versions > 0} />;
      break;
    case "document":
      bench = <DocumentBench ticket={ticket} actions={actions} drafts={drafts} />;
      break;
    case "ledger":
      bench = <LedgerBench ticket={ticket} />;
      break;
    case "outreach":
      bench = <OutreachBench ticket={ticket} actions={actions} />;
      break;
  }
  return (
    <div className="space-y-4">
      <p>
        <Pill tone={verified ? "success" : "attention"}>
          {verified ? W.workbench.verifiedBy : W.workbench.notVerified}
        </Pill>
      </p>
      {bench}
    </div>
  );
}
