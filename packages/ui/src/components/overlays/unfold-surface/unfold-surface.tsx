/**
 * A surface that unfolds in place from the button that opens it, the way a phone's folder grows
 * out of its icon: no backdrop and no dialog, the page around it stays where it is and stays
 * usable. The App Center's folders are its first caller.
 *
 * The caller lays it out inside a positioned area (a grid's region, `relative`) and wires the
 * trigger: an id, `aria-expanded`, and `aria-controls` pointing at the surface's `id`. Everything
 * else is here:
 *
 * - **Placement.** Centred on its origin, inside the area and inside the visible part of the
 *   nearest scroll area, its height capped at what is visible (unfold-geometry.ts). It follows
 *   when the area, the scroll area or its own content changes size.
 * - **The two endpoints.** Folded, the surface is clipped to the origin's box with the origin's
 *   corner radius; open, it rests whole. Artwork in the surface that has a preview inside the
 *   origin travels from that preview; artwork with none, and anything marked to fade, fades in
 *   place. Opening and closing run between the same endpoints, so a Back pressed half way turns
 *   the motion around where it is. The timing is the theme's layout timing, and both
 *   reduced-motion signals stop it, through the shared `data-layout-motion` rule (theme.css).
 * - **Leaving.** The back button, Esc (the shared Esc stack, topmost layer only), and a press or
 *   focus outside ask the caller to close (`onClose`). A press inside a portaled menu or dialog
 *   opened from the surface does not count as outside, nor does one inside `keepOpenWithin`.
 *   Closed, it folds back and then says so (`onExited`, at once when nothing moves), and the
 *   caller unmounts it.
 * - **Focus.** Open, the surface takes focus; folding, it hands focus back to the trigger when it
 *   held it. A surface whose window is off screen (`useWindowShown`) takes neither focus nor Esc.
 *
 * Anatomy the caller marks:
 *
 * - `data-unfold-from` on the element inside the trigger the surface grows out of (else the
 *   trigger itself). It is hidden while the surface is shown, which stands in its place.
 * - `data-unfold-source="<key>"` on a preview inside that element.
 * - `data-unfold-art="<key>"` inside the surface, on the slot artwork rests in: the slot keeps
 *   its box, and its first element child is what travels from the preview with the same key.
 * - `data-unfold-fade` inside the surface, on what has no preview and only fades in: a label
 *   under an icon, a badge over it.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { IconButton } from "../../actions/button/button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useWindowShown } from "../../shell/app-window/app-window";
import { useEscLayer } from "../esc-layers/esc-layers";
import { foldedClip, previewTransform, unfoldPlacement, type Rect } from "./unfold-geometry";

/** Open, the clip leaves room for the surface's shadow. */
const OPEN_CLIP = "inset(-1rem round var(--ui-radius-xl))";
/** Where artwork with no preview starts, before it fades in. */
const UNMATCHED_ART = "scale(0.72)";
/** Portaled layers opened from inside the surface: a press there is not outside. */
const OWN_LAYERS = '[role="menu"], [role="dialog"]';

export interface UnfoldSurfaceProps extends Omit<HTMLAttributes<HTMLElement>, "title" | "id"> {
  /** The surface's id, which the trigger's `aria-controls` names. */
  id: string;
  /** Open, or folding back into the trigger. */
  open: boolean;
  /** The id of the button that unfolds it. */
  triggerId: string;
  /** The heading beside the back button, which names the surface. */
  title: ReactNode;
  /** The back button's accessible name. */
  backLabel: string;
  /** Back, Esc, or a press or focus outside asks the caller to close it. */
  onClose: () => void;
  /** Folded back (at once when nothing moves): the caller unmounts it. */
  onExited: () => void;
  /** A selector for elements a press in does not close it: the other triggers of its kind. */
  keepOpenWithin?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
}

/** The nearest ancestor that scrolls vertically, as a box; the window when none does. */
function visibleScrollArea(node: HTMLElement): Pick<Rect, "top" | "bottom"> {
  for (let el = node.parentElement; el !== null; el = el.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY))
      return el.getBoundingClientRect();
  }
  return { top: 0, bottom: window.innerHeight };
}

/** The element inside the trigger the surface grows out of. */
function originOf(trigger: HTMLElement): HTMLElement {
  return trigger.querySelector<HTMLElement>("[data-unfold-from]") ?? trigger;
}

const artOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-unfold-art]"), (slot) => ({
    slot,
    art: slot.firstElementChild as HTMLElement | null,
  })).filter((piece): piece is { slot: HTMLElement; art: HTMLElement } => piece.art !== null);

const fadersOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-unfold-fade]"));

/**
 * Measures the resting place and the folded endpoints, as custom properties the state reads
 * (`--_unfold-from` on the surface, `--_unfold-art` on each travelling piece of artwork).
 */
function place(root: HTMLElement, origin: HTMLElement): void {
  const parent = root.offsetParent;
  if (!(parent instanceof HTMLElement)) return;
  const outer = parent.getBoundingClientRect();
  const area: Rect = {
    left: outer.left + parent.clientLeft,
    top: outer.top + parent.clientTop,
    right: outer.left + parent.clientLeft + parent.clientWidth,
    bottom: outer.top + parent.clientTop + parent.clientHeight,
    width: parent.clientWidth,
    height: parent.clientHeight,
  };
  const from = origin.getBoundingClientRect();
  const viewport = visibleScrollArea(root);
  const cap = unfoldPlacement({ area, viewport, origin: from, width: 0, height: 0 }).maxHeight;
  root.style.maxHeight = `${cap}px`;
  const { left, top } = unfoldPlacement({
    area,
    viewport,
    origin: from,
    width: root.offsetWidth,
    height: root.offsetHeight,
  });
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
  root.style.setProperty(
    "--_unfold-from",
    foldedClip(root.getBoundingClientRect(), from, getComputedStyle(origin).borderTopLeftRadius),
  );
  const previews = new Map(
    Array.from(origin.querySelectorAll<HTMLElement>("[data-unfold-source]"), (preview) => [
      preview.dataset.unfoldSource,
      preview.getBoundingClientRect(),
    ]),
  );
  for (const { slot, art } of artOf(root)) {
    const preview = previews.get(slot.dataset.unfoldArt);
    const rest = slot.getBoundingClientRect();
    art.toggleAttribute("data-unfold-matched", preview !== undefined && rest.width > 0);
    art.style.setProperty(
      "--_unfold-art",
      preview !== undefined && rest.width > 0 ? previewTransform(preview, rest) : UNMATCHED_ART,
    );
  }
}

/** Puts every part at the open or the folded endpoint; the theme's transitions run between. */
function show(root: HTMLElement, open: boolean): void {
  root.style.clipPath = open ? OPEN_CLIP : "var(--_unfold-from)";
  for (const { art } of artOf(root)) {
    art.style.transformOrigin = "top left";
    art.style.transform = open ? "" : "var(--_unfold-art)";
    art.style.opacity = open || art.hasAttribute("data-unfold-matched") ? "" : "0";
  }
  for (const fader of fadersOf(root)) fader.style.opacity = open ? "" : "0";
}

/** Turns the motion on once both endpoints have been drawn at least once. */
function enableMotion(root: HTMLElement): void {
  // Resolve the folded endpoint of every part first: an element whose style was never computed
  // has nothing to move from, and the last one would jump.
  void getComputedStyle(root).clipPath;
  for (const { art } of artOf(root)) void getComputedStyle(art).transform;
  for (const fader of fadersOf(root)) void getComputedStyle(fader).opacity;
  root.setAttribute("data-layout-motion", "shared-bounds");
  for (const { art } of artOf(root)) art.setAttribute("data-layout-motion", "shared-artwork");
  for (const fader of fadersOf(root)) fader.setAttribute("data-layout-motion", "shared-artwork");
}

export function UnfoldSurface({
  id,
  open,
  triggerId,
  title,
  backLabel,
  onClose,
  onExited,
  keepOpenWithin,
  ref,
  className = "",
  children,
  ...rest
}: UnfoldSurfaceProps) {
  const surface = useRef<HTMLElement | null>(null);
  const shown = useWindowShown();
  const state = useRef({ open, onClose, onExited });
  useLayoutEffect(() => {
    state.current = { open, onClose, onExited };
  });
  const trigger = () => document.getElementById(triggerId);
  const setRef = (node: HTMLElement | null) => {
    surface.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  // Placement, and the motion switched on after the first measure. The origin stays hidden while
  // the surface stands in its place.
  useLayoutEffect(() => {
    const root = surface.current;
    const button = trigger();
    if (root === null || button === null) return;
    const origin = originOf(button);
    const visibility = origin.style.visibility;
    origin.style.visibility = "hidden";
    const update = () => {
      place(root, origin);
      show(root, state.current.open);
    };
    place(root, origin);
    if (!root.hasAttribute("data-layout-motion")) {
      show(root, false);
      enableMotion(root);
    }
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (root.offsetParent) resized?.observe(root.offsetParent);
    resized?.observe(root);
    // New content (an app dropped in while open) is placed and shown at the current endpoint.
    const changed =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            update();
            enableMotion(root);
          });
    changed?.observe(root, { childList: true, subtree: true });
    return () => {
      resized?.disconnect();
      changed?.disconnect();
      origin.style.visibility = visibility;
    };
    // The trigger is found by id: a new id, or the window coming back on screen, measures again.
  }, [triggerId, shown]);

  // Open and close, focus, and the exit once the fold has finished.
  useLayoutEffect(() => {
    const root = surface.current!;
    show(root, open);
    if (open) {
      if (shown) root.focus({ preventScroll: true });
      return;
    }
    if (root.contains(document.activeElement) || document.activeElement === document.body)
      trigger()?.focus({ preventScroll: true });
    let current = true;
    // Reading the animations resolves the style, so the fold that just began is among them; with
    // reduced motion, or a theme that jumps, there is none.
    const folding = root.getAnimations?.() ?? [];
    void Promise.allSettled(folding.map((animation) => animation.finished)).then(() => {
      if (current) state.current.onExited();
    });
    return () => {
      current = false;
    };
  }, [open, shown]);

  const back = () => {
    trigger()?.focus({ preventScroll: true });
    state.current.onClose();
  };
  useEscLayer(open && shown, back);

  // A press or focus anywhere else closes it, once.
  useEffect(() => {
    if (!open || !shown) return;
    let dismissed = false;
    const dismiss = (event: PointerEvent | FocusEvent) => {
      const node = event.target;
      const root = surface.current;
      if (root === null || !(node instanceof Element) || root.contains(node)) return;
      if (trigger()?.contains(node) || node.closest(OWN_LAYERS)) return;
      if (keepOpenWithin !== undefined && node.closest(keepOpenWithin)) return;
      if (dismissed) return;
      dismissed = true;
      state.current.onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open, shown, triggerId, keepOpenWithin]);

  const titleId = `${id}-title`;
  return (
    <section
      {...rest}
      ref={setRef}
      id={id}
      aria-labelledby={titleId}
      inert={!open}
      tabIndex={-1}
      data-unfold-surface=""
      data-clip-surface
      className={`absolute z-raised flex w-full max-w-sm flex-col rounded-xl border border-line bg-surface shadow-lg outline-none ${className}`}
    >
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <header
          data-unfold-fade
          className="sticky top-0 z-raised flex items-center gap-2 bg-surface px-3 pt-3"
        >
          <IconButton label={backLabel} variant="ghost" size="sm" onClick={back}>
            <GlyphIcon d={ICONS.arrowLeftCentered} size={ICON_SIZE.iconButton} />
          </IconButton>
          <h2 id={titleId} className="truncate font-semibold text-fg">
            {title}
          </h2>
        </header>
        {children}
      </div>
    </section>
  );
}
