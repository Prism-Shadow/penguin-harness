/**
 * Landing on a post's anchor once its body has loaded (lib/hash-arrival.ts). The browser is the
 * boundary: one fake window stands in for its address, its elements and its running animations,
 * and records the navigations asked of it.
 *
 * - Given a post opened at a citation's entry (`#fn-3`), when its body arrives, the browser is
 *   asked once to jump to that same address in place: a replace, which adds no history entry.
 * - Given the page is still rising around the target, the jump waits for that animation to end;
 *   an animation elsewhere on the page holds nothing up.
 * - Given a jump the reader made inside the page (the target is already the browser's target),
 *   nothing is asked of the browser.
 * - Given an anchor that names nothing in the body, or no anchor at all, nothing is asked.
 * - Given an anchor to a Chinese heading, percent-encoded in the address, its heading is found.
 * - Given the reader moves to another anchor, or the page goes away, while it is still rising,
 *   no jump is made.
 */
import { describe, expect, it } from "vitest";
import { landOnHash } from "../src/lib/hash-arrival";
import type { ArrivalAnimation, ArrivalWindow } from "../src/lib/hash-arrival";

interface FakeElement {
  id: string;
  matches(selector: string): boolean;
}

interface FakeAnimation extends ArrivalAnimation {
  end(): void;
}

/** A browser window at `address` holding elements with these ids, the first one `:target`. */
function fakeWindow(address: string, ids: string[], { marked = "" } = {}) {
  const url = new URL(address);
  const elements = new Map<string, FakeElement>(
    ids.map((id) => [id, { id, matches: (sel: string) => sel === ":target" && id === marked }]),
  );
  const replaced: string[] = [];
  const animations: FakeAnimation[] = [];
  const win: ArrivalWindow = {
    location: {
      get hash() {
        return url.hash;
      },
      get href() {
        return url.href;
      },
      replace: (to: string) => {
        replaced.push(to);
      },
    },
    document: {
      getElementById: (id) => elements.get(id) ?? null,
      getAnimations: () => animations,
    },
  };
  /** An animation running on an element that holds the ids given (`[]`: holds nothing here). */
  const animate = (holds: string[]): FakeAnimation => {
    let end = () => {};
    const finished = new Promise<void>((resolve) => {
      end = resolve;
    });
    const animation = {
      effect: { target: { contains: (el: FakeElement) => holds.includes(el.id) } },
      finished,
      end,
    };
    animations.push(animation);
    return animation;
  };
  const moveTo = (hash: string) => {
    url.hash = hash;
  };
  return { win, replaced, animate, moveTo };
}

/** Lets every settled promise run its continuation. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const POST = "https://penguin.ooo/blog/context-slope";

describe("landing on a post's anchor once the body is in", () => {
  it("asks the browser once to jump to the same address in place", async () => {
    const page = fakeWindow(`${POST}#fn-3`, ["fn-1", "fn-3", "fnref-3"]);
    await expect(landOnHash(page.win)).resolves.toBe(true);
    expect(page.replaced).toEqual([`${POST}#fn-3`]);
  });

  it("waits for the page's rise around the target, but not for animations elsewhere", async () => {
    const page = fakeWindow(`${POST}#fn-3`, ["fn-3"]);
    const rise = page.animate(["fn-3"]);
    page.animate([]); // a spinner somewhere else that never ends
    const landing = landOnHash(page.win);
    await flush();
    expect(page.replaced).toEqual([]);
    rise.end();
    await expect(landing).resolves.toBe(true);
    expect(page.replaced).toEqual([`${POST}#fn-3`]);
  });

  it("leaves a jump the reader made inside the page to the browser", async () => {
    const page = fakeWindow(`${POST}#fnref-3`, ["fn-3", "fnref-3"], { marked: "fnref-3" });
    await expect(landOnHash(page.win)).resolves.toBe(false);
    expect(page.replaced).toEqual([]);
  });

  it("asks nothing for an anchor naming nothing in the body, or for no anchor", async () => {
    const stale = fakeWindow(`${POST}#fn-40`, ["fn-1", "fn-3"]);
    await expect(landOnHash(stale.win)).resolves.toBe(false);
    const plain = fakeWindow(POST, ["fn-1"]);
    await expect(landOnHash(plain.win)).resolves.toBe(false);
    expect([...stale.replaced, ...plain.replaced]).toEqual([]);
  });

  it("finds a Chinese heading from its percent-encoded anchor", async () => {
    const page = fakeWindow(`${POST}#${encodeURIComponent("测了什么")}`, ["测了什么"]);
    await expect(landOnHash(page.win)).resolves.toBe(true);
    expect(page.replaced).toHaveLength(1);
  });

  it("makes no jump once the reader moved on or the page went away while it rose", async () => {
    const moved = fakeWindow(`${POST}#fn-3`, ["fn-3", "fn-4"]);
    const rise = moved.animate(["fn-3", "fn-4"]);
    const landing = landOnHash(moved.win);
    moved.moveTo("#fn-4");
    rise.end();
    await expect(landing).resolves.toBe(false);

    const gone = fakeWindow(`${POST}#fn-3`, ["fn-3"]);
    const goneRise = gone.animate(["fn-3"]);
    let live = true;
    const left = landOnHash(gone.win, () => live);
    live = false;
    goneRise.end();
    await expect(left).resolves.toBe(false);
    expect([...moved.replaced, ...gone.replaced]).toEqual([]);
  });
});
