/**
 * A jump inside a post (a citation, a back-link, a TOC entry, or the landing on a shared anchor)
 * is aimed where its target is when the scroll begins. A post's pictures arrive after its text and
 * carry no size in the markup, so each one that finishes loading above the target pushes it
 * down. While a smooth scroll is still on its way, Chromium and Firefox then stop at the old
 * offset, a picture's height short of the target, and WebKit abandons the scroll and leaves the
 * reader where they clicked. After the scroll, Chromium and Firefox keep the reader's place by
 * scroll anchoring, but WebKit has none, so a picture arriving later still carries the target off
 * the screen.
 *
 * So after a jump the target is held: whenever the body changes size, it is scrolled into view
 * again, which does nothing when it is already in place. The hold lasts a few seconds, and on
 * while the body's pictures are still loading, up to a cap. The reader's own scrolling (wheel,
 * touch, scroll keys, a press anywhere) lets go at once. Going Back or Forward between a page's
 * anchors is not a jump: the browser restores the reader's position there, and holding a target
 * would undo that, so only a followed link or the landing on a shared anchor is held.
 */
import { hashTargetId } from "@prismshadow/penguin-ui/site";

/** How long a jump's target is held at least: longer than any smooth scroll to it. */
export const JUMP_HOLD_MS = 3000;
/** How long it is held at most, while pictures are still arriving. */
export const JUMP_HOLD_CAP_MS = 15000;

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

export interface JumpHoldOptions {
  holdMs?: number;
  capMs?: number;
  /** Whether the body is still loading pictures, which keeps the hold on past `holdMs`. */
  settling?: () => boolean;
}

/** The hold itself, free of the DOM: what to bring back into view, and until when. */
export function createJumpHold<T>({
  holdMs = JUMP_HOLD_MS,
  capMs = JUMP_HOLD_CAP_MS,
  settling = () => false,
}: JumpHoldOptions = {}): JumpHold<T> {
  let held: { target: T; until: number; cap: number } | null = null;
  return {
    jumped(target, at) {
      held = { target, until: at + holdMs, cap: at + capMs };
    },
    letGo() {
      held = null;
    },
    resized(at) {
      if (held && at > held.until && !(at <= held.cap && settling())) held = null;
      return held?.target ?? null;
    },
  };
}

/**
 * Holds every jump made by following a `#` link on the page, and the one `holdHash` is told about
 * (the landing on the address's anchor), against `body` changing size. Returns the way to stop.
 */
export function holdPostJumps(body: Element): { holdHash(): void; dispose(): void } {
  const jumps = createJumpHold<Element>({
    settling: () => [...body.querySelectorAll("img")].some((img) => !img.complete),
  });
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
  // A press lets go too (the scrollbar, a selection); the link a jump follows is pressed before
  // the jump is held, so it does not undo its own jump.
  window.addEventListener("pointerdown", letGo, { passive: true });
  window.addEventListener("keydown", onKey);
  return {
    holdHash,
    dispose() {
      window.clearTimeout(pending);
      observer.disconnect();
      document.removeEventListener("click", onClick);
      window.removeEventListener("wheel", letGo);
      window.removeEventListener("touchstart", letGo);
      window.removeEventListener("pointerdown", letGo);
      window.removeEventListener("keydown", onKey);
    },
  };
}
