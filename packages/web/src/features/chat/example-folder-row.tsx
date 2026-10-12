/**
 * The header row of one start-page example folder, and the grid the folders and their rows
 * share.
 *
 * A tab, not a disclosure: the open folder stays open (clicking it is a no-op) and carries the
 * block's whole body, so exactly one folder's rows are ever on screen. It lives in its own module
 * because two callers render it — the built-in folders in start-dashboard.tsx and the user's own
 * shortcuts folder in shortcuts-folder.tsx — and a folder row that reads differently from its
 * neighbours would be read as a different kind of thing.
 *
 * The block is one grid. In a column wide enough (the `@md` container query) the folder rows go
 * down the first column and the open folder's panel takes the second, spanning every folder row,
 * so the block's height is the folder column's and switching folders moves nothing; the panel
 * is placed by grid line rather than by DOM order, so the DOM keeps the panel right after its
 * folder's row, which is the order a phone shows it in — one column, the panel under the row,
 * as an accordion — and the order a screen reader walks.
 */
import { Chevron, GlyphIcon, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";

/** The examples block: one column on a phone, the folder column and the panel column beside. */
export const exampleGridClass =
  "grid grid-cols-1 gap-x-4 gap-y-1 @md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]";

/**
 * The open folder's panel: indented under its row on a phone; in the second column beside the
 * folders otherwise, ruled off from them. It spans the five folder rows — the four built-in
 * folders and the shortcuts folder — which keeps the folder rows their own height whatever the
 * panel holds.
 */
export const examplePanelClass =
  "mt-0.5 mb-1 pl-6 @md:[grid-row:1/span_5] @md:col-start-2 @md:my-0 @md:border-l @md:border-line-muted @md:pl-3";

export function ExampleFolderRow({
  open,
  glyph,
  label,
  count,
  onOpen,
}: {
  open: boolean;
  /** The folder's own mark, a registry glyph — what the eye scans to pick a category. */
  glyph: string;
  label: string;
  /** Rows inside the folder, shown right of the name — a bare count, or `used/limit` where one applies. */
  count: number | string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onOpen}
      className={`flex w-full items-center ${ICON_GAP.menu} rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 @md:col-start-1 ${
        open ? "bg-surface-muted text-fg" : "text-fg-muted hover:bg-surface-muted hover:text-fg"
      }`}
    >
      <span className="shrink-0 text-accent">
        <GlyphIcon d={glyph} size={ICON_SIZE.navRow} />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      <span className="shrink-0 text-xs text-fg-subtle">{count}</span>
      {/* The accordion's fold mark; beside the panel the filled row already says which is open. */}
      <Chevron open={open} size={ICON_SIZE.chevron} className="text-fg-subtle @md:hidden" />
    </button>
  );
}

/**
 * The class string of one row inside an open folder — an example, or a saved shortcut. Shared for
 * the same reason as the header: the two lists sit in the same block and must read as one list
 * shape. Layout (flex, width) is the caller's, since a shortcut row also carries its own actions.
 */
export const exampleRowClass =
  "rounded-md px-2 py-1.5 text-left text-sm text-fg-muted transition-colors duration-150 " +
  "hover:bg-surface-muted hover:text-fg disabled:cursor-default disabled:opacity-60 " +
  "disabled:hover:bg-transparent";
