/**
 * LauncherBall and LauncherFan (src/components/shell/launcher/launcher.tsx): the floating ball
 * with its caption, and the arc of entries it opens.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { LauncherBall, LauncherFan } from "../src/components/shell/launcher/launcher";
import { classTokens, renderStatic } from "../src/testing";

const ball = (props: { lit?: boolean; badge?: boolean } = {}) =>
  renderStatic(
    createElement(LauncherBall, {
      size: 56,
      captionHeight: 30,
      glyph: "G",
      caption: "Shortcuts",
      label: "Open the workbench",
      lit: props.lit ?? false,
      dragging: false,
      badge: props.badge,
    }),
  );

describe("LauncherBall", () => {
  it("is named by its label, with the caption shown but hidden from assistive technology", () => {
    const html = ball();
    expect(html).toContain('aria-label="Open the workbench"');
    expect(html).toMatch(/<span aria-hidden="true" class="ui-glass [^"]*"[^>]*>Shortcuts<\/span>/);
  });

  it("keeps the product's geometry: the ball's size, and the caption in the reserved room", () => {
    const html = ball();
    expect(html).toContain('style="width:56px;height:56px"');
    expect(html).toContain('style="top:60px;height:26px"');
    expect(classTokens(html)).toContain("text-[length:var(--ui-text-code-size)]");
  });

  it("is quiet at rest and clear when lit, on the glass hook", () => {
    expect(classTokens(ball())).toEqual(expect.arrayContaining(["ui-glass", "opacity-80"]));
    expect(classTokens(ball({ lit: true }))).toEqual(
      expect.arrayContaining(["opacity-100", "text-fg"]),
    );
  });

  it("carries the attention dot only when asked", () => {
    expect(ball()).not.toContain("bg-tone-attention-emphasis");
    expect(ball({ badge: true })).toContain("bg-tone-attention-emphasis");
  });
});

describe("LauncherFan", () => {
  const fan = (phase: "open" | "closing") =>
    renderStatic(
      createElement(LauncherFan, {
        phase,
        entrySize: 46,
        label: "Panels",
        onPoint: () => {},
        onLeave: () => {},
        entries: [
          { key: "a", label: "Agents", glyph: "A", x: 0, y: -112, onChoose: () => {} },
          {
            key: "b",
            label: "Files",
            glyph: "B",
            x: -112,
            y: 0,
            testId: "open-b",
            onChoose: () => {},
          },
        ],
      }),
    );

  it("is a named group of named entries, each placed on the arc by its offset", () => {
    const html = fan("open");
    expect(html).toMatch(/^<div role="group" aria-label="Panels"/);
    expect(html).toContain('aria-label="Agents"');
    expect(html).toContain('data-testid="open-b"');
    expect(html).toContain("--fan-x:-112.0px;--fan-y:0.0px");
    expect(html).toContain("width:46px;height:46px;left:-23px;top:-23px");
  });

  it("staggers the entrance down the arc and folds all at once", () => {
    const open = fan("open");
    expect(open).toContain("launcher-fan-in");
    expect(open).toContain("animation-delay:0ms");
    expect(open).toContain("animation-delay:16ms");
    const closing = fan("closing");
    expect(closing).toContain("launcher-fan-out");
    expect(closing).not.toContain("animation-delay:16ms");
  });
});
