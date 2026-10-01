/**
 * The composer's context ring (src/components/chat/context-ring/context-ring.tsx): one arc of the
 * context's fill in the muted ink, turning to attention past 80 % and to danger past 95 %; an
 * unmeasured context an empty track, never a full-looking zero; the caller's words as its name
 * and tooltip, once, on the square that holds it — a named image, or the button its panel opens
 * from.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ContextRing, contextRingTone } from "../src/components/chat/context-ring/context-ring";
import { classTokens, renderStatic } from "../src/testing";

type Props = Parameters<typeof ContextRing>[0];
const ring = (props: Props) => renderStatic(createElement(ContextRing, props));

describe("contextRingTone", () => {
  it("stays calm to 80 %, warns past it, and turns to danger past 95 %", () => {
    expect(contextRingTone(0)).toBeNull();
    expect(contextRingTone(0.8)).toBeNull();
    expect(contextRingTone(0.81)).toBe("attention");
    expect(contextRingTone(0.95)).toBe("attention");
    expect(contextRingTone(0.96)).toBe("danger");
    // Nothing measured is not a reading at all.
    expect(contextRingTone(0.99, true)).toBeNull();
  });
});

describe("ContextRing", () => {
  it("is a named image carrying its figures, named once", () => {
    const html = ring({ ratio: 0.4, label: "Context usage 40% · 51k/128k" });
    expect(html).toMatch(/^<span data-tooltip="Context usage 40% · 51k\/128k"/);
    expect(html).toContain('role="img"');
    // The ring inside is decoration: the square carries the one name and the one tooltip.
    expect(html.match(/data-tooltip=/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
    expect(classTokens(html)).toContain("text-fg-subtle");
  });

  it("inks the whole ring by the warning ladder", () => {
    expect(classTokens(ring({ ratio: 0.9, label: "x" }))).toContain("text-tone-attention-fg");
    expect(classTokens(ring({ ratio: 0.99, label: "x" }))).toContain("text-tone-danger-fg");
  });

  it("draws an unmeasured context as the empty track, in the calm ink", () => {
    const html = ring({ ratio: 0.99, unknown: true, label: "Context usage unknown" });
    expect(html).not.toContain('data-part="series"');
    expect(classTokens(html)).toContain("text-fg-subtle");
  });

  it("becomes the button its panel opens from, painting only the square on hover", () => {
    const html = ring({
      ratio: 0.5,
      label: "Context usage 50%",
      onClick: () => {},
      expanded: false,
      controls: "panel-1",
    });
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="panel-1"');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["h-8", "w-8", "hover:bg-surface-muted"]),
    );
  });
});
