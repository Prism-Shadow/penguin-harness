/**
 * Drag-and-drop file upload logic (#311), kept DOM-free so it can be unit-tested.
 *
 * Dropping files onto the window is a third entry point into the composer's existing
 * attachment intake (after the "+" menu pickers and image paste); everything here is about
 * deciding, not doing:
 *   - which drags count as file drags at all (`isFileDrag`) — text selections, in-app drags
 *     such as the sidebar's session reorder (a custom MIME for exactly this reason) and
 *     dragged page images must never light the overlay;
 *   - whether a drag is currently over the window (`nextDragDepth`) — dragenter/dragleave
 *     fire for every element boundary crossed, so a plain boolean flickers off on each
 *     internal crossing; the classic fix is a depth counter that only reaches 0 when the
 *     drag genuinely left the window (or ended);
 *   - which staged intake a dropped file belongs to (`splitDroppedFiles`) — images join the
 *     pasted-image pipeline, everything else joins the file-attachment pipeline;
 *   - the app-shell fallback (`guardWindowDragOver` / `guardWindowDrop`) — anywhere no drop
 *     zone claimed the drag, the browser's default is to navigate to the dropped file,
 *     silently replacing the app; the guard cancels that default for file drags only, so
 *     native text drag-and-drop (e.g. dropping selected text into the composer) keeps
 *     working.
 */

/**
 * True when a drag carries OS files: `DataTransfer.types` contains `"Files"`. Every other
 * drag — text selections (`text/plain`), links, dragged `<img>` elements (`text/uri-list`),
 * the sidebar's session reorder MIME — lacks it and must be left to its native behavior.
 * Accepts null/undefined because `dataTransfer` is nullable on the DOM event type.
 */
export function isFileDrag(types: readonly string[] | null | undefined): boolean {
  return types !== null && types !== undefined && types.includes("Files");
}

/** Drag lifecycle moments the depth counter reacts to (window-level listeners feed these). */
export type DragDepthEvent = "enter" | "leave" | "drop" | "end";

/**
 * Advances the window drag depth: the overlay shows while depth > 0.
 *
 * Only file drags count — a non-file drag must not budge the counter in either direction,
 * or a text selection dragged across the page would strand the counter off balance. `drop`
 * and `end` reset outright rather than decrementing: they end the whole drag, and an
 * unconditional reset is also what recovers from a missed dragleave (browsers drop one
 * occasionally, e.g. when the OS steals the pointer), so no stale overlay can outlive its
 * drag. The clamp at 0 makes an unpaired leave harmless instead of driving the depth
 * negative, where the next enter would fail to show the overlay.
 */
export function nextDragDepth(depth: number, event: DragDepthEvent, fileDrag: boolean): number {
  switch (event) {
    case "enter":
      return fileDrag ? depth + 1 : depth;
    case "leave":
      return fileDrag ? Math.max(0, depth - 1) : depth;
    case "drop":
    case "end":
      return 0;
  }
}

/**
 * Splits one dropped batch into the composer's two intakes, preserving drop order within
 * each: images ride the message as `image_url` parts exactly like pasted images, everything
 * else becomes a file attachment (scratchpad + `[attached file: <path>]` line). Generic over
 * "has a MIME type" so tests don't need a DOM `File`.
 */
export function splitDroppedFiles<T extends { readonly type: string }>(
  dropped: readonly T[],
): { images: T[]; files: T[] } {
  const images: T[] = [];
  const files: T[] = [];
  for (const item of dropped) {
    (item.type.startsWith("image/") ? images : files).push(item);
  }
  return { images, files };
}

/**
 * The slice of a DragEvent the guards read/write — structural, so DOM `DragEvent` satisfies
 * it and tests can pass plain objects (the vitest environment has no DOM).
 */
export interface DragGuardEvent {
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  readonly dataTransfer: {
    readonly types: readonly string[];
    dropEffect: string;
  } | null;
}

/**
 * Window-level dragover fallback for the whole app shell. Runs after any React drop-zone
 * handler (window listeners fire last on the bubble path), so `defaultPrevented` is exactly
 * "some zone claimed this drag": when none did, cancel the default and show the no-drop
 * cursor — an honest "dropping here does nothing" instead of the browser's copy cursor over
 * a page that would navigate away. Non-file drags pass through untouched (see isFileDrag).
 */
export function guardWindowDragOver(e: DragGuardEvent): void {
  if (e.defaultPrevented || !isFileDrag(e.dataTransfer?.types)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
}

/**
 * Window-level drop fallback, paired with guardWindowDragOver: cancels the browser's
 * default open-file navigation for any file drop no drop zone claimed. Text/link drops keep
 * their native behavior (dropping text into the composer textarea must still insert it).
 */
export function guardWindowDrop(e: DragGuardEvent): void {
  if (e.defaultPrevented || !isFileDrag(e.dataTransfer?.types)) return;
  e.preventDefault();
}
