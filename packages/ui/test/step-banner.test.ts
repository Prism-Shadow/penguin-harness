/**
 * StepBanner (src/components/chat/step-banner/step-banner.tsx): the process banner opens while its
 * step runs and is a plain header once settled with no body; its title is sentence case on the
 * small rung, and as no step of the agent's work it carries no activity hook.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { StepBanner } from "../src/components/chat/step-banner/step-banner";
import type { StepBannerProps } from "../src/components/chat/step-banner/step-banner";
import { classTokens, renderStatic } from "../src/testing";

const banner = (props: Partial<StepBannerProps>) =>
  renderStatic(createElement(StepBanner, { state: "done", title: "Compacted", ...props }));

describe("StepBanner", () => {
  it("opens its body while running", () => {
    const html = banner({ state: "running", children: "tool groups" });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("tool groups");
  });

  it("is a plain header once settled with no body, its detail and duration after the title", () => {
    const html = banner({ detail: "12 tools", durationMs: 1500 });
    expect(html).not.toContain("aria-expanded");
    expect(html).toMatch(/>Compacted<\/span><span data-tooltip="12 tools"[^>]*>12 tools<\/span>/);
    expect(html).toContain(">1.5s</span>");
  });

  it("sets its title in sentence case, without the activity hook", () => {
    const tokens = classTokens(banner({ state: "running", children: "body" }));
    expect(tokens).not.toContain("uppercase");
    expect(tokens).not.toContain("ui-activity");
  });
});
