/**
 * Sizes an auto-growing textarea to its content without moving anything around it.
 *
 * The box is measured the usual way, collapsed to `height: auto` and its `scrollHeight` read,
 * and that read forces a layout with the box collapsed. Everything sized by what the box leaves
 * moves in that layout. Above a composer that is the transcript, a sibling scroll container
 * whose viewport grows while the composer is collapsed, so the browser clamps its scrollTop to
 * the taller viewport's smaller maximum, and writing the height back does not return the offset.
 * A transcript parked at the bottom would slide on every keystroke: by a device pixel where the
 * collapsed box is a fraction of a pixel shorter than the height it is set to (the theme's
 * fractional spacing unit makes it so at some text sizes), and by whole lines once a draft runs
 * past the two rows the box collapses to, which also reads as the user scrolling up and turns
 * auto-follow off.
 *
 * Holding the box's parent at its current height for the measurement keeps that layout
 * identical outside the parent. The hold is a `min-height`, so a box that grows still pushes the
 * parent (growth shrinks the transcript, which never clamps an offset). The parent's height is
 * read from its computed style rather than its client rect: the rect is scaled by any transform
 * an entrance animation holds, and an offset height is rounded to whole pixels, either of which
 * would let the parent move by the difference.
 */
export function fitTextarea(
  box: HTMLTextAreaElement,
  /** The height to set, read while the box is collapsed: its `scrollHeight`, capped, plus any border it adds back. */
  measure: (collapsed: HTMLTextAreaElement) => number,
): void {
  const parent = box.parentElement;
  const held = parent?.style.minHeight ?? "";
  if (parent) parent.style.minHeight = getComputedStyle(parent).height;
  box.style.height = "auto";
  box.style.height = `${measure(box)}px`;
  if (parent) parent.style.minHeight = held;
}
