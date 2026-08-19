/**
 * title-reveal.ts unit tests: the pure math behind the sidebar's truncated-title
 * scroll reveal (#309). Distance: only a real overflow (beyond the 1px subpixel
 * tolerance) counts — it drives both the `title` tooltip and the scroll, so "fits"
 * must be exactly 0. Duration: proportional to the distance (constant reading
 * speed), clamped between a floor (a sub-350ms hop reads as a glitch) and a
 * ceiling (a huge title speeds up instead of holding the hover hostage), and 0
 * when there is nothing to scroll.
 *
 * The second half pins the CSS contract. The arithmetic was never the fragile
 * part: the reveal only works while three files agree on four names, and nothing
 * else in the suite notices if one side is renamed. vitest runs node-only here
 * (`environment: "node"`, no jsdom), so these assert against the source text
 * rather than a rendered DOM.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OVERFLOW_TOLERANCE_PX,
  REVEAL_MAX_MS,
  REVEAL_MIN_MS,
  REVEAL_SPEED_PX_PER_S,
  revealDistancePx,
  revealDurationMs,
} from "../src/lib/title-reveal";

describe("revealDistancePx", () => {
  it("reports 0 when the text fits", () => {
    expect(revealDistancePx(180, 200)).toBe(0);
    expect(revealDistancePx(200, 200)).toBe(0);
  });

  it("treats the 1px subpixel rounding artifact as fitting", () => {
    expect(revealDistancePx(200 + OVERFLOW_TOLERANCE_PX, 200)).toBe(0);
  });

  it("reports the full overflow once past the tolerance", () => {
    expect(revealDistancePx(202, 200)).toBe(2);
    expect(revealDistancePx(350, 200)).toBe(150);
  });
});

describe("revealDurationMs", () => {
  it("is 0 when there is nothing to scroll", () => {
    expect(revealDurationMs(0)).toBe(0);
    expect(revealDurationMs(-5)).toBe(0);
  });

  it("clamps a tiny overflow up to the floor", () => {
    // 2px at 60px/s would be ~33ms — far below the floor.
    expect(revealDurationMs(2)).toBe(REVEAL_MIN_MS);
  });

  it("is proportional to the distance between the clamps", () => {
    // Exactly one second's worth of travel.
    expect(revealDurationMs(REVEAL_SPEED_PX_PER_S)).toBe(1000);
    // Double the distance, double the duration.
    expect(revealDurationMs(REVEAL_SPEED_PX_PER_S * 2)).toBe(2000);
  });

  it("clamps a huge overflow down to the ceiling", () => {
    // 1500px at 60px/s would be 25s — capped so the reveal stays usable.
    expect(revealDurationMs(1500)).toBe(REVEAL_MAX_MS);
  });

  it("rounds to whole milliseconds", () => {
    // 100px at 60px/s = 1666.66…ms.
    expect(revealDurationMs(100)).toBe(1667);
  });
});

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (rel: string) => readFileSync(resolve(src, rel), "utf8");
const truncated = read("components/ui/truncated.tsx");
const sidebar = read("components/layout/sidebar.tsx");
/** styles.css with comments stripped and whitespace collapsed, so the assertions survive reformatting. */
const css = read("styles.css")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");
/** The keyframes that carry the whole reveal. */
const keyframes = css.match(/@keyframes title-scroll-reveal \{.*?\} \}/)?.[0] ?? "";
/** The hover/focus rule that starts them. */
const trigger = css.match(/\[data-title-reveal\][^{]*\{[^}]*\}/)?.[0] ?? "";

describe("the truncated-title reveal's CSS contract", () => {
  it("triggers on the row attribute the sidebar rows actually render", () => {
    expect(sidebar).toContain("data-title-reveal");
    expect(trigger).toContain("[data-title-reveal]:is(:hover, :has(:focus-visible))");
    // Scoped to the inner span, so a title that fits (no class, no variables) matches nothing.
    expect(trigger).toContain(".title-scroll > .title-scroll-text");
  });

  it("selects the class names truncated.tsx emits", () => {
    expect(truncated).toContain('" title-scroll"');
    expect(truncated).toContain('className="title-scroll-text"');
  });

  it("reads the custom properties truncated.tsx writes", () => {
    for (const prop of ["--title-scroll-shift", "--title-scroll-ms"]) {
      expect(truncated).toContain(prop);
      expect(`${keyframes}${trigger}`).toContain(`var(${prop},`);
    }
  });

  it("moves the text with an animation, which is what reduced motion disables", () => {
    // The reduced-motion guarantee is the global `animation: none !important` block —
    // it does not gate on any JS state, but it only reaches animations. Rewriting this
    // as a transition would keep the visuals and silently lose reduced-motion support.
    expect(trigger).toMatch(/animation: title-scroll-reveal var\(--title-scroll-ms/);
    expect(trigger).not.toContain("transition:");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*animation: none !important/,
    );
  });

  it("makes the text transformable inside the keyframes, never on the trigger rule", () => {
    // `transform` is inert on a non-replaced inline box, so the reveal needs the inner
    // span to become inline-block. It has to happen in the keyframes: as a declaration
    // on the trigger it would apply the moment the pointer touches the row, and Blink
    // paints no ellipsis for an overflowing atomic inline — so every long title would
    // drop its "…" 0.3s before anything moved, which is the flicker the delay exists
    // to prevent.
    expect(keyframes).toContain("display: inline-block");
    expect(keyframes).toContain("transform: translateX(var(--title-scroll-shift");
    expect(trigger).not.toContain("display:");
    expect(trigger).not.toContain("transform:");
  });

  it("holds the revealed tail with a forwards fill after a start delay", () => {
    expect(trigger).toMatch(/animation:[^;}]*\blinear\b[^;}]*\b0\.3s\b[^;}]*\bforwards\b/);
  });
});
