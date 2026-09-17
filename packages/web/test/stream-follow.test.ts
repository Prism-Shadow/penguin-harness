/**
 * Unit tests for stream-follow.ts (issue #75): in a short scroll area (scrollable
 * slack < 80px), scrolling up immediately exits auto-stick-to-bottom; staying at
 * a historical position, streaming increments don't override that intent; the
 * user can scroll back down to resume; content-shrink clamping isn't
 * misread as an upward scroll. Plus stickToBottom: programmatic snaps report the
 * landed position synchronously, so content growth racing the snap's async scroll
 * event can't make entering a conversation land off-bottom. Plus the hold: while the
 * selection menu is open the view does not snap, the user's own scrolling still decides
 * the intent, and a release catches a following view up with what arrived meanwhile.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createStreamFollow, stickToBottom } from "../src/features/chat/stream-follow";

/** Short scroll area: content 500px, viewport 460px, scrollable slack only 40px (always under the 80px threshold). */
const SHORT = { scrollHeight: 500, clientHeight: 460 };

describe("createStreamFollow", () => {
  it("short scroll area: wheel-up exits following immediately, even at the top (position no longer changes)", () => {
    const f = createStreamFollow();
    expect(f.stick).toBe(true);
    f.scrolled({ ...SHORT, scrollTop: 40 }); // scroll event from the program sticking to bottom: still following.
    expect(f.stick).toBe(true);
    f.wheel(-3);
    expect(f.stick).toBe(false);
  });

  it("short scroll area: scrollbar/keyboard up-moves (scrollTop decreasing) exit too", () => {
    const f = createStreamFollow();
    f.scrolled({ ...SHORT, scrollTop: 40 });
    f.scrolled({ ...SHORT, scrollTop: 20 }); // moved up, 20px from bottom (> the 1px clamp margin).
    expect(f.stick).toBe(false);
  });

  it("touch pull-down (finger moving down) exits; pushing up does not", () => {
    const f = createStreamFollow();
    f.touchStart(100);
    f.touchMove(90); // finger pushes up = content scrolls down, stays following.
    expect(f.stick).toBe(true);
    f.touchMove(120); // finger pulls down = content scrolls up, exits.
    expect(f.stick).toBe(false);
    f.touchEnd();
  });

  it("staying at a historical position: streaming increments (scrollTop unchanged, content taller) do not change the intent", () => {
    const f = createStreamFollow();
    f.scrolled({ ...SHORT, scrollTop: 40 });
    f.wheel(-3);
    f.scrolled({ ...SHORT, scrollTop: 0 }); // scrolled up to the top.
    expect(f.stick).toBe(false);
    // Content keeps growing while the user's position stays put: as long as scrollTop
    // doesn't change, following isn't mistakenly resumed.
    f.scrolled({ scrollHeight: 900, clientHeight: 460, scrollTop: 0 });
    expect(f.stick).toBe(false);
  });

  it("the user scrolling back near the bottom (within 80px) resumes following", () => {
    const f = createStreamFollow();
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1540 });
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 800 }); // dragged up, exits.
    expect(f.stick).toBe(false);
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1470 }); // back to 70px from bottom.
    expect(f.stick).toBe(true);
  });

  it("content shrink clamping scrollTop down (still at the bottom) does not count as scrolling up", () => {
    const f = createStreamFollow();
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1540 }); // stuck to bottom, following.
    // Group collapse shrinks content height; the browser clamps scrollTop to the new
    // bottom: it moved up, but it's still 0px from the bottom.
    f.scrolled({ scrollHeight: 1500, clientHeight: 460, scrollTop: 1040 });
    expect(f.stick).toBe(true);
  });

  it("the first scroll event already at a historical position (≥ 80px from bottom): initialized as not following by position", () => {
    const f = createStreamFollow();
    // The first event has no direction to judge from (e.g. a restored scroll position),
    // and is 540px from the bottom: it shouldn't wait for a subsequent scroll-up to exit.
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1000 });
    expect(f.stick).toBe(false);
  });

  it("resume (back-to-bottom button) re-enters follow, and the programmatic jump to the bottom keeps it stuck", () => {
    const f = createStreamFollow();
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1540 });
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 200 }); // dragged far up, exits.
    expect(f.stick).toBe(false);
    f.resume();
    expect(f.stick).toBe(true);
    // The caller sets scrollTop = scrollHeight right after; the resulting scroll event lands
    // at the bottom and must not be judged against the stale scrollTop=200 as "moved down then
    // wherever" — following continues, and streaming growth keeps sticking.
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1540 });
    expect(f.stick).toBe(true);
    f.scrolled({ scrollHeight: 2400, clientHeight: 460, scrollTop: 1940 }); // next streamed stick.
    expect(f.stick).toBe(true);
  });
});

/** Fake scroll container: clamps scrollTop into [0, scrollHeight - clientHeight] like a real element. */
function fakeContainer(scrollHeight: number, clientHeight: number) {
  let top = 0;
  return {
    scrollHeight,
    clientHeight,
    get scrollTop() {
      return top;
    },
    set scrollTop(v: number) {
      top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
    },
    metrics() {
      return { scrollTop: top, scrollHeight: this.scrollHeight, clientHeight: this.clientHeight };
    },
  };
}

describe("stickToBottom", () => {
  it("entry race: growth landing between the mount snap and its async scroll event keeps follow (and the next snap reaches the new bottom)", () => {
    const f = createStreamFollow();
    const el = fakeContainer(2000, 460);
    // Entering a conversation: the mount layout effect snaps and reports synchronously.
    stickToBottom(el, f);
    expect(el.scrollTop).toBe(1540);
    expect(f.stick).toBe(true);
    // An image finishes decoding before the browser dispatches the snap's scroll event:
    // content grows 300px below the viewport, scrollTop stays put.
    el.scrollHeight += 300;
    // The delayed scroll event reads LIVE metrics — 300px above the bottom. Before the fix
    // this was the FIRST scrolled() call, so the position initialization treated it as a
    // historical position and exited follow; with the snap reported first it takes the
    // ordinary path (scrollTop unchanged = no upward intent) and follow survives.
    f.scrolled(el.metrics());
    expect(f.stick).toBe(true);
    // The ResizeObserver re-snap on that growth then lands the view at the new bottom.
    stickToBottom(el, f);
    expect(el.scrollTop).toBe(1840);
    expect(f.stick).toBe(true);
  });

  it("content that fits the viewport: snap clamps to 0 and stays following", () => {
    const f = createStreamFollow();
    const el = fakeContainer(300, 460);
    stickToBottom(el, f);
    expect(el.scrollTop).toBe(0);
    expect(f.stick).toBe(true);
  });

  it("a real upward scroll right after the reported snap still exits immediately", () => {
    const f = createStreamFollow();
    const el = fakeContainer(2000, 460);
    stickToBottom(el, f);
    el.scrollTop = 1200; // scrollbar drag up
    f.scrolled(el.metrics());
    expect(f.stick).toBe(false);
  });

  it("back-to-bottom (resume + snap): growth before the jump's scroll event keeps follow too", () => {
    const f = createStreamFollow();
    const el = fakeContainer(2000, 460);
    stickToBottom(el, f);
    el.scrollTop = 200; // dragged far up, exits.
    f.scrolled(el.metrics());
    expect(f.stick).toBe(false);
    // The jump button: resume() forgets lastTop, then the snap re-seeds it — so growth
    // racing the jump's scroll event can't re-trigger the first-event misread either.
    f.resume();
    stickToBottom(el, f);
    el.scrollHeight += 300;
    f.scrolled(el.metrics());
    expect(f.stick).toBe(true);
  });
});

describe("hold", () => {
  it("defers the snap without touching the intent, and the release catches a following view up", () => {
    const f = createStreamFollow();
    const el = fakeContainer(2000, 460);
    stickToBottom(el, f);
    expect(f.snaps).toBe(true);
    // The selection menu opens during a live reply: nothing may snap now.
    f.hold(true);
    expect(f.snaps).toBe(false);
    // Chunks grow the content below the view; the view stays put, and staying put is not an
    // upward scroll, so the intent to follow survives the hold.
    el.scrollHeight += 300;
    f.scrolled(el.metrics());
    expect(f.stick).toBe(true);
    expect(f.snaps).toBe(false);
    expect(el.scrollTop).toBe(1540);
    // The menu closes: the view snaps again, straight to the new bottom.
    f.hold(false);
    expect(f.snaps).toBe(true);
    stickToBottom(el, f);
    expect(el.scrollTop).toBe(1840);
    expect(f.stick).toBe(true);
  });

  it("lets the user's own upward scroll during a hold exit follow, so the release leaves the view there", () => {
    const f = createStreamFollow();
    const el = fakeContainer(2000, 460);
    stickToBottom(el, f);
    f.hold(true);
    f.wheel(-3);
    el.scrollTop = 900;
    f.scrolled(el.metrics());
    f.hold(false);
    expect(f.stick).toBe(false);
    expect(f.snaps).toBe(false);
  });

  it("lets the user's own return to the bottom during a hold resume follow, which the release acts on", () => {
    const f = createStreamFollow();
    const el = fakeContainer(2000, 460);
    stickToBottom(el, f);
    el.scrollTop = 900; // parked above the bottom before the menu opened
    f.scrolled(el.metrics());
    f.hold(true);
    el.scrollTop = 1500; // scrolled back within 80px of the bottom
    f.scrolled(el.metrics());
    expect(f.snaps).toBe(false);
    f.hold(false);
    expect(f.snaps).toBe(true);
  });

  it("releases a view that was not following to not following", () => {
    const f = createStreamFollow();
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1000 });
    f.hold(true);
    f.hold(false);
    expect(f.stick).toBe(false);
    expect(f.snaps).toBe(false);
  });

  it("is what the message stream snaps by, held while its selection menu is open", () => {
    // The rules above bind the stream only while every snap it makes asks `snaps` rather than
    // `stick`, and the hold follows the menu's open state.
    const stream = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/chat/message-stream.tsx"),
      "utf8",
    );
    expect(stream).toContain("const menuOpen = selectionMenu.open;");
    expect(stream).toContain("follow.hold(menuOpen);");
    const snaps = stream.match(/if \(([^)]*?)\) stickToBottom\(el, follow\);/g) ?? [];
    expect(snaps.length).toBeGreaterThanOrEqual(3);
    for (const snap of snaps) expect(snap).toContain("follow.snaps");
  });
});
