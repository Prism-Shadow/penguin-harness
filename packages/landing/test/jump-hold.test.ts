/**
 * Holding a jump's target while a post's pictures arrive (lib/jump-hold.ts, `createJumpHold`):
 * the part that decides, at each change in the body's size, which target to bring back into view.
 * The browser side (the size changes, the reader's gestures, the scroll itself) is driven in a
 * real browser by the citation sweep.
 *
 * - Given a jump, each time the body changes size while it is held, the target is brought back
 *   into view.
 * - Given the reader scrolls by themselves after the jump, a later change brings nothing back.
 * - Given the hold has run out, nothing is brought back, then or later.
 * - Given a second jump, the second target is the one held, for its own full hold.
 * - Given no jump, a change in size brings nothing back.
 */
import { describe, expect, it } from "vitest";
import { createJumpHold } from "../src/lib/jump-hold";

const HOLD = 3000;

describe("holding a jump's target while the post settles", () => {
  it("brings the target back into view at each change in size while held", () => {
    const hold = createJumpHold<string>(HOLD);
    hold.jumped("fn-3", 1000);
    expect(hold.resized(1200)).toBe("fn-3");
    expect(hold.resized(2900)).toBe("fn-3");
  });

  it("lets go once the reader scrolls", () => {
    const hold = createJumpHold<string>(HOLD);
    hold.jumped("fn-3", 1000);
    hold.letGo();
    expect(hold.resized(1100)).toBeNull();
  });

  it("brings nothing back once the hold has run out", () => {
    const hold = createJumpHold<string>(HOLD);
    hold.jumped("fn-3", 1000);
    expect(hold.resized(1000 + HOLD + 1)).toBeNull();
    expect(hold.resized(1000 + HOLD - 1)).toBeNull();
  });

  it("holds the latest jump's target, for its own full hold", () => {
    const hold = createJumpHold<string>(HOLD);
    hold.jumped("fn-3", 1000);
    hold.jumped("fnref-3-2", 2500);
    expect(hold.resized(4500)).toBe("fnref-3-2");
  });

  it("brings nothing back without a jump", () => {
    expect(createJumpHold<string>(HOLD).resized(10)).toBeNull();
  });
});
