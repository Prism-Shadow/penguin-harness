/**
 * The AMSP mark, MMSP's sibling (mmsp.penguin.ooo, agenthub `site/src/components/Logo.astro`): the
 * same 32-unit square of four 16-unit tiles with no gap, the outer corners rounded at 7, MMSP's
 * blue and near-black, and the four initials in bold white. MMSP sets its blue on the
 * top-left/bottom-right diagonal; AMSP mirrors it onto the other one, so the blue runs through the
 * diagonal the eye crosses reading A M S P — the stream through the run. Side by side the two read
 * as a pair; alone, each is its own.
 *
 * Each tile is its own shape, as in MMSP's mark: a dark square under the blue tiles would show a
 * grey rim along their rounded corners on a light background. The dark tiles overlap the seam by
 * half a unit so no hairline shows between them.
 */
export function AmspMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <g className="fill-[#111116] dark:fill-[#2a2a33]">
        <path d="M0 16.5V7a7 7 0 0 1 7-7h9.5v16.5Z" />
        <path d="M15.5 15.5H32V25a7 7 0 0 1-7 7h-9.5Z" />
      </g>
      <path d="M16 0h9a7 7 0 0 1 7 7v9H16Z" fill="#477dfb" />
      <path d="M0 16h16v16H7a7 7 0 0 1-7-7Z" fill="#477dfb" />
      <g
        fill="#fff"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="10.5"
        fontWeight="700"
        textAnchor="middle"
        dominantBaseline="central"
      >
        <text x="8.5" y="8.5">
          A
        </text>
        <text x="23.5" y="8.5">
          M
        </text>
        <text x="8.5" y="23.5">
          S
        </text>
        <text x="23.5" y="23.5">
          P
        </text>
      </g>
    </svg>
  );
}
