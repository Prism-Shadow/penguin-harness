/**
 * Collapse/expand indicator icon: a `>` shaped chevron that rotates 90 degrees to point down when expanded.
 * Shared by every collapsible element site-wide (thinking blocks, tool cards, sub-session cards,
 * reasoning groups, sidebar groups, trace tree, trace groups) — no more solid triangle characters.
 */
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
