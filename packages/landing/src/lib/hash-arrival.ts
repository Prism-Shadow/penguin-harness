/**
 * A post opened at an anchor (a shared `#fn-3`, `#fnref-2` or `#heading` link) reaches the browser
 * before its body does: the post's code and text load on demand (see the router and lib/blog.ts),
 * so the browser's own jump at load finds nothing to scroll to and marks nothing as the target.
 * Once the body is in the DOM, `landOnHash` asks the browser to make that jump again, as a
 * fragment navigation to the address the page already has (`location.replace`, so the history
 * gains no entry):
 *
 * - the target becomes `:target`, which is what washes a citation or a reference entry;
 * - the browser scrolls it below the sticky header by its `scroll-margin-top`, smoothly or not as
 *   the reader prefers;
 * - the jump waits for the animations running around the target (the page's rise-in) to end: an
 *   element measured while it is still moving lands off by the animation's offset.
 *
 * A jump made inside the page (a citation, a back-link, a TOC entry) already is such a
 * navigation, so its target is `:target` and nothing is done. Pure apart from the window it is
 * handed, so the behaviour is testable without a browser.
 */
import { hashTargetId } from "@prismshadow/penguin-ui/site";

/** The parts of an animation this module reads. */
export interface ArrivalAnimation {
  /** A keyframe effect names the element it animates as its `target`. */
  readonly effect: object | null;
  readonly finished: Promise<unknown>;
}

/** The parts of an element this module reads. */
export interface ArrivalElement {
  matches(selector: string): boolean;
}

/** The parts of the window this module reads and drives. */
export interface ArrivalWindow {
  readonly location: { readonly hash: string; readonly href: string; replace(url: string): void };
  readonly document: {
    getElementById(id: string): ArrivalElement | null;
    /** Absent where the Web Animations API is (a test, an old engine): nothing to wait for. */
    getAnimations?: () => readonly ArrivalAnimation[];
  };
}

/** The running animations of the target and of every element around it. */
function animationsAround(
  document: ArrivalWindow["document"],
  target: ArrivalElement,
): ArrivalAnimation[] {
  return (document.getAnimations?.() ?? []).filter((animation) => {
    const animated = (animation.effect as { target?: { contains?: unknown } } | null)?.target;
    return typeof animated?.contains === "function" && animated.contains(target) === true;
  });
}

/**
 * Jump to the address's anchor once the body that holds it is in the DOM. Resolves `true` when it
 * asked the browser to jump, `false` when there was nothing to do: no anchor, an anchor naming
 * nothing in the page, a target the browser already marked, or a caller that stopped caring
 * (`isLive`) or a reader who moved to another anchor while the page was still settling.
 */
export async function landOnHash(
  win: ArrivalWindow,
  isLive: () => boolean = () => true,
): Promise<boolean> {
  const { location, document } = win;
  const hash = location.hash;
  if (!hash) return false;
  const target = document.getElementById(hashTargetId(hash));
  if (!target || target.matches(":target")) return false;
  await Promise.allSettled(animationsAround(document, target).map((a) => a.finished));
  if (!isLive() || location.hash !== hash) return false;
  location.replace(location.href);
  return true;
}
