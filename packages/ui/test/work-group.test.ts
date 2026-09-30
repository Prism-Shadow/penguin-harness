/**
 * WorkGroup (src/components/chat/work-group/work-group.tsx): the frame, activity and tree hooks'
 * markup, and the expand policy's first render — open while running, closed once done, forced
 * open by a pending approval. The app's container decides the state; this reads what it draws.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { WorkGroup } from "../src/components/chat/work-group/work-group";
import type { WorkGroupProps } from "../src/components/chat/work-group/work-group";
import { renderStatic } from "../src/testing";

const group = (props: Partial<WorkGroupProps>) =>
  renderStatic(
    createElement(WorkGroup, {
      running: false,
      stepRunning: false,
      kind: "tool",
      title: "Done",
      rows: [
        { key: 1, content: "first step" },
        { key: 2, content: "second step" },
      ],
      ...props,
    }),
  );

describe("WorkGroup", () => {
  it("opens while running, with the rows one tree level under the header and the last one marked", () => {
    const html = group({ running: true, stepRunning: true, title: "Running", count: "2 steps" });
    expect(html).toMatch(/<div class="ui-frame [^"]*"><button type="button" data-group-header/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-slot="head" data-kind="tool" data-state="running"');
    expect(html).toContain(">Running</span>");
    expect(html).toContain(">2 steps</span>");
    expect(html).toContain('data-slot="progress"');
    expect(html).toMatch(/<div data-slot="body" class="ui-tree [^"]*">/);
    expect(html).toContain('<div data-depth="1">first step</div>');
    expect(html).toContain('<div data-depth="1" data-last="true">second step</div>');
  });

  it("starts collapsed once done, and settles its duration with no progress slot", () => {
    const html = group({ durationMs: 2300 });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain(">2.3s</span>");
    expect(html).not.toContain('data-slot="progress"');
    expect(html).not.toContain("first step");
  });

  it("is forced open by a pending approval, whose buttons live in the body", () => {
    const html = group({ pending: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("first step");
  });

  it("names a group of thinking only as thinking work", () => {
    expect(group({ kind: "thinking" })).toContain('data-kind="thinking"');
  });
});
