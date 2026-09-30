/**
 * The caret after a reply that is still coming in. It is the `caret` slot of the `ui-stream`
 * host (AssistantReplyBody), so each theme decides what it is: Primer keeps this soft pulsing
 * bar, Frost hides it behind its fading veil, Console draws a solid block. Decorative: the
 * reply's own text is what a screen reader reads.
 */
export function StreamingCaret() {
  return (
    <span data-slot="caret" aria-hidden="true" className="animate-pulse text-gray-400">
      ▌
    </span>
  );
}
