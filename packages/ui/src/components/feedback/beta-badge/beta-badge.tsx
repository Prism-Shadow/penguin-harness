/**
 * The beta tag: a small bordered superscript that qualifies the word it rides on ("Company" in
 * the work-mode switch) rather than reporting a state, so it must not read as a status badge —
 * hence the muted ink and hairline, and no tone. On the smallest text rung.
 *
 * Its host positions it out of flow and folds its text into the host's accessible name (a
 * `Segmented` option's badge), so the tooltip is the only thing the tag says on its own.
 */
export function BetaBadge({ label, title }: { label: string; title?: string }) {
  return (
    <span
      {...(title !== undefined ? { "data-tooltip": title } : {})}
      className="whitespace-nowrap rounded-sm border border-line-emphasis px-0.5 py-px text-xs font-medium leading-none text-fg-muted"
    >
      {label}
    </span>
  );
}
