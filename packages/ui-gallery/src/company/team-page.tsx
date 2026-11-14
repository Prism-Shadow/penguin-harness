/**
 * The team: who works here, in the place of the shipped org chart. Each employee is a standing
 * role, read in one row: its name and title, who it reports to, what it is responsible for, the
 * Tokens it has used this month and what they cost, and the work sessions it has open, each a link to the
 * conversation. A role the lead has proposed and the reader has not yet accepted is listed under
 * the team as a proposal; hiring goes through the lead, like any other request.
 */
import { Button, PageFrame, PageHeader, Pill } from "@prismshadow/penguin-ui";
import { TitleButton } from "../../../web/src/features/company/shared";
import { EMPLOYEES } from "./fixtures";
import type { Byline } from "./fixtures";
import { costOf, employeeMetrics, liveSessions, sessionStatus, spendOf } from "./model";
import type { CompanyState } from "./model";
import { waitOf } from "./spec";
import { money, titleOf, tokens } from "./text";
import { SessionStatusPill } from "./needs-you";
import { PersonAvatar } from "./people";
import { useWords } from "./use-words";

const QUIET = "text-fg-muted";

export function TeamPage({
  state,
  onHire,
  onOpenSession,
}: {
  state: CompanyState;
  onHire: () => void;
  onOpenSession: (id: string) => void;
}) {
  const W = useWords();
  const team: Byline[] = ["lead", ...state.roles];
  // A role proposal still waiting on the reader: the person it would bring in.
  const proposed = state.tickets.some(
    (ticket) => ticket.kind === "role" && waitOf(ticket) === "accept",
  )
    ? (["verifier"] as const).filter((byline) => !team.includes(byline))
    : [];
  return (
    <PageFrame width="xl">
      <PageHeader
        title={W.team.title}
        info={W.team.info}
        description={W.team.hireHint}
        actions={
          <Button size="sm" onClick={onHire}>
            {W.team.hire}
          </Button>
        }
      />
      <p className="text-xs tabular-nums text-fg-muted">
        {W.team.total(tokens(spendOf(state)), money(spendOf(state)))}
      </p>
      <ul className="mt-2 divide-y divide-line">
        {team.map((byline) => (
          <Member key={byline} byline={byline} state={state} onOpenSession={onOpenSession} />
        ))}
        {proposed.map((byline) => (
          <li key={byline} className="flex gap-3 py-4">
            <PersonAvatar byline={byline} size={32} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold">{W.people[byline].name}</span>
                <span className={`text-sm ${QUIET}`}>{W.people[byline].title}</span>
                <Pill tone="attention">{W.team.pending}</Pill>
              </p>
              <p className="mt-1 text-sm text-fg">{W.people[byline].duties}</p>
              <p className={`mt-1 text-xs ${QUIET}`}>{W.team.pendingNote}</p>
            </div>
          </li>
        ))}
      </ul>
    </PageFrame>
  );
}

function Member({
  byline,
  state,
  onOpenSession,
}: {
  byline: Byline;
  state: CompanyState;
  onOpenSession: (id: string) => void;
}) {
  const W = useWords();
  const person = W.people[byline];
  const employee = EMPLOYEES[byline];
  const owned = state.tickets.filter((ticket) => ticket.owner === byline);
  const spent = owned.reduce((sum, ticket) => sum + costOf(state, ticket), 0);
  const metrics = employeeMetrics(state, byline);
  // What it noted in its own skill, newest first. The skill is version 1 when the employee is
  // hired; each note is its next version.
  const learned = state.learned
    .filter((note) => note.byline === byline)
    .map((note, k) => ({
      version: k + 2,
      title: titleOf(
        state.tickets.find((ticket) => ticket.id === note.ticket)!,
        W,
      ),
    }))
    .reverse();
  // The sessions it works in: on its own tickets, and on others' where it verifies.
  const sessions = liveSessions(state).flatMap((session) => {
    const ticket = state.tickets.find((candidate) => candidate.id === session.ticket);
    return session.by !== byline || ticket === undefined ? [] : [{ session, ticket }];
  });
  return (
    <li className="flex gap-3 py-4">
      <PersonAvatar byline={byline} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{person.name}</span>
          <span className={`text-sm ${QUIET}`}>{person.title}</span>
          {employee.reportsTo === null && <Pill>{W.team.standing}</Pill>}
          <span className={`ml-auto text-xs tabular-nums ${QUIET}`}>
            {W.team.usage(tokens(spent), money(spent))}
          </span>
        </div>
        <p className={`mt-0.5 flex flex-wrap gap-x-3 text-xs ${QUIET}`}>
          {employee.reportsTo !== null && (
            <span>{W.team.reportsTo(W.people[employee.reportsTo].name)}</span>
          )}
          <span>
            {metrics.accepted === 0
              ? W.team.noMetrics
              : W.team.metrics(
                  metrics.firstPass,
                  metrics.accepted,
                  metrics.sendBacks,
                  money(metrics.costPerAccepted),
                )}
          </span>
        </p>
        <p className="mt-1.5 text-sm text-fg">{person.duties}</p>
        <div className="mt-2 text-xs">
          {sessions.length === 0 ? (
            <p className={QUIET}>{W.team.idle}</p>
          ) : (
            <>
              <p className={QUIET}>{W.team.working}</p>
              <ul className="mt-1 space-y-1">
                {sessions.map(({ session, ticket }) => (
                  <li key={session.id} className="flex items-center gap-2 text-sm">
                    <SessionStatusPill status={sessionStatus(state, session)} />
                    <TitleButton
                      className="min-w-0 truncate"
                      onClick={() => onOpenSession(session.id)}
                    >
                      {titleOf(ticket, W)}
                    </TitleButton>
                    {session.role === "verify" && (
                      <span className={`shrink-0 text-xs ${QUIET}`}>{W.roles.verify}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {learned.length > 0 && (
          <div className="mt-2 text-xs">
            <p className={QUIET} data-tooltip={W.team.learnedInfo} data-tooltip-extra>
              {W.team.learnedTitle}
            </p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {learned.map(({ version, title }) => (
                <li key={version}>{W.team.learned(version, title)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </li>
  );
}
