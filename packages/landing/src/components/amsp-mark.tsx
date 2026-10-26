/**
 * The AMSP mark, MMSP's sibling (mmsp.penguin.ooo, agenthub `site/src/components/Logo.astro`): the
 * same 32-unit square of four 16-unit tiles with no gap, the outer corners rounded at 7, MMSP's
 * blue, and the four initials in bold. MMSP sets its blue on the top-left/bottom-right diagonal;
 * AMSP mirrors it onto the other one, so the blue runs through the diagonal the eye crosses reading
 * A M S P — the stream through the run. Where MMSP draws near-black, AMSP draws a light tint of the
 * same blue with deep-blue initials; the blue tiles keep MMSP's white ones. MMSP reads dark and
 * AMSP light, so the two tell apart at a glance and still read as a pair. The tint holds on a light
 * and a dark page alike, so the mark has one rendition for both themes.
 *
 * Each tile is its own shape, as in MMSP's mark: a tinted square under the blue tiles would show a
 * rim of it along their rounded corners. The tinted tiles overlap the seam by half a unit so no
 * hairline shows between them.
 */
export function AmspMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <g fill="#aecbfa">
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
        <text x="8.5" y="8.5" fill="#0842a0">
          A
        </text>
        <text x="23.5" y="8.5">
          M
        </text>
        <text x="8.5" y="23.5">
          S
        </text>
        <text x="23.5" y="23.5" fill="#0842a0">
          P
        </text>
      </g>
    </svg>
  );
}
