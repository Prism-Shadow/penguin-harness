/**
 * The menu panel: the one look every picker and menu shares — Select's floating panel, its two
 * row states and its check mark — so a choice reads the same wherever it is made. Select,
 * OptionMenu, Dropdown and the pickers built on them spell their panels and rows from these; the
 * Menu family builds on them.
 */
import { CheckIcon } from "../../icons/marks/marks";

/**
 * The floating panel every picker and menu opens: a hairline box on the overlay layer, one shadow
 * step, a little padding above the first row and below the last. Callers add position, width,
 * z-layer and max height, and the `ui-glass` hook in the component that opens the panel (a hook
 * belongs to its host component, not to a string).
 */
export const menuPanelClass =
  "anim-pop overflow-y-auto rounded-md border border-line bg-overlay py-1 shadow-lg";

/**
 * A menu row's padding, alignment and colour transition. Callers add `flex` or `block` and the
 * row's ink and fill from {@link menuRowTone}.
 */
export const menuRowClass = "w-full px-3 py-1.5 text-left transition-colors duration-150";

/**
 * A menu row's ink and fill: an action row, or a choice that is not the current one, fills on
 * hover; the current choice is filled and set in the medium weight (and carries ChoiceCheck).
 * The same two states in every picker, so a choice reads the same wherever it is made.
 */
export function menuRowTone(selected = false): string {
  return selected ? "bg-surface-muted font-medium text-fg" : "text-fg hover:bg-surface-muted";
}

/**
 * The current choice's mark, Select's check. It sits in a fixed slot at the row's end, so the
 * rows of one list align whether or not they carry it.
 */
export function ChoiceCheck({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="flex w-3 shrink-0 justify-center">
      {on && <CheckIcon className="text-fg-muted" />}
    </span>
  );
}
