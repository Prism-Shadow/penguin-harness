/**
 * The App info dialog's release notes: every released version's lines, newest first, with only
 * the newest shown — the dialog is opened to see what this release brought, and the rest of the
 * history is one click away. The earlier versions sit behind a fold (the WAI-ARIA disclosure: a
 * real button with `aria-expanded` and `aria-controls`, the panel kept in the DOM and `hidden`
 * while folded). A running version older than the newest note (a dev build) is folded with the
 * rest, still carrying the current-version pill. The section's count is every version's.
 *
 * Stateless: the dialog owns the fold and starts it closed on every opening, and a test reads
 * both states from static markup.
 */
import { Badge, Chevron, ICON_GAP, ICON_SIZE, RuledSection } from "@prismshadow/penguin-ui";
import { formatYearMonthDay } from "../../lib/format";
import { noteLines, releaseNotesNewestFirst } from "../../lib/release-notes";
import type { ReleaseNote } from "../../lib/release-notes";
import { S } from "../../lib/strings";

export function ReleaseNotesList({
  notes,
  currentVersion,
  locale,
  expanded,
  onToggle,
  panelId,
}: {
  /** The notes in any order; the bundled ones when omitted. */
  notes?: readonly ReleaseNote[];
  /** The running version, whose entry is marked. */
  currentVersion: string | null;
  locale: "zh" | "en";
  /** The earlier versions are unfolded. */
  expanded: boolean;
  onToggle: () => void;
  /** The folded panel's id, which the fold's `aria-controls` names. */
  panelId: string;
}) {
  const sorted = releaseNotesNewestFirst(notes);
  const [newest, ...earlier] = sorted;
  const item = (note: ReleaseNote) => (
    <NoteItem
      key={note.version}
      note={note}
      current={note.version === currentVersion}
      locale={locale}
    />
  );
  return (
    <RuledSection level={3} title={S.appInfo.releaseNotes} count={sorted.length}>
      {newest !== undefined && <ol>{item(newest)}</ol>}
      {earlier.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
            className={`mt-4 flex items-center ${ICON_GAP.row} text-sm text-fg-muted transition-colors duration-150 hover:text-fg`}
          >
            <Chevron open={expanded} size={ICON_SIZE.chevron} />
            {S.appInfo.earlierVersions(earlier.length)}
          </button>
          <ol id={panelId} hidden={!expanded} className="mt-3 divide-y divide-line-muted">
            {earlier.map(item)}
          </ol>
        </>
      )}
    </RuledSection>
  );
}

/** One version: its number (and the current-version pill), its date, and its lines. */
function NoteItem({
  note,
  current,
  locale,
}: {
  note: ReleaseNote;
  current: boolean;
  locale: "zh" | "en";
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className={`flex items-center ${ICON_GAP.row} text-sm font-medium`}>
          {`v${note.version}`}
          {current && (
            <Badge tone="neutral" variant="soft" size="sm">
              {S.appInfo.current}
            </Badge>
          )}
        </h4>
        <span className="shrink-0 text-xs text-fg-subtle">
          {formatYearMonthDay(note.date, locale)}
        </span>
      </div>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-fg-muted">
        {noteLines(note, locale).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </li>
  );
}
