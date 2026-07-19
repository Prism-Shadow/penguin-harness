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
  it("短滚动区：wheel 上滚立即退出跟随，即使已在顶部（位置不再变化）", () => {
    const f = createStreamFollow();
    expect(f.stick).toBe(true);
    f.scrolled({ ...SHORT, scrollTop: 40 }); // scroll event from the program sticking to bottom: still following.
    expect(f.stick).toBe(true);
    f.wheel(-3);
    expect(f.stick).toBe(false);
  });

  it("短滚动区：滚动条/键盘上移（scrollTop 回退）同样退出", () => {
    const f = createStreamFollow();
    f.scrolled({ ...SHORT, scrollTop: 40 });
    f.scrolled({ ...SHORT, scrollTop: 20 }); // moved up, 20px from bottom (> the 1px clamp margin).
    expect(f.stick).toBe(false);
  });

  it("触摸下拉（手指向下移动）退出；上推不退出", () => {
    const f = createStreamFollow();
    f.touchStart(100);
    f.touchMove(90); // finger pushes up = content scrolls down, stays following.
    expect(f.stick).toBe(true);
    f.touchMove(120); // finger pulls down = content scrolls up, exits.
    expect(f.stick).toBe(false);
    f.touchEnd();
  });

  it("停留历史位置时，流式增量（scrollTop 不动、内容变高）不改变意图", () => {
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

  it("用户主动滚回底部附近（80px 内）恢复跟随", () => {
    const f = createStreamFollow();
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1540 });
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 800 }); // dragged up, exits.
    expect(f.stick).toBe(false);
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1470 }); // back to 70px from bottom.
    expect(f.stick).toBe(true);
  });

  it("内容收缩把 scrollTop 向下钳位（仍贴底）不算上滑", () => {
    const f = createStreamFollow();
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1540 }); // stuck to bottom, following.
    // Group collapse shrinks content height; the browser clamps scrollTop to the new
    // bottom: it moved up, but it's still 0px from the bottom.
    f.scrolled({ scrollHeight: 1500, clientHeight: 460, scrollTop: 1040 });
    expect(f.stick).toBe(true);
  });

  it("首个滚动事件即处于历史位置（离底 ≥ 80px）：按位置初始化为不跟随", () => {
    const f = createStreamFollow();
    // The first event has no direction to judge from (e.g. a restored scroll position),
    // and is 540px from the bottom: it shouldn't wait for a subsequent scroll-up to exit.
    f.scrolled({ scrollHeight: 2000, clientHeight: 460, scrollTop: 1000 });
    expect(f.stick).toBe(false);
  });
});
