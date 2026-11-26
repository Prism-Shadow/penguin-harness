/**
 * The company's pages beside the inbox: the team (each member a role, a machine, a model and its
 * permissions, exported together as a template), the rules the server holds the company to, the
 * handbook (calls, lessons and every member's own skill, versioned, with a rollback), and the
 * review, the lead's figures and proposals, against a public benchmark of other companies.
 */
import type { ReactNode } from "react";
import {
  Button,
  PageFrame,
  PageHeader,
  Pill,
  RuledSection,
  Segmented,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  toastInfo,
} from "@prismshadow/penguin-ui";
import { TitleButton } from "../../../web/src/features/company/shared";
import { MODEL_NAME, MODELS } from "./fixtures";
import type { ExecutorId, MemberId, ModelId } from "./fixtures";
import { metricsOf, ticketOf } from "./model";
import type { CompanyState, Entry } from "./model";
import { PersonAvatar, memberName } from "./people";
import {
  DELEGATION_DEPTH,
  HOLDER,
  MAIN_LINE,
  OUTWARD_ACTIONS,
  OUTWARD_GRADES,
  TRIGGERS,
} from "./spec";
import type { OutwardAction, OutwardGrade, Trigger } from "./spec";
import { entryText, titleOf } from "./text";
import { useWords } from "./use-words";

const pct = (part: number, whole: number) =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

function teamOf(state: CompanyState): MemberId[] {
  return ["lead", ...state.hired, "verifier"];
}

export function TeamPage({
  state,
  onModel,
}: {
  state: CompanyState;
  onModel: (member: MemberId, model: ModelId) => void;
}) {
  const W = useWords();
  const T = W.team;
  return (
    <PageFrame width="lg">
      <PageHeader
        title={T.title}
        description={T.info}
        actions={
          <span className="flex gap-2">
            <Button size="sm" onClick={() => toastInfo(T.imported)}>
              {T.import}
            </Button>
            <Button size="sm" onClick={() => toastInfo(T.exported)}>
              {T.export}
            </Button>
          </span>
        }
      />
      <ul className="divide-y divide-line">
        {teamOf(state).map((id) => {
          const member = state.members[id];
          const spent = state.tickets
            .flatMap((ticket) => ticket.runs)
            .filter((run) => run.by === id)
            .reduce((sum, run) => sum + run.usd, 0);
          const executor = id === "dev" || id === "research" || id === "ops";
          const metrics = executor ? metricsOf(state, id) : null;
          return (
            <li key={id} className="flex gap-3 py-4">
              <PersonAvatar id={id} size={32} />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold">{memberName(id, W)}</span>
                  <span className="text-sm text-fg-muted">{W.roles[id].title}</span>
                  {executor && <Pill tone="info">{T.skill(state.skills[id].current)}</Pill>}
                  <span className="ml-auto text-xs tabular-nums text-fg-muted">
                    {T.spent(W.money(spent))}
                  </span>
                </p>
                <p className="text-sm text-fg">{W.roles[id].duties}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                  <span className="text-fg-muted">
                    {T.machine}
                    {W.colon}
                    <span className="text-fg">{W.machines[member.machine].name}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-fg-muted">{T.model}</span>
                    <span className="w-44">
                      <Select
                        size="sm"
                        aria-label={`${T.model} · ${memberName(id, W)}`}
                        value={member.model}
                        onChange={(event) => onModel(id, event.target.value as ModelId)}
                      >
                        {MODELS.map((model) => (
                          <option key={model} value={model}>
                            {MODEL_NAME[model]}
                          </option>
                        ))}
                      </Select>
                    </span>
                  </span>
                </div>
                <p className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-xs text-fg-muted">{T.perms}</span>
                  {member.perms.map((perm) => (
                    <Pill key={perm}>{W.perms[perm]}</Pill>
                  ))}
                </p>
                {metrics !== null && (
                  <p className="text-xs text-fg-muted">
                    {metrics.verified === 0
                      ? T.noMetrics
                      : T.metrics(
                          metrics.firstPass,
                          metrics.verified,
                          metrics.rework,
                          W.money(metrics.tickets === 0 ? 0 : metrics.spent / metrics.tickets),
                        )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 space-y-1 border-t border-line pt-4 text-xs text-fg-muted">
        <p className="text-fg">{T.channel}</p>
        <p>{T.channelNote}</p>
      </div>
    </PageFrame>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-sm text-fg">{label}</span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

export function RulesPage({
  state,
  onLimits,
  onGrade,
  onTrigger,
}: {
  state: CompanyState;
  onLimits: (limits: { budget?: number; rounds?: number }) => void;
  onGrade: (action: OutwardAction, grade: OutwardGrade) => void;
  onTrigger: (trigger: Trigger, on: boolean) => void;
}) {
  const W = useWords();
  const R = W.rules;
  return (
    <PageFrame width="md">
      <PageHeader title={R.title} description={R.info} />
      <div className="space-y-8">
        <RuledSection title={R.flow}>
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {MAIN_LINE.map((status, index) => {
              const holder = HOLDER[status];
              return (
                <li key={status} className="flex items-center gap-1">
                  {index > 0 && (
                    <span aria-hidden className="text-fg-subtle">
                      →
                    </span>
                  )}
                  <span className="rounded-md border border-line px-2 py-1 whitespace-nowrap">
                    {W.statuses[status]}
                    {holder !== null && (
                      <span className="text-fg-muted"> · {W.holders[holder]}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-sm text-fg-muted">{R.flowNote}</p>
        </RuledSection>
        <RuledSection title={R.gates}>
          <div className="divide-y divide-line">
            <Row label={R.budget}>
              <Segmented
                value={String(state.settings.budget)}
                onChange={(value) => onLimits({ budget: Number(value) })}
                options={[2, 5, 10].map((usd) => ({ value: String(usd), label: `$${usd}` }))}
              />
            </Row>
            <Row label={R.rounds}>
              <Segmented
                value={String(state.settings.rounds)}
                onChange={(value) => onLimits({ rounds: Number(value) })}
                options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </Row>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-fg">
            <li>{R.verified}</li>
            <li>{R.depth(DELEGATION_DEPTH)}</li>
          </ul>
        </RuledSection>
        <RuledSection title={R.outward}>
          <p className="text-sm text-fg-muted">{R.outwardNote}</p>
          <div className="mt-1 divide-y divide-line">
            {OUTWARD_ACTIONS.map((action) => (
              <Row key={action} label={W.outward.actions[action]}>
                <span className="block w-52">
                  <Select
                    size="sm"
                    aria-label={W.outward.actions[action]}
                    value={state.settings.grades[action]}
                    onChange={(event) => onGrade(action, event.target.value as OutwardGrade)}
                  >
                    {OUTWARD_GRADES.map((grade) => (
                      <option key={grade} value={grade}>
                        {W.outward.grades[grade]}
                      </option>
                    ))}
                  </Select>
                </span>
              </Row>
            ))}
          </div>
        </RuledSection>
        <RuledSection title={R.triggers}>
          <p className="text-sm text-fg-muted">{R.triggersNote}</p>
          <div className="mt-1 divide-y divide-line">
            {TRIGGERS.map((trigger) => (
              <Row key={trigger} label={W.triggers[trigger]}>
                <Switch
                  checked={state.settings.triggers[trigger]}
                  onChange={(on) => onTrigger(trigger, on)}
                  aria-label={W.triggers[trigger]}
                />
              </Row>
            ))}
          </div>
        </RuledSection>
        <RuledSection title={R.notNow}>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg">
            {R.notNowItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </RuledSection>
      </div>
    </PageFrame>
  );
}

function EntryList({
  entries,
  state,
  empty,
  onOpen,
}: {
  entries: Entry[];
  state: CompanyState;
  empty: string;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  if (entries.length === 0) return <p className="text-sm text-fg-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {entries.map((entry) => {
        const ticket = ticketOf(state, entry.ticket);
        return (
          <li key={entry.id} className="text-sm">
            <p className="text-fg">{entryText(entry, state.tickets, W)}</p>
            <p className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
              {ticket !== undefined && (
                <TitleButton className="min-w-0 truncate" onClick={() => onOpen(ticket.id)}>
                  {W.handbook.from(titleOf(ticket, W))}
                </TitleButton>
              )}
              {entry.kind === "lesson" && (
                <span>{W.handbook.lessonBy(memberName(entry.member, W))}</span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export function HandbookPage({
  state,
  onOpen,
  onRollback,
}: {
  state: CompanyState;
  onOpen: (id: string) => void;
  onRollback: (member: ExecutorId, v: number) => void;
}) {
  const W = useWords();
  const H = W.handbook;
  const files = [
    "org/README.md",
    "org/how-we-work.md",
    "org/handbook.md",
    ...state.hired.flatMap((id) => [
      `members/${id}/SKILL.md`,
      `members/${id}/.snapshots/v1…v${state.skills[id].versions.length}.md`,
    ]),
  ];
  return (
    <PageFrame width="md">
      <PageHeader title={H.title} description={H.info} />
      <div className="space-y-8">
        <RuledSection
          title={H.decisions}
          count={state.handbook.filter((e) => e.kind !== "lesson").length}
        >
          <EntryList
            entries={state.handbook.filter((entry) => entry.kind !== "lesson")}
            state={state}
            empty={H.decisionsEmpty}
            onOpen={onOpen}
          />
        </RuledSection>
        <RuledSection
          title={H.lessons}
          count={state.handbook.filter((e) => e.kind === "lesson").length}
        >
          <EntryList
            entries={state.handbook.filter((entry) => entry.kind === "lesson")}
            state={state}
            empty={H.lessonsEmpty}
            onOpen={onOpen}
          />
        </RuledSection>
        <RuledSection title={H.skills}>
          <div className="space-y-5">
            {state.hired.map((id) => {
              const skill = state.skills[id];
              return (
                <section key={id} aria-label={memberName(id, W)} className="space-y-2">
                  <p className="flex items-center gap-2 text-sm">
                    <PersonAvatar id={id} size={18} />
                    <span className="font-medium">{memberName(id, W)}</span>
                    <span className="text-fg-muted">{W.roles[id].title}</span>
                  </p>
                  <ol className="space-y-1.5">
                    {[...skill.versions].reverse().map((version) => {
                      const entry = state.handbook.find(
                        (candidate) => candidate.id === version.entry,
                      );
                      const current = version.v === skill.current;
                      return (
                        <li
                          key={version.v}
                          className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
                        >
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-xs text-fg">v{version.v}</span>
                            <Pill tone={current ? "success" : "neutral"}>
                              {current ? H.current : H.snapshot}
                            </Pill>
                          </span>
                          <span className="min-w-0 flex-1 text-sm text-fg">
                            {entry === undefined ? H.base : entryText(entry, state.tickets, W)}
                          </span>
                          {!current && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onRollback(id, version.v)}
                            >
                              {version.v < skill.current ? H.rollback : H.forward}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}
          </div>
        </RuledSection>
        <RuledSection title={H.files}>
          <ul className="space-y-0.5 font-mono text-xs text-fg">
            {files.map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
        </RuledSection>
      </div>
    </PageFrame>
  );
}

export function ReviewPage({
  state,
  onRun,
  onSubmit,
  onOpen,
}: {
  state: CompanyState;
  onRun: () => void;
  onSubmit: () => void;
  onOpen: (id: string) => void;
}) {
  const W = useWords();
  const V = W.review;
  const proposals = state.tickets.filter((ticket) => ticket.source === "review");
  const all = state.hired.map((id) => metricsOf(state, id));
  const verified = all.reduce((sum, m) => sum + m.verified, 0);
  const first = all.reduce((sum, m) => sum + m.firstPass, 0);
  const spent = all.reduce((sum, m) => sum + m.spent, 0);
  const tickets = all.reduce((sum, m) => sum + m.tickets, 0);
  const mix = [...new Set(state.hired.map((id) => MODEL_NAME[state.members[id].model]))].join(
    " / ",
  );
  return (
    <PageFrame width="lg">
      <PageHeader title={V.title} description={V.info} />
      <div className="space-y-8">
        <RuledSection
          title={V.inner}
          actions={
            <Button size="sm" onClick={onRun}>
              {V.run}
            </Button>
          }
        >
          <p className="text-xs text-fg-muted">{V.last(state.reviewed)}</p>
          <div className="mt-2">
            <Table size="sm">
              <TableHead>
                <TableHeaderCell>{V.member}</TableHeaderCell>
                <TableHeaderCell align="right">{V.firstPass}</TableHeaderCell>
                <TableHeaderCell align="right">{V.rework}</TableHeaderCell>
                <TableHeaderCell align="right">{V.perTicket}</TableHeaderCell>
              </TableHead>
              <TableBody>
                {state.hired.map((id) => {
                  const m = metricsOf(state, id);
                  return (
                    <TableRow key={id}>
                      <TableCell nowrap>
                        {memberName(id, W)} · {W.roles[id].title}
                      </TableCell>
                      <TableCell numeric>{pct(m.firstPass, m.verified)}</TableCell>
                      <TableCell numeric>{m.rework}</TableCell>
                      <TableCell numeric>
                        {m.tickets === 0 ? "—" : W.money(m.spent / m.tickets)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <h3 className="mt-4 text-xs font-medium text-fg-muted">{V.proposals}</h3>
          {proposals.length === 0 ? (
            <p className="mt-1 text-sm text-fg-muted">{V.proposalsEmpty}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {proposals.map((ticket) => (
                <li key={ticket.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <TitleButton className="min-w-0 truncate" onClick={() => onOpen(ticket.id)}>
                    {titleOf(ticket, W)}
                  </TitleButton>
                  <Pill tone={ticket.status === "proposed" ? "attention" : "neutral"}>
                    {W.statuses[ticket.status]}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </RuledSection>
        <RuledSection
          title={V.outer}
          actions={
            <Button size="sm" disabled={state.benchmark === "submitted"} onClick={onSubmit}>
              {state.benchmark === "submitted" ? V.submitted : V.submit}
            </Button>
          }
        >
          <p className="text-sm text-fg-muted">{V.outerNote}</p>
          <div className="mt-2">
            <Table size="sm">
              <TableHead>
                <TableHeaderCell>{V.template}</TableHeaderCell>
                <TableHeaderCell>{V.staffing}</TableHeaderCell>
                <TableHeaderCell>{V.models}</TableHeaderCell>
                <TableHeaderCell align="right">{V.firstPass}</TableHeaderCell>
                <TableHeaderCell align="right">{V.perTicket}</TableHeaderCell>
                <TableHeaderCell align="right">{V.score}</TableHeaderCell>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell nowrap className="font-medium">
                    {V.yours}
                  </TableCell>
                  <TableCell nowrap>{`1 + ${state.hired.length} + 1`}</TableCell>
                  <TableCell>{mix}</TableCell>
                  <TableCell numeric>{pct(first, verified)}</TableCell>
                  <TableCell numeric>{tickets === 0 ? "—" : W.money(spent / tickets)}</TableCell>
                  <TableCell numeric>—</TableCell>
                </TableRow>
                {V.rows.map((row) => (
                  <TableRow key={row.template}>
                    <TableCell nowrap>{row.template}</TableCell>
                    <TableCell nowrap>{row.staffing}</TableCell>
                    <TableCell>{row.models}</TableCell>
                    <TableCell numeric>{row.firstPass}</TableCell>
                    <TableCell numeric>{row.perTicket}</TableCell>
                    <TableCell numeric>{row.score}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </RuledSection>
      </div>
    </PageFrame>
  );
}
