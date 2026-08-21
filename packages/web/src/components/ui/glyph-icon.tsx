/**
 * The app's one line-icon renderer: a 24x24 path stroked at 1.7 in currentColor, so the mark
 * follows the caller's text colour and every glyph in the app carries the same weight. Icon
 * paths live in the modules that own them — `lib/stat-icons.ts`, `components/ui/icons.tsx`,
 * `components/ui/group-list.tsx`, `components/ui/session-row-menu.tsx` — and the size comes from
 * the role-named scale in `lib/icon-scale.ts`.
 */
import { ICON_SIZE } from "../../lib/icon-scale";

export function GlyphIcon({
  d,
  size = ICON_SIZE.inlineGlyph,
  className = "",
  filled = false,
}: {
  d: string;
  size?: number;
  className?: string;
  /** Fill the path in currentColor — for a mark whose "on" state is a solid shape (a pinned tack). */
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block shrink-0 ${className}`}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
