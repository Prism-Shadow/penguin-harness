/**
 * Unified rendering for stat icons (shared by the chat page's stat row and the Trace page's turn
 * cards): a 24x24 line path with stroke set to currentColor, so the color follows the caller's
 * text color. See lib/stat-icons.ts for the paths.
 */
export function GlyphIcon({
  d,
  size = 13,
  className = "",
}: {
  d: string;
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
