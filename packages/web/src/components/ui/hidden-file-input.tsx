/**
 * File input that is visually hidden but still Tab-focusable — the picker every "upload" /
 * "import" control in the app wraps in its own `<label>`.
 *
 * `display: none` would drop it out of the focus order, so the box has to be visually hidden
 * the `sr-only` way, which means `position: absolute`. That is exactly the shape that used to
 * escape its scroller and stretch the document (see the scroll-container invariant in
 * styles.css): dropped into a `static` ancestor chain, its containing block became the
 * initial containing block, so a control sitting past the fold added document-level
 * scrollable overflow and a second scrollbar.
 *
 * Hence the wrapper: it is `relative`, so the containing block travels **with the control**
 * instead of depending on whichever ancestor happens to be positioned. The wrapper is
 * `contents`-free on purpose — it is a real box, but an empty inline one with an absolutely
 * positioned child, so it contributes no width and no height to the label around it.
 */
import type { InputHTMLAttributes } from "react";

export function HiddenFileInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className="relative">
      <input type="file" className="sr-only" {...props} />
    </span>
  );
}
