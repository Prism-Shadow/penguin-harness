/**
 * Drag-and-drop file upload logic (#311), kept DOM-free so it can be unit-tested.
 *
 * Dropping files onto the chat area is a third entry point into the composer's existing
 * attachment intake (after the "+" menu pickers and image paste); everything here is about
 * deciding, not doing:
 *   - which drags count as file drags at all (`isFileDrag`) — text selections, in-app drags
 *     such as the sidebar's session and group reorders (each a custom MIME for exactly this
 *     reason) and dragged page images must never light the overlay;
 *   - what the chat area's drop zone should do with one drag event (`dropRegionAction`) —
 *     show the overlay, claim the drag, take the files, or stand aside;
 *   - which staged intake a dropped file belongs to (`splitDroppedFiles`) — images join the
 *     pasted-image pipeline, everything else joins the file-attachment pipeline;
 *   - the app-shell fallback (`guardWindowDragOver` / `guardWindowDrop`) — anywhere no drop
 *     zone claimed the drag, the browser's default is to navigate to the dropped file,
 *     silently replacing the app; the guard cancels that default for file drags only, so
 *     native text drag-and-drop (e.g. dropping selected text into the composer) keeps
 *     working.
 *
 * The two halves are deliberately different in scope. The drop zone is confined to the chat
 * area: overlay, copy cursor and attachment happen only there. The guard is app-wide and
 * entirely silent — no overlay, no attachment, no toast — because the alternative to
 * cancelling the default is the browser navigating the tab to the dropped file and discarding
 * the running app along with any unsent draft. Outside the chat area the gesture is inert,
 * not destructive.
 */

/**
 * True when a drag carries OS files: `DataTransfer.types` contains `"Files"`. Every other
 * drag — text selections (`text/plain`), links, dragged `<img>` elements (`text/uri-list`),
 * the sidebar's session-reorder and group-reorder MIMEs — lacks it and must be left to its
 * native behavior.
 * Accepts null/undefined because `dataTransfer` is nullable on the DOM event type.
 */
export function isFileDrag(types: readonly string[] | null | undefined): boolean {
  return types !== null && types !== undefined && types.includes("Files");
}

/**
 * The drag lifecycle moments the chat area's drop zone listens for, on `window` so it sees
 * the drag wherever it goes:
 *   - `over`   — `dragover`, the authoritative signal. It fires continuously while a drag is
 *                anywhere over the page (per spec at least every 350ms) and names the element
 *                currently under the pointer, so it answers "is the drag over the chat area
 *                right now" outright, with no state to accumulate.
 *   - `leave`  — `dragleave`, needed for one case `over` cannot cover: once the drag leaves
 *                the window entirely, `dragover` simply stops firing, and without this the
 *                last "inside" answer would stand forever.
 *   - `drop`   — the release.
 *   - `end`    — `dragend`, which only fires for drags that STARTED in this page (an OS file
 *                drag ends with drop or dragleave instead); cheap insurance for in-page sources.
 */
export type DragSignal = "over" | "leave" | "drop" | "end";

/** What the chat area's drop zone should do about one drag event. */
export interface DropRegionAction {
  /** Whether the region overlay should be showing once this event has been handled. */
  readonly active: boolean;
  /** Claim the drag: `preventDefault` plus the copy cursor. Cancelling `dragover` is also what makes a later `drop` fire at all. */
  readonly claim: boolean;
  /** Hand this event's files to the composer's attachment intake. */
  readonly accept: boolean;
}

/**
 * The drop zone's whole decision, as a pure function of the current event — never of an
 * accumulated count.
 *
 * `inside` is "the drag is over the chat area once this event has been applied": the event
 * target for `over` and `drop`, the *related* target for `leave` (where the drag is heading —
 * `null`, i.e. outside, when it left the window). That asymmetry is the point: a `dragleave`
 * whose related target is still inside the region is nothing but an internal element
 * boundary being crossed, and must not disturb the overlay.
 *
 * Being stateless is what makes the overlay impossible to strand. The obvious alternative —
 * a dragenter/dragleave depth counter — is an accumulator whose only unconditional resets
 * are `drop` and `dragend`, and neither fires for a file drag that ends outside the browser;
 * one missed `dragleave` would leave the counter permanently off by one, with the overlay
 * stuck on screen. Here, every `dragover` re-derives the answer from scratch, so any missed
 * event is corrected by the next one within a frame.
 */
export function dropRegionAction(
  signal: DragSignal,
  fileDrag: boolean,
  inside: boolean,
): DropRegionAction {
  const over = fileDrag && inside;
  switch (signal) {
    // The drag is over the region: show the overlay and claim the drag, so the browser
    // delivers the drop here instead of applying its navigate-to-file default.
    case "over":
      return { active: over, claim: over, accept: false };
    // Only a departure matters. Still inside (crossed into a child) → nothing changes;
    // gone from the region or from the window → hide. Claiming a dragleave would be
    // meaningless, so it never does.
    case "leave":
      return { active: over, claim: false, accept: false };
    // The release. Files are taken only when they were released inside the region — a drop
    // on the sidebar or a docked panel reaches the app-shell guard instead and does nothing.
    case "drop":
      return { active: false, claim: over, accept: over };
    // The drag is over, wherever it ended.
    case "end":
      return { active: false, claim: false, accept: false };
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
 * Window-level dragover fallback for the whole app shell. Runs after the chat area's drop
 * zone on the bubble path, so `defaultPrevented` is exactly "the chat area claimed this
 * drag": when it did not — the pointer is over the sidebar, the top bar, a docked panel, or
 * a page with no composer at all — cancel the default and show the no-drop cursor, an honest
 * "dropping here does nothing" instead of the browser's copy cursor over a page that would
 * navigate away. Non-file drags pass through untouched (see isFileDrag).
 */
export function guardWindowDragOver(e: DragGuardEvent): void {
  if (e.defaultPrevented || !isFileDrag(e.dataTransfer?.types)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
}

/**
 * Window-level drop fallback, paired with guardWindowDragOver: cancels the browser's default
 * open-file navigation for any file drop the chat area did not claim. It attaches nothing and
 * says nothing — outside the chat area a file drop is simply inert. Text/link drops keep
 * their native behavior (dropping text into the composer textarea must still insert it).
 */
export function guardWindowDrop(e: DragGuardEvent): void {
  if (e.defaultPrevented || !isFileDrag(e.dataTransfer?.types)) return;
  e.preventDefault();
}
