/**
 * The handbook: the company's memory, the files under the organization's handbook/. It is listed
 * by what each file is (the index, decisions, lessons, skills, documents) rather than as a bare
 * tree, so a reader sees what the company has learned: a decision is an answer the reader gave,
 * a lesson a delivery the reader sent back, a skill what the lead distilled from lessons and the
 * reader accepted, now installed for an employee, a retrospective the lead's look back over a
 * batch of closed tickets. Every file names the ticket it came from, and that ticket names the
 * file. A lesson a skill has absorbed stays listed, marked, but is out of the index employees
 * read: the handbook grows by what is new and shrinks by what a skill now carries.
 *
 * The shipped handbook page is the Workspace Files panel over the same directory, and it stays:
 * this is the reading of it the spec adds, not a second editor.
 */
import { PageFrame, PageHeader, Pill } from "@prismshadow/penguin-ui";
import { TitleButton } from "../../../web/src/features/company/shared";
import { FIXTURES } from "./fixtures";
import { metricsOf, windowOf } from "./model";
import type { CompanyState, HandbookEntry, HandbookKind } from "./model";
import { PersonName } from "./people";
import { optionsOf, questionOf, returnOf, titleOf } from "./text";
import { money } from "./ticket-dialog";
import { useWords } from "./use-words";
import type { Words } from "./words";

const QUIET = "text-fg-muted";

/** The groups, in the order the index names them. */
const GROUPS: readonly HandbookKind[] = ["index", "retro", "decision", "lesson", "skill", "doc"];

/** An entry's title and its paragraphs: a fixed document's words, or written from its ticket. */
export function entryWords(
  entry: HandbookEntry,
  state: CompanyState,
  W: Words,
): { title: string; body: string[] } {
  if (entry.kind === "retro") return retroWords(entry.retro ?? 0, state, W);
  if (entry.doc !== null) {
    const doc = W.handbook.docs[entry.doc];
    return { title: doc.title, body: [...doc.body] };
  }
  const ticket = state.tickets.find((candidate) => candidate.id === entry.ticket);
  if (ticket === undefined) return { title: entry.path, body: [] };
  if (entry.kind === "decision") {
    const label = ticket.answer === null ? "" : (optionsOf(ticket, W)[ticket.answer]?.label ?? "");
    return {
      title: questionOf(ticket, W),
      body: [W.handbook.decisionBody(label), ticket.answerNote].filter((line) => line !== ""),
    };
  }
  const note = ticket.returns[entry.returnIndex ?? 0] ?? "";
  return {
    title: W.handbook.lessonTitle(titleOf(ticket, W)),
    body: [returnOf(ticket, note, W), W.handbook.lessonAfter],
  };
}

/**
 * A retrospective, written from the tickets it looked back over: what they say, against the last
 * one; what became of the employee a skill it proposed was installed for; and what it proposes now.
 */
function retroWords(n: number, state: CompanyState, W: Words): { title: string; body: string[] } {
  const H = W.handbook;
  const retro = state.retros.find((candidate) => candidate.n === n);
  if (retro === undefined) return { title: "", body: [] };
  const now = metricsOf(state, windowOf(state, retro));
  const body = [
    H.retroLine(
      now.closed,
      now.accepted,
      now.firstPass,
      now.sendBacks,
      now.questions,
      money(now.costPerAccepted),
    ),
  ];
  const last = state.retros.find((candidate) => candidate.n === n - 1);
  if (last === undefined) {
    body.push(H.retroBaseline);
  } else {
    const before = metricsOf(state, windowOf(state, last));
    body.push(
      H.retroBefore(
        before.firstPass,
        before.accepted,
        before.sendBacks,
        money(before.costPerAccepted),
      ),
    );
    // What the last one's accepted skills did: the tickets their employee closed in this window.
    for (const id of last.proposals) {
      const ticket = state.tickets.find((candidate) => candidate.id === id);
      const on = ticket?.fixture == null ? undefined : FIXTURES[ticket.fixture].installsOn;
      if (ticket === undefined || ticket.status !== "done" || on === undefined) continue;
      const theirs = metricsOf(
        state,
        windowOf(state, retro).filter(
          (closed) => state.tickets.find((candidate) => candidate.id === closed)?.owner === on,
        ),
      );
      body.push(
        H.retroEffect(titleOf(ticket, W), W.people[on].name, theirs.closed, theirs.sendBacks),
      );
    }
  }
  const proposed = retro.proposals.flatMap((id) => {
    const ticket = state.tickets.find((candidate) => candidate.id === id);
    return ticket === undefined ? [] : [H.quote(titleOf(ticket, W))];
  });
  body.push(proposed.length === 0 ? H.retroNothing : H.retroProposals(proposed.join(H.join)));
  return { title: H.retroTitle(n, now.closed), body };
}

export function HandbookPage({
  state,
  selected,
  onSelect,
  onOpenTicket,
}: {
  state: CompanyState;
  /** The path of the file on show; the index when it names none. */
  selected: string | null;
  onSelect: (path: string) => void;
  onOpenTicket: (id: string) => void;
}) {
  const W = useWords();
  const shown =
    state.handbook.find((entry) => entry.path === selected) ??
    state.handbook.find((entry) => entry.kind === "index");
  return (
    <PageFrame width="xl">
      <PageHeader title={W.handbook.title} info={W.handbook.info} />
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={W.handbook.title} className="space-y-4">
          {GROUPS.map((kind) => {
            const entries = state.handbook.filter((entry) => entry.kind === kind);
            return (
              <div key={kind}>
                <p className={`mb-1 text-xs font-semibold ${QUIET}`}>
                  {W.handbook.groups[kind]}
                  <span className="ml-1.5 font-normal tabular-nums">{entries.length}</span>
                </p>
                {entries.length === 0 ? (
                  <p className="text-xs text-fg-subtle">{W.handbook.empty}</p>
                ) : (
                  <ul className="space-y-1">
                    {entries.map((entry) => (
                      <li key={entry.path}>
                        <TitleButton
                          className={`block max-w-full truncate text-left text-sm ${
                            entry === shown ? "font-semibold" : ""
                          } ${entry.mergedInto !== undefined ? "text-fg-subtle" : ""}`}
                          onClick={() => onSelect(entry.path)}
                        >
                          {entryWords(entry, state, W).title}
                        </TitleButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>
        {shown !== undefined && <Entry entry={shown} state={state} onOpenTicket={onOpenTicket} />}
      </div>
    </PageFrame>
  );
}

function Entry({
  entry,
  state,
  onOpenTicket,
}: {
  entry: HandbookEntry;
  state: CompanyState;
  onOpenTicket: (id: string) => void;
}) {
  const W = useWords();
  const words = entryWords(entry, state, W);
  const ticket = state.tickets.find((candidate) => candidate.id === entry.ticket);
  return (
    <article className="min-w-0">
      <p className={`font-mono text-xs ${QUIET}`}>handbook/{entry.path}</p>
      <h2 className="mt-1 text-lg font-semibold">{words.title}</h2>
      {(ticket !== undefined ||
        entry.installedOn !== undefined ||
        entry.mergedInto !== undefined) && (
        <p className={`mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${QUIET}`}>
          {ticket !== undefined && (
            <span className="flex min-w-0 items-center gap-1.5">
              {W.handbook.from}
              <TitleButton className="min-w-0 truncate" onClick={() => onOpenTicket(ticket.id)}>
                {titleOf(ticket, W)}
              </TitleButton>
            </span>
          )}
          {entry.installedOn !== undefined && (
            <span>
              {W.handbook.installedOn} <PersonName byline={entry.installedOn} /> ·{" "}
              {W.handbook.version(1)}
            </span>
          )}
          {entry.mergedInto !== undefined && <Pill>{W.handbook.merged}</Pill>}
        </p>
      )}
      {entry.mergedInto !== undefined && (
        <p className={`mt-2 text-xs ${QUIET}`}>{W.handbook.mergedNote}</p>
      )}
      <div className="mt-4 space-y-2 text-sm leading-relaxed text-fg">
        {words.body.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </article>
  );
}
