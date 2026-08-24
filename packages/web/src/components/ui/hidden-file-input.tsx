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
 * Hence the wrapper: it is positioned (`absolute`), so the containing block travels **with
 * the control** instead of depending on whichever ancestor happens to be positioned. The
 * wrapper is `contents`-free on purpose — it must be a real box to be a containing block.
 *
 * `absolute` rather than `relative`: with auto offsets and a clipped 0-size child it still
 * renders at its static position inside the label, but it is **out of flow** — an in-flow
 * zero-width wrapper counts as a flex item in the `inline-flex gap-*` labels that host every
 * one of these controls, and the gap slot in front of the text pushed the label text a full
 * gap off center.
 */
import type { InputHTMLAttributes } from "react";

export function HiddenFileInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <span className="absolute">
      <input type="file" className="sr-only" {...props} />
    </span>
  );
}
