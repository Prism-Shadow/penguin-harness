/**
 * The Files panel's layout, as numbers (node-testable): when a browser of files is too narrow for
 * a tree beside a preview, and how wide its tree pane may be dragged when it is not. The Workspace
 * Files panel and the organization handbook both lay out by these, measured on their own width
 * rather than the viewport's, since a panel in a dock may have far less room than the window.
 */

/** Below this panel width the tree and the preview no longer fit side by side. */
export const TREE_LAYOUT_MIN_WIDTH = 480;

/**
 * Whether the panel falls back to the single-column drill-down (tree or preview, never
 * both). An unmeasured width (0, before the first ResizeObserver callback) keeps the
 * two-pane default rather than flashing the fallback for a frame.
 */
export function isNarrowLayout(panelWidth: number): boolean {
  return panelWidth > 0 && panelWidth < TREE_LAYOUT_MIN_WIDTH;
}

/** Narrowest the tree pane may be dragged: below this a nested name is all ellipsis. */
export const TREE_MIN_WIDTH = 160;

/** Room the preview keeps whatever the tree is dragged to. */
export const PREVIEW_MIN_WIDTH = 240;

/**
 * The tree pane's width until the user drags the divider: about a third of the panel,
 * within bounds that keep names readable and leave the preview its room.
 */
export function defaultTreeWidth(panelWidth: number): number {
  return Math.max(168, Math.min(256, Math.round(panelWidth * 0.36)));
}

/** Widest the tree pane may be dragged at this panel width — never below the tree's own minimum, so a panel with no room for both still has a draggable range of zero rather than an inverted one. */
export function maxTreeWidth(panelWidth: number): number {
  return Math.max(TREE_MIN_WIDTH, panelWidth - PREVIEW_MIN_WIDTH);
}

/**
 * A tree-pane width brought within this panel's bounds. An unmeasured panel (0, before the
 * first ResizeObserver callback) has no ceiling to apply: clamping against it would size
 * the pane to the minimum for one frame and then jump.
 */
export function clampTreeWidth(width: number, panelWidth: number): number {
  const requested = Math.max(TREE_MIN_WIDTH, Math.round(Number.isFinite(width) ? width : 0));
  return panelWidth <= 0 ? requested : Math.min(maxTreeWidth(panelWidth), requested);
}
