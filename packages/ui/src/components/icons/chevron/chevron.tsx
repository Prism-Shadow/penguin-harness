/**
 * The collapse indicator: a `>` chevron that rotates 90 degrees to point down when its section is
 * open. Every collapsible draws this one — thinking blocks, tool cards, sub-session cards, sidebar
 * groups, trace trees — rather than a solid triangle character, so an open section looks the same
 * wherever it is.
 *
 * It is a component rather than a registry entry because the rotation is part of the mark, and
 * this file is where the de-slop rules let a transform transition live.
 */
import { ChevronDown } from "../marks/marks";

export function Chevron({
  open,
  size = 14,
  className = "",
}: {
  open: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`block shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""} ${className}`}
    >
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/**
 * The caret of a vertical fold: it points down while what it folds away is hidden and turns over
 * to point up once it shows — the sidebar's page-nav toggle, a slim bar under the rows it folds.
 * It is the form control's fixed-grid caret (`ChevronDown`), turned here because this is the file
 * where a transform may transition.
 */
export function ChevronFlip({
  up,
  size = 12,
  className = "",
}: {
  /** What the toggle folds is showing: the caret points up, the way it will fold. */
  up: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <ChevronDown
      size={size}
      className={`transition-transform duration-200 ${up ? "rotate-180" : ""} ${className}`}
    />
  );
}
