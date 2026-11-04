/**
 * The layer scale for code that sets a z-index itself: an inline style
 * (`style={{ zIndex: layer("dock") }}`) or a style written from a frame loop. The numbers and the
 * order live in layers.css alone, whose header says what each layer is for and which of them
 * order things inside a window rather than over the whole app; a class names a layer through its
 * `z-<layer>` utility instead.
 */
export type Layer =
  | "behind"
  | "sticky"
  | "sticky-head"
  | "raised"
  | "handle"
  | "window-overlay"
  | "dock"
  | "dock-handle"
  | "menu"
  | "modal"
  | "popover"
  | "toast"
  | "tooltip"
  | "drag-preview";

/** The layer's z-index as a CSS value, `var(--layer-<name>)`. */
export function layer(name: Layer): string {
  return `var(--layer-${name})`;
}
