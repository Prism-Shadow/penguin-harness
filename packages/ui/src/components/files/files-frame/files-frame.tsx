/**
 * The Files panel's frame, for any browser of files that reads and edits in place: the Workspace
 * Files panel and the organization handbook are both this. Three pieces, each the caller's to
 * place inside its own root (which carries its drop handlers and its dialogs):
 *
 * - `useFilesLayout` measures the root's own width — a dock may give the panel far less room than
 *   the window — and decides whether the tree and the preview share the row (files-layout.ts),
 *   with the tree pane's width within the bounds that width allows.
 * - `FilesToolbar` is the one header row: the way back to the tree while one column shows the
 *   preview, else the tree's show/hide toggle; the path of what is open, read out and not
 *   navigable (the tree beside it is what navigates), collapsing its leading segments into a
 *   "…" so the row never wraps; then whatever the open file offers (the Markdown reader's
 *   outline and find buttons among them). An open find bar takes the path's place; in one
 *   column, where the row has no room to spare, it takes a second line under the row instead,
 *   and the path stays. The toggle keeps a static
 *   accessible name with its state on `aria-pressed` alone: a name that swaps Show/Hide beside a
 *   pressed state says the state twice and disagrees with itself; the tooltip may still swap.
 * - `FilesPanes` lays the two out: wide, the tree and its divider slide in and out of the start
 *   edge (`SplitPane`) and the preview takes the room they leave; narrow, one column holds the
 *   tree or the preview. Anything the caller draws over both (drop feedback) is its children.
 *
 * The caller keeps the state — whether the tree is shown, the width the divider was dragged to,
 * and their persistence — and the words; the frame draws them.
 */
import type { ReactNode, RefObject } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useMeasuredWidth } from "../../layout/measure/use-measured-width";
import { SplitPane } from "../../layout/resize-handle/split-pane";
import { Breadcrumbs } from "../../navigation/breadcrumbs/breadcrumbs";
import type { BreadcrumbItem } from "../../navigation/breadcrumbs/breadcrumbs";
import { Tooltip } from "../../overlays/tooltip/tooltip";
import {
  TREE_MIN_WIDTH,
  clampTreeWidth,
  defaultTreeWidth,
  isNarrowLayout,
  maxTreeWidth,
} from "./files-layout";

/** The square of a files browser's actions, in its toolbar and its panes' headers alike. */
const ACTION_BASE =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150";
const ACTION_IDLE = "text-fg-muted hover:bg-control-hover hover:text-fg";

/**
 * A files browser's icon action: a square the size of the tree toggle, so the toolbar's marks and
 * the panes' line up. A control with no visible text needs its name in two places to be readable
 * at all — its own `aria-label`, and the Tooltip it is wrapped in.
 */
export const filesActionClass = `${ACTION_BASE} ${ACTION_IDLE}`;

/** The same square as a toggle: pressed is a filled resting state, not a hover that happens to stick. */
export function filesToggleClass(on: boolean): string {
  return `${ACTION_BASE} ${on ? "bg-control-selected text-fg" : ACTION_IDLE}`;
}

/** How a files browser lays out at its measured width. */
export interface FilesLayout {
  /** The root's width in px; 0 until measured. */
  width: number;
  /** Too narrow for the tree beside the preview: one column holds one of them. */
  narrow: boolean;
  /** The tree pane's width on a wide frame: the dragged one, else the default, within bounds. */
  treeWidth: number;
  /** The widest the divider may take the tree at this width. */
  maxTreeWidth: number;
  /** A dragged width brought within this width's bounds. */
  clamp: (px: number) => number;
}

/** Measures `ref` and lays a files browser out at its width, with the tree at `preferredTreeWidth` when it was ever dragged. */
export function useFilesLayout(
  ref: RefObject<HTMLElement | null>,
  preferredTreeWidth: number | null,
): FilesLayout {
  const width = useMeasuredWidth(ref);
  const treeWidth = clampTreeWidth(preferredTreeWidth ?? defaultTreeWidth(width), width);
  return {
    width,
    narrow: isNarrowLayout(width),
    treeWidth,
    // Before the first measurement there is no ceiling yet (clampTreeWidth applies none), so the
    // current width is the honest maximum for that frame.
    maxTreeWidth: Math.max(maxTreeWidth(width), treeWidth),
    clamp: (px) => clampTreeWidth(px, width),
  };
}

export interface FilesToolbarProps {
  layout: FilesLayout;
  /** One column showing the preview: the way back to the tree stands where the toggle would. */
  previewShown: boolean;
  onBack: () => void;
  treeVisible: boolean;
  onTreeVisibleChange: (visible: boolean) => void;
  labels: {
    /** The way back to the tree in one column. */
    back: string;
    /** The tree toggle's name, and its tooltip while the tree is hidden. */
    showTree: string;
    /** The toggle's tooltip while the tree is shown. */
    hideTree: string;
  };
  /** The path of what is open, root first. */
  crumbs: readonly BreadcrumbItem[];
  /** The path's tooltip: the whole of it. */
  crumbTitle?: string;
  /** After the path: what the open file offers. */
  children?: ReactNode;
  /** An open find bar: drawn in the path's place, or under the row in one column. */
  find?: ReactNode;
}

export function FilesToolbar({
  layout,
  previewShown,
  onBack,
  treeVisible,
  onTreeVisibleChange,
  labels,
  crumbs,
  crumbTitle,
  children,
  find,
}: FilesToolbarProps) {
  const findOpen = find !== undefined && find !== null && find !== false;
  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex flex-nowrap items-center gap-1 px-2 py-1.5">
        {layout.narrow && previewShown && (
          <Tooltip label={labels.back} placement="bottom" className="shrink-0">
            <button
              type="button"
              aria-label={labels.back}
              onClick={onBack}
              className={filesActionClass}
            >
              <GlyphIcon d={ICONS.chevronLeft} size={ICON_SIZE.iconButton} />
            </button>
          </Tooltip>
        )}
        {!layout.narrow && (
          <button
            type="button"
            aria-pressed={treeVisible}
            data-tooltip={treeVisible ? labels.hideTree : labels.showTree}
            aria-label={labels.showTree}
            onClick={() => onTreeVisibleChange(!treeVisible)}
            className={filesToggleClass(treeVisible)}
          >
            <GlyphIcon d={ICONS.panelLeft} size={ICON_SIZE.iconButton} />
          </button>
        )}
        {/* `flex-1` over a zero basis, so the strip measures the room the actions leave it and
          never its own content. */}
        {findOpen && !layout.narrow ? (
          <div className="flex min-w-0 flex-1">{find}</div>
        ) : (
          <Breadcrumbs className="flex-1" items={crumbs} title={crumbTitle} />
        )}
        {children}
      </div>
      {findOpen && layout.narrow && <div className="flex px-2 pb-1.5">{find}</div>}
    </div>
  );
}

export interface FilesPanesProps {
  layout: FilesLayout;
  /** One column: the tree is what it shows (no file is open). */
  treeAlone: boolean;
  treeVisible: boolean;
  tree: ReactNode;
  preview: ReactNode;
  /** The divider's accessible name and tooltip. */
  dividerLabel: string;
  /** A width during a drag or per arrow key, already within bounds. */
  onTreeWidthChange: (px: number) => void;
  /** The width to keep once a drag or a key is done with, already within bounds. */
  onTreeWidthCommit?: (px: number) => void;
  /** Drawn over both panes: drop feedback. */
  children?: ReactNode;
}

export function FilesPanes({
  layout,
  treeAlone,
  treeVisible,
  tree,
  preview,
  dividerLabel,
  onTreeWidthChange,
  onTreeWidthCommit,
  children,
}: FilesPanesProps) {
  return (
    <div className="relative flex min-h-0 flex-1">
      {layout.narrow ? (
        treeAlone ? (
          tree
        ) : (
          preview
        )
      ) : (
        <SplitPane
          className="min-w-0 flex-1"
          size={layout.treeWidth}
          min={TREE_MIN_WIDTH}
          max={layout.maxTreeWidth}
          label={dividerLabel}
          collapsed={!treeVisible}
          onResize={(px) => onTreeWidthChange(layout.clamp(px))}
          // Once per drag or key press, not per frame.
          onResizeEnd={(px) => onTreeWidthCommit?.(layout.clamp(px))}
          first={tree}
          second={preview}
        />
      )}
      {children}
    </div>
  );
}
