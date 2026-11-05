/**
 * The caret after text that is still coming in (a reply, thinking, a summary, a tool's output): a
 * live signal (`ui-live`, `data-live="caret"`) and the `caret` slot of the `ui-stream` host
 * (StreamText), so each theme decides what it is — Primer keeps this soft pulsing bar, Frost
 * hides it behind its fading veil, Console draws a solid block that blinks in steps. It is the
 * one pulse the transcript's text carries, and it holds still under reduced motion. Decorative:
 * the text itself is what a screen reader reads.
 */
export function StreamingCaret() {
  return (
    <span
      data-slot="caret"
      data-live="caret"
      aria-hidden="true"
      className="ui-live animate-pulse text-fg-subtle"
    >
      ▌
    </span>
  );
}
