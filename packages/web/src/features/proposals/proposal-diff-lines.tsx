/**
 * One file's hunks with lines a reader can comment on: a click on a line number selects that
 * line, a Shift-click on another extends the selection to it, and a drag across the code selects
 * the lines it covers. A selection offers "Comment on these lines"; the comment records the side,
 * the first and last line, and the commits the diff was read at.
 *
 * The viewer (the shared DiffViewer) knows nothing of comments: every row carries its line
 * numbers as data attributes, and this wrapper reads them off the click or the text selection
 * (proposal-comment-targets.ts `lineEndOf`, `lineRangeOf`). Outside the page's comments provider
 * the lines are not selectable.
 */
import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { ProposalImplChangedFile } from "@prismshadow/penguin-server/api";
import {
  Button,
  DiffViewer,
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  languageForFileName,
  toastError,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { CommentComposer } from "./proposal-comment-line";
import {
  lineEndOf,
  lineRangeOf,
  type DiffCommits,
  type LineEnd,
  type LineRange,
} from "./proposal-comment-targets";
import { baseName, patchOf, type DiffLayout } from "./proposal-diff-model";
import { useProposalComments } from "./proposal-target-comments";

/** The text of a range's lines in a file's hunks: what the composer quotes. */
export function rangeText(file: Pick<ProposalImplChangedFile, "hunks">, range: LineRange): string {
  const out: string[] = [];
  for (const h of file.hunks) {
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const l of h.lines) {
      const n =
        range.side === "old" ? (l.kind === "add" ? null : oldNo) : l.kind === "del" ? null : newNo;
      if (n !== null && n >= range.start && n <= range.end) out.push(l.text);
      if (l.kind !== "add") oldNo += 1;
      if (l.kind !== "del") newNo += 1;
    }
  }
  return out.join("\n");
}

export function CommentableDiff({
  file,
  layout,
  commits,
}: {
  file: ProposalImplChangedFile;
  layout: DiffLayout;
  /** The commits the diff on screen was read at. */
  commits: DiffCommits;
}) {
  const ctx = useProposalComments();
  const t = S.company.proposals.targets;
  const rootRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<LineEnd | null>(null);
  const [range, setRange] = useState<LineRange | null>(null);
  const [composing, setComposing] = useState(false);
  const selectable = ctx !== null && !ctx.closed;

  const select = (next: LineRange | null) => {
    setRange(next);
    setComposing(false);
  };

  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!selectable) return;
    const target = e.target as Element;
    if (target.closest("[data-gutter]") === null) return;
    const end = lineEndOf(target);
    if (end === null) return;
    if (e.shiftKey && anchor !== null) {
      const next = lineRangeOf(anchor, end);
      if (next === null) toastError(t.oneSide);
      else select(next);
      return;
    }
    setAnchor(end);
    select(lineRangeOf(end, end));
  };

  const onMouseUp = () => {
    if (!selectable) return;
    // The browser settles the selection after mouseup; read it once it has.
    window.setTimeout(() => {
      const sel = window.getSelection();
      const root = rootRef.current;
      if (sel === null || sel.isCollapsed || root === null) return;
      const elementOf = (n: Node | null) => (n instanceof Element ? n : (n?.parentElement ?? null));
      const a = elementOf(sel.anchorNode);
      const b = elementOf(sel.focusNode);
      if (a === null || b === null || !root.contains(a) || !root.contains(b)) return;
      const from = lineEndOf(a);
      const to = lineEndOf(b);
      if (from === null || to === null) return;
      const next = lineRangeOf(from, to);
      if (next === null) {
        toastError(t.oneSide);
        return;
      }
      setAnchor(from);
      select(next);
    }, 0);
  };

  const quote = range === null ? "" : rangeText(file, range);
  return (
    <div>
      {range !== null && selectable && !composing && (
        <div className={`mb-1 flex flex-wrap items-center ${ICON_GAP.menu}`}>
          <Button size="sm" variant="primary" onClick={() => setComposing(true)}>
            <GlyphIcon d={ICONS.messageSquare} size={ICON_SIZE.inlineGlyph} />
            <span className="ml-1">{t.commentLines}</span>
          </Button>
          <span className="font-mono text-gray-500 dark:text-gray-400">
            {t.lines(range.side, range.start, range.end)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => select(null)}>
            {t.clearSelection}
          </Button>
        </div>
      )}
      <div ref={rootRef} onClick={onClick} onMouseUp={onMouseUp}>
        <DiffViewer
          patch={patchOf(file.hunks)}
          mode={layout}
          language={languageForFileName(baseName(file.path))}
          label={`${S.company.proposals.implDiff.title}: ${file.path}`}
          selected={range}
          selectable={selectable}
        />
      </div>
      {composing && range !== null && ctx !== null && (
        <CommentComposer
          quote={quote}
          label={`${t.commentingOn} ${t.lines(range.side, range.start, range.end)}`}
          busy={ctx.busy}
          onCancel={() => setComposing(false)}
          onSubmit={async (text) => {
            const ok = await ctx.onTarget(
              { kind: "change-lines", path: file.path, ...range, ...commits },
              text,
            );
            if (ok) select(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}
