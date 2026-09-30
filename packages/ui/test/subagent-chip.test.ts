/**
 * SubagentChip (src/components/chat/subagent-chip/subagent-chip.tsx): the row is named by the
 * caller (the name folds in the waiting state), and its spinner and attention dot are decoration
 * beside that name.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SubagentChip } from "../src/components/chat/subagent-chip/subagent-chip";
import { renderStatic } from "../src/testing";

const chip = (running: boolean, pending: boolean) =>
  renderStatic(
    createElement(SubagentChip, {
      label: "Researcher",
      name: pending ? "Subagent Researcher · Awaiting approval" : "Subagent Researcher",
      avatarId: "researcher",
      tag: "a1b2",
      running,
      pending,
    }),
  );

describe("SubagentChip", () => {
  it("is a button named by the caller, showing the agent and the short id", () => {
    const html = chip(false, false);
    expect(html).toMatch(/^<button type="button" aria-label="Subagent Researcher"/);
    expect(html).toContain(">Researcher</span>");
    expect(html).toContain(">a1b2</span>");
    expect(html).not.toContain('data-live="spinner"');
  });

  it("shows a hidden spinner while running and a hidden dot while an approval waits", () => {
    const html = chip(true, true);
    expect(html).toContain('aria-label="Subagent Researcher · Awaiting approval"');
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*"><svg role="status"/);
    expect(html).toMatch(/<span aria-hidden="true" style="width:6px;height:6px"/);
  });
});
