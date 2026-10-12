/**
 * The card at the foot of a Task that lists the files it touched — the files its reply names,
 * the memories it wrote — one row per file (visual reference: Codex's "files changed" card).
 *
 * A header strip names the rows, counted, beside the card's glyph, with room for one text action
 * at its end (open the list the rows come from). Each row leads with a glyph, shows the path with
 * its directory faded and its name in bold, and may end with a mark for what happened to the file
 * (written, edited). A row that opens something is a button whose right end says in words what a
 * click does — a trailing chevron would read as expand — and a row with nothing to open is plain
 * text. Past `foldAt` rows the card folds, behind a row that unfolds it; the rows past the fold
 * open and close through `Fold`, under the theme's layout motion, so they arrive the way every
 * other disclosure body in the transcript does rather than in one frame.
 *
 * The card is a transcript card, so it carries the `ui-frame` hook with its header as the `head`
 * slot and the rows as the `body`: a theme draws it the way it draws a tool call's card.
 */
import { useState } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { Chevron } from "../../icons/chevron/chevron";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { Fold } from "../../layout/fold/fold";
import { namedHint } from "../../overlays/tooltip/tooltip";

/**
 * A path split in two: the directory faded, the file name in bold. The directory has
 * `shrink-[9999]` and gives way first, the name truncates only after it — both can truncate, so
 * the row never overflows its container on a narrow panel.
 */
export function PathLabel({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return (
    <span className="flex min-w-0 items-baseline font-mono text-sm">
      {dir && <span className="min-w-0 shrink-[9999] truncate text-fg-subtle">{dir}</span>}
      <span className="min-w-0 truncate font-semibold text-fg">{name}</span>
    </span>
  );
}

export interface ChangesCardRow {
  /** Unique within the card. */
  id: string;
  /** The file's path, relative to where the reader knows it from. */
  path: string;
  /** The row's leading glyph, a 24×24 line path. */
  glyph: string;
  /**
   * What the leading glyph says when it says more than "a file" (a memory's scope): its tooltip
   * and its screen-reader text.
   */
  glyphLabel?: string;
  /** A mark at the row's end for what happened to the file, named by its label. */
  mark?: { glyph: string; label: string };
  /** A row that opens: its tooltip — its full path, or what a click on it does. */
  tooltip?: string;
  /** Opens the row's file; a row without it is plain text. */
  onOpen?: () => void;
}

export interface ChangesCardProps {
  /** The header's glyph, a 24×24 line path. */
  glyph: string;
  /** What the rows are, counted ("3 files"). */
  title: string;
  /** A text action at the header's end. */
  action?: { label: string; onClick: () => void };
  rows: readonly ChangesCardRow[];
  /** What a click on a row does, in the words the row shows at its end ("Preview"). */
  openHint: string;
  /** The fold row's words while rows are folded away, given how many. */
  showMore: (hidden: number) => string;
  /** The fold row's words once the card is unfolded. */
  showLess: string;
  /** How many rows show while the card is folded. */
  foldAt?: number;
}

/** A file row's box, and the hover fill of a row that opens. */
const ROW = "flex w-full items-center gap-2 px-3 py-2 text-left";
const ROW_HOVER = "transition-colors duration-150 hover:bg-surface-muted";

export function ChangesCard({
  glyph,
  title,
  action,
  rows,
  openHint,
  showMore,
  showLess,
  foldAt = 3,
}: ChangesCardProps) {
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return null;

  const shown = rows.slice(0, foldAt);
  const folded = rows.slice(foldAt);

  const rowInner = (row: ChangesCardRow) => (
    <>
      {row.glyphLabel !== undefined ? (
        <span data-tooltip={row.glyphLabel} className="shrink-0 text-fg-subtle">
          <GlyphIcon d={row.glyph} size={ICON_SIZE.rowLead} />
          <span className="sr-only">{row.glyphLabel}</span>
        </span>
      ) : (
        <GlyphIcon d={row.glyph} size={ICON_SIZE.rowLead} className="shrink-0 text-fg-subtle" />
      )}
      <PathLabel path={row.path} />
      <span className="min-w-0 flex-1" />
      {row.mark !== undefined && (
        <span {...namedHint(row.mark.label)} className="shrink-0 text-fg-subtle">
          <GlyphIcon d={row.mark.glyph} size={ICON_SIZE.inlineGlyph} />
        </span>
      )}
    </>
  );

  const fileRow = (row: ChangesCardRow) =>
    row.onOpen !== undefined ? (
      <button
        key={row.id}
        type="button"
        data-tooltip={row.tooltip}
        onClick={row.onOpen}
        className={`group ${ROW} ${ROW_HOVER} cursor-pointer`}
      >
        {rowInner(row)}
        {/* A span, not a nested button: the row itself is the button. */}
        <span
          aria-hidden
          className="shrink-0 text-xs text-fg-subtle transition-colors duration-150 group-hover:text-fg-muted"
        >
          {openHint}
        </span>
      </button>
    ) : (
      <div key={row.id} className={ROW}>
        {rowInner(row)}
      </div>
    );

  return (
    <div className="ui-frame anim-msg my-3 overflow-hidden rounded-xl border border-line bg-surface">
      <div
        data-slot="head"
        className="flex items-center gap-2 border-b border-line-muted bg-surface-muted px-3 py-2"
      >
        <GlyphIcon d={glyph} size={ICON_SIZE.rowLead} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {action !== undefined && (
          <button
            type="button"
            onClick={action.onClick}
            className="shrink-0 cursor-pointer text-xs text-fg-subtle transition-colors duration-150 hover:text-fg-muted"
          >
            {action.label}
          </button>
        )}
      </div>
      <div data-slot="body" className="divide-y divide-line-muted">
        {shown.map(fileRow)}
        {folded.length > 0 && (
          <>
            {/* The fold's track is one child of the ruled list, so the list rules it off from
                the rows above and the fold row below; the rows inside rule themselves. */}
            <Fold open={expanded} bodyClassName="divide-y divide-line-muted">
              {() => folded.map(fileRow)}
            </Fold>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-fg-muted ${ROW_HOVER}`}
            >
              {expanded ? showLess : showMore(folded.length)}
              <Chevron open={expanded} className="text-fg-subtle" size={ICON_SIZE.chevronDense} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
