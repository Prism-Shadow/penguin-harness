/**
 * Unit tests for stream-follow.ts (issue #75): in a short scroll area (scrollable
 * slack < 80px), scrolling up immediately exits auto-stick-to-bottom; staying at
 * a historical position, streaming increments don't override that intent; the
 * user can scroll back down to resume; content-shrink clamping isn't
 * misread as an upward scroll.
 */
import { describe, expect, it } from "vitest";
import { createStreamFollow } from "../src/features/chat/stream-follow";

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
});
