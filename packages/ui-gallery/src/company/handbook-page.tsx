/**
 * The handbook: the company's memory, the files under the organization's handbook/. It is listed
 * by what each file is (the index, decisions, lessons, skills, documents) rather than as a bare
 * tree, so a reader sees what the company has learned: a decision is an answer the reader gave,
 * a lesson a delivery the reader sent back, a skill what the lead distilled from lessons and the
 * reader accepted, now installed for an employee. Every file names the ticket it came from, and
 * that ticket names the file.
 *
 * The shipped handbook page is the Workspace Files panel over the same directory, and it stays:
 * this is the reading of it the spec adds, not a second editor.
 */
import { PageFrame, PageHeader } from "@prismshadow/penguin-ui";
import { TitleButton } from "../../../web/src/features/company/shared";
import type { CompanyState, HandbookEntry, HandbookKind } from "./model";
import { PersonName } from "./people";
import { optionsOf, questionOf, returnOf, titleOf } from "./text";
import { useWords } from "./use-words";
import type { Words } from "./words";

const QUIET = "text-fg-muted";

/** The groups, in the order the index names them. */
const GROUPS: readonly HandbookKind[] = ["index", "decision", "lesson", "skill", "doc"];

/** An entry's title and its paragraphs: a fixed document's words, or written from its ticket. */
export function entryWords(
  entry: HandbookEntry,
  state: CompanyState,
  W: Words,
): { title: string; body: string[] } {
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
                          }`}
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
      {(ticket !== undefined || entry.installedOn !== undefined) && (
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
              {W.handbook.installedOn} <PersonName byline={entry.installedOn} />
            </span>
          )}
        </p>
      )}
      <div className="mt-4 space-y-2 text-sm leading-relaxed text-fg">
        {words.body.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </article>
  );
}
