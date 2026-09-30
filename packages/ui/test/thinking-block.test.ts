/**
 * ThinkingBlock (src/components/chat/thinking-block/thinking-block.tsx): a thinking step for the
 * activity hook, its state named by the caller's label, its stop reason shown when it failed. The
 * expanded body's classes are the web app's `disclosure-body` test.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "../src/components/chat/thinking-block/thinking-block";
import type { ThinkingBlockProps } from "../src/components/chat/thinking-block/thinking-block";
import { renderStatic } from "../src/testing";

const row = (props: Partial<ThinkingBlockProps>) =>
  renderStatic(
    createElement(ThinkingBlock, {
      state: "done",
      stateLabel: "Done",
      label: "Thinking",
      text: "the plan",
      durationMs: 800,
      ...props,
    }),
  );

describe("ThinkingBlock", () => {
  it("is a collapsed thinking step with its settled duration", () => {
    const html = row({});
    expect(html).toMatch(/class="ui-activity [^"]*" data-kind="thinking" data-state="done"/);
    expect(html).toContain('aria-label="Done"');
    expect(html).toMatch(/data-slot="label"[^>]*>Thinking</);
    expect(html).toContain(">800ms</span>");
    expect(html).not.toContain("the plan");
  });

  it("reads a failed step as an error and shows why it stopped", () => {
    const html = row({ state: "failed", stateLabel: "aborted", stopReason: "aborted" });
    expect(html).toContain('data-state="error"');
    expect(html).toContain(">[aborted]</span>");
  });
});
