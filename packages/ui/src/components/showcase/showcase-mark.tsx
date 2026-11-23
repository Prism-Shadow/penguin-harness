/**
 * A showcase control's mark: a registry path as its line drawing alone, on the 24 grid at the
 * line family's weight, at the rung of a glyph alone in an icon button. The public sites do not
 * load the icon sets, so the showcase family's controls (the carousel's, the layout switch) draw
 * the line set in every theme, as the sites' menu check does.
 */
import { ICON_SIZE } from "../../icon-scale";

export function ShowcaseMark({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg
      width={ICON_SIZE.iconButton}
      height={ICON_SIZE.iconButton}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
