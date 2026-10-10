/**
 * The drag image every draggable row hands the browser: an opaque, themed chip holding a copy of
 * the row.
 *
 * Left to itself, a browser builds a drag image from the source element's own paint and nothing
 * else — no ancestor's background, no backdrop filter, no hover state. A row that is translucent
 * or transparent on its column (an entry on a glass navigation column, a row whose fill is a wash
 * of the ink, a header whose dark fill is let through) then floats as bare text, and the
 * buttons a row shows only under the pointer vanish or stick. `setDragPreview`, called from the
 * row's `dragstart` handler, copies the row into a chip painted in the theme's tokens — the
 * overlay surface, its line, the row radius, the body ink, the row's own face and size — at the
 * row's width, hands it to `dataTransfer.setDragImage` at the pointer's offset in the row, and
 * removes it on the next task, once the browser has taken its snapshot. No shadow: a drag image
 * shows nothing beyond its own box.
 *
 * The chip is laid out fixed and off screen, so it never flashes on the page or moves its layout;
 * it is hidden from assistive technology and inert, and the copy drops its ids and test ids, so
 * for its one task the document holds no duplicates. The copy is taken at rest — hover-only
 * controls stay hidden in it, as they are on a row the pointer has left.
 *
 * Call it for the row's own drag only (`e.target === e.currentTarget`): a drag begun on something
 * natively draggable inside the row — a link, an image, selected text — keeps that thing's image.
 */

/** The chip's look: the theme's overlay surface inside its line, at the row radius, in the body ink. */
export const DRAG_PREVIEW_CLASS =
  "pointer-events-none fixed box-content overflow-hidden rounded-md border border-line bg-overlay text-fg";

/** Where the chip is laid out: past the viewport's left edge, so nothing on the page shows it. */
const OFFSCREEN_LEFT = "-10000px";

/** What a `dragstart` hands the helper: a DOM `DragEvent` or React's, structurally. */
export interface DragStartLike {
  readonly dataTransfer: DataTransfer | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly currentTarget: EventTarget | null;
}

/**
 * Give the drag that `event` starts the row's chip as its image. `source` is the row to copy;
 * the element whose handler runs (`currentTarget`) when omitted.
 */
export function setDragPreview(event: DragStartLike, source?: HTMLElement): void {
  const transfer = event.dataTransfer;
  const row = (source ?? event.currentTarget) as HTMLElement | null;
  if (transfer === null || typeof transfer.setDragImage !== "function") return;
  if (row === null || typeof row.getBoundingClientRect !== "function") return;
  const doc = row.ownerDocument;
  const rect = row.getBoundingClientRect();

  const chip = doc.createElement("div");
  chip.className = DRAG_PREVIEW_CLASS;
  chip.setAttribute("aria-hidden", "true");
  chip.setAttribute("inert", "");
  chip.style.left = OFFSCREEN_LEFT;
  chip.style.top = "0px";
  chip.style.width = `${rect.width}px`;
  // The row may take its face and size from an ancestor the chip does not sit in.
  const face = doc.defaultView?.getComputedStyle(row);
  if (face !== undefined) {
    chip.style.fontFamily = face.fontFamily;
    chip.style.fontSize = face.fontSize;
    chip.style.lineHeight = face.lineHeight;
    chip.style.letterSpacing = face.letterSpacing;
  }

  const copy = row.cloneNode(true) as HTMLElement;
  copy.removeAttribute("id");
  copy.removeAttribute("data-testid");
  copy.querySelectorAll("[id], [data-testid]").forEach((node) => {
    node.removeAttribute("id");
    node.removeAttribute("data-testid");
  });
  chip.append(copy);
  doc.body.append(chip);

  // The chip's line sits outside the copy (a content box), so the pointer's point in the row lies
  // that much further into the chip.
  const edge = chip.clientLeft;
  transfer.setDragImage(chip, event.clientX - rect.left + edge, event.clientY - rect.top + edge);
  setTimeout(() => chip.remove(), 0);
}
