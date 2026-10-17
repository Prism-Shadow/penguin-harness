/**
 * Pill (src/components/feedback/pill/pill.tsx): the one label pill.
 *
 * - Given any tone, the pill has the same shape — height, padding, radius, type and border — and
 *   only its colours differ, so two labels side by side never differ in size.
 * - Given a sentence behind the word, it is a marked hint that shows over the word; without one
 *   the pill carries no hint.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Pill } from "../src/components/feedback/pill/pill";
import { TONES } from "../src/tokens";
import { classTokens, renderStatic } from "../src/testing";

const shape = (html: string) => classTokens(html).filter((token) => !token.includes("tone-"));

describe("Pill", () => {
  it("has one shape in every tone, only its colours differing", () => {
    const neutral = renderStatic(createElement(Pill, { children: "this server" }));
    for (const tone of TONES) {
      const html = renderStatic(createElement(Pill, { tone, children: "Running" }));
      expect(shape(html), tone).toEqual(shape(neutral));
      expect(html, tone).toContain(`tone-${tone}-`);
    }
  });

  it("carries a sentence behind the word as a marked hint, and none without one", () => {
    const hinted = renderStatic(
      createElement(Pill, {
        tone: "danger",
        tooltip: "The last job failed at Restart.",
        children: "Failed",
      }),
    );
    expect(hinted).toContain('data-tooltip="The last job failed at Restart."');
    expect(hinted).toContain('data-tooltip-extra="true"');
    expect(renderStatic(createElement(Pill, { children: "v0.2.16" }))).not.toContain(
      "data-tooltip",
    );
  });
});
