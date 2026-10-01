/**
 * StepBanner (src/components/chat/step-banner/step-banner.tsx): the harness card opens while its
 * step runs and is a plain header once settled with no body; it is a frame headed by an activity
 * row of the event kind, its rows one tree level under the head, and its title stays sentence case
 * (a theme uppercases it through the hook, never the component).
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { StepBanner } from "../src/components/chat/step-banner/step-banner";
import type { StepBannerProps } from "../src/components/chat/step-banner/step-banner";
import { classTokens, renderStatic } from "../src/testing";

const banner = (props: Partial<StepBannerProps>) =>
  renderStatic(createElement(StepBanner, { state: "done", title: "Compacted", ...props }));

describe("StepBanner", () => {
  it("opens its rows while running, one tree level under an event head", () => {
    const html = banner({
      state: "running",
      rows: [
        { key: "a", content: "first server" },
        { key: "b", content: "second server" },
      ],
    });
    expect(html).toMatch(/<div class="ui-frame [^"]*"><button type="button" aria-expanded="true"/);
    expect(html).toContain('data-slot="head" data-kind="event" data-state="running"');
    expect(html).toContain('data-slot="toggle"');
    expect(html).toMatch(/<div data-slot="body" class="ui-tree [^"]*">/);
    expect(html).toContain('<div data-depth="1">first server</div>');
    expect(html).toContain('<div data-depth="1" data-last="true">second server</div>');
  });

  it("is a plain header once settled with no body, its detail and duration after the title", () => {
    const html = banner({ detail: "12 tools", durationMs: 1500 });
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain('data-slot="toggle"');
    expect(html).toContain('data-kind="event" data-state="done"');
    expect(html).toMatch(/>Compacted<\/span><span data-slot="detail" data-tooltip="12 tools"/);
    expect(html).toContain(">1.5s</span>");
  });

  it("folds a failure onto the error state, closed", () => {
    const html = banner({ state: "failed", children: "report" });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps a one-piece body out of the tree, and its title in sentence case", () => {
    const html = banner({ state: "running", children: "report" });
    expect(html).toContain('<div data-slot="body" class="anim-fade">report</div>');
    expect(html).not.toContain("ui-tree");
    expect(classTokens(html)).not.toContain("uppercase");
  });
});
