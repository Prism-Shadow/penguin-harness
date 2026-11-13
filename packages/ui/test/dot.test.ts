/**
 * Dot: a tone's solid fill at a fixed pixel size, decorative unless it names itself, and live
 * only through the hook a theme re-times.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Dot } from "../src/components/icons/dot/dot";
import { classTokens, renderStatic } from "../src/testing";

describe("Dot", () => {
  it("sizes in pixels on three rungs, the 6px state dot by default", () => {
    expect(renderStatic(createElement(Dot, { tone: "success" }))).toContain("width:6px;height:6px");
    expect(renderStatic(createElement(Dot, { tone: "success", size: "sm" }))).toContain(
      "width:8px;height:8px",
    );
    expect(renderStatic(createElement(Dot, { tone: "success", size: "md" }))).toContain(
      "width:10px;height:10px",
    );
  });

  it("is decoration beside a label, and an image when it names itself", () => {
    const quiet = renderStatic(createElement(Dot, { tone: "danger" }));
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain("role=");
    const named = renderStatic(createElement(Dot, { tone: "danger", label: "Offline" }));
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Offline"');
    expect(named).not.toContain("aria-hidden");
  });

  it("pulses only when asked, through the live hook", () => {
    const still = renderStatic(createElement(Dot, { tone: "success" }));
    expect(still).not.toContain("ui-live");
    expect(still).not.toContain("data-live");
    const live = renderStatic(createElement(Dot, { tone: "success", pulse: true }));
    expect(classTokens(live)).toContain("ui-live");
    expect(live).toContain('data-live="dot"');
  });
});
