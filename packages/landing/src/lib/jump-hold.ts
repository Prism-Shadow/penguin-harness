/**
 * A jump inside a post (a citation, a back-link, a TOC entry, or the landing on a shared anchor)
 * stops where the browser worked out when the scroll began. A post's pictures arrive after its
 * text and carry no size in the markup, so a picture that finishes loading while a smooth scroll
 * is still on its way pushes the target down after that, and the scroll stops short of it by the
 * picture's height. Once a scroll has ended, the browser's scroll anchoring keeps the reader's
 * place on its own; it is the scroll in flight that needs help.
 *
 * So for a short while after a jump the target is held: whenever the body changes size, it is
 * scrolled into view again, which does nothing when it is already in place. The reader's own
 * scrolling (wheel, touch, scroll keys) lets go at once. Going Back or Forward between a page's
 * anchors is not a jump: the browser restores the reader's position there, and holding a target
 * would undo that, so only a followed link or the landing on a shared anchor is held.
 */
import { hashTargetId } from "@prismshadow/penguin-ui/site";

/** How long a jump's target is held: longer than any smooth scroll to it. */
export const JUMP_HOLD_MS = 3000;

/** Keys that scroll the page; pressing one is the reader taking over. */
const SCROLL_KEYS = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "];

export interface JumpHold<T> {
  /** A jump to `target` began at `at` (ms). */
  jumped(target: T, at: number): void;
  /** The reader scrolled: hold nothing. */
  letGo(): void;
  /** The body changed size at `at`: the target to scroll into view again, if one is held. */
  resized(at: number): T | null;
}

/** The hold itself, free of the DOM: what to bring back into view, and until when. */
export function createJumpHold<T>(holdMs: number = JUMP_HOLD_MS): JumpHold<T> {
  let held: { target: T; until: number } | null = null;
  return {
    jumped(target, at) {
      held = { target, until: at + holdMs };
    },
    letGo() {
      held = null;
    },
    resized(at) {
      if (held && at > held.until) held = null;
      return held?.target ?? null;
    },
  };
}

/**
 * Holds every jump made by following a `#` link on the page, and the one `holdHash` is told about
 * (the landing on the address's anchor), against `body` changing size. Returns the way to stop.
 */
export function holdPostJumps(body: Element): { holdHash(): void; dispose(): void } {
  const jumps = createJumpHold<Element>();
  const holdHash = () => {
    const target = document.getElementById(hashTargetId(window.location.hash));
    if (target) jumps.jumped(target, performance.now());
  };
  let pending = 0;
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || !(event.target instanceof Element)) return;
    if (!event.target.closest("a[href^='#']")) return;
    // The browser follows the link once this event is over: see where it went then.
    pending = window.setTimeout(holdHash, 0);
  };
  const letGo = () => jumps.letGo();
  const onKey = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.includes(event.key)) jumps.letGo();
  };
  const observer = new ResizeObserver(() => jumps.resized(performance.now())?.scrollIntoView());
  observer.observe(body);
  document.addEventListener("click", onClick);
  window.addEventListener("wheel", letGo, { passive: true });
  window.addEventListener("touchstart", letGo, { passive: true });
  window.addEventListener("keydown", onKey);
  return {
    holdHash,
    dispose() {
      window.clearTimeout(pending);
      observer.disconnect();
      document.removeEventListener("click", onClick);
      window.removeEventListener("wheel", letGo);
      window.removeEventListener("touchstart", letGo);
      window.removeEventListener("keydown", onKey);
    },
  };
}
