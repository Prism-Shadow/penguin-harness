/**
 * The two panes of an impl branch's diff view: the changed-files tree (files under their
 * directory, each with its status and counts, a click jumps to it) and one file's block (a header
 * that folds it, then its hunks through the shared DiffViewer, or the note that stands in for
 * them). Both draw from props alone; proposal-diff.tsx holds the state.
 */
import type { ProposalImplChangedFile, ProposalImplChanges } from "@prismshadow/penguin-server/api";
import {
  Chevron,
  DiffViewer,
  ICON_GAP,
  ICON_SIZE,
  languageForFileName,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  baseName,
  fileNote,
  patchOf,
  type DiffLayout,
  type DirectoryGroup,
  type FileNote,
} from "./proposal-diff-model";

/** The status as one letter: the word is the accessible name, the letter what fits a row. */
const STATUS_MARK: Record<ProposalImplChangedFile["status"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
};

function StatusMark({ status }: { status: ProposalImplChangedFile["status"] }) {
  const word = S.company.proposals.implDiff.status[status];
  return (
    <span
      className="w-3 shrink-0 text-center font-mono text-gray-500 dark:text-gray-400"
      data-tooltip={word}
    >
      <span aria-hidden>{STATUS_MARK[status]}</span>
      <span className="sr-only">{word}</span>
    </span>
  );
}

/** `+N −M`, in the inks `+N/−M` uses on the impl section. */
export function Counts({
  file,
}: {
  file: Pick<ProposalImplChangedFile, "additions" | "deletions">;
}) {
  return (
    <span className={`flex shrink-0 font-mono tabular-nums ${ICON_GAP.tight}`}>
      <span className={toneInk.success}>+{file.additions}</span>
      <span className={toneInk.danger}>−{file.deletions}</span>
    </span>
  );
}

/** The changed-files tree: a heading per directory, its files under it; a file is a jump. */
export function DiffTree({
  groups,
  onJump,
}: {
  groups: readonly DirectoryGroup[];
  onJump: (path: string) => void;
}) {
  const t = S.company.proposals.implDiff;
  return (
    <ul className="space-y-2">
      {groups.map((group) => (
        <li key={group.dir}>
          <div
            className="truncate font-mono text-gray-500 dark:text-gray-400"
            data-tooltip={group.dir === "" ? t.rootDir : group.dir}
          >
            {group.dir === "" ? t.rootDir : `${group.dir}/`}
          </div>
          <ul>
            {group.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onJump(file.path)}
                  className={`flex w-full items-center rounded px-1 py-0.5 text-left transition-[background-color] hover:bg-gray-100 dark:hover:bg-gray-800 ${ICON_GAP.row}`}
                >
                  <StatusMark status={file.status} />
                  <span className="min-w-0 flex-1 truncate font-mono" data-tooltip={file.path}>
                    {baseName(file.path)}
                  </span>
                  <Counts file={file} />
                </button>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function noteText(note: FileNote): string {
  const t = S.company.proposals.implDiff;
  switch (note.kind) {
    case "binary":
      return t.binary;
    case "tooLarge":
      return t.tooLarge(note.kib);
    case "diffLimit":
      return t.diffLimit(note.mib);
    case "noPatch":
      return t.noPatch;
    case "noContent":
      return t.noContent;
  }
}

/** One file: a header that folds it, then its hunks or the note in their place. */
export function DiffFileBlock({
  file,
  anchorId,
  open,
  layout,
  limits,
  onToggle,
}: {
  file: ProposalImplChangedFile;
  anchorId: string;
  open: boolean;
  layout: DiffLayout;
  limits: ProposalImplChanges["limits"];
  onToggle: () => void;
}) {
  const t = S.company.proposals.implDiff;
  const note = fileNote(file, limits);
  const bodyId = `${anchorId}-body`;
  return (
    <section id={anchorId} aria-label={file.path} className="scroll-mt-2 space-y-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className={`flex w-full items-center text-left ${ICON_GAP.row}`}
      >
        <Chevron open={open} size={ICON_SIZE.chevron} className="text-gray-400" />
        <StatusMark status={file.status} />
        <span className="min-w-0 truncate font-mono font-medium" data-tooltip={file.path}>
          {file.path}
        </span>
        {file.oldPath !== null && (
          <span className="min-w-0 shrink truncate text-gray-400 dark:text-gray-500">
            {t.renamedFrom(file.oldPath)}
          </span>
        )}
        <span className="ml-auto" />
        <Counts file={file} />
      </button>
      <div id={bodyId} hidden={!open}>
        {open &&
          (note !== null ? (
            <p className="py-1 text-gray-500 dark:text-gray-400">{noteText(note)}</p>
          ) : (
            <DiffViewer
              patch={patchOf(file.hunks)}
              mode={layout}
              language={languageForFileName(baseName(file.path))}
              label={`${t.title}: ${file.path}`}
            />
          ))}
      </div>
    </section>
  );
}
