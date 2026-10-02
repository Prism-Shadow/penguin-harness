/**
 * ActivityGroup (src/components/chat/activity-group/activity-group.tsx): the frame, activity and
 * tree hooks' markup and the expand policy's first render — open while running, closed once
 * settled, forced open by a pending approval, a static head with no body — for the agent's work
 * and a harness event alike; a failure's title takes the danger ink, and the title stays
 * sentence case (a theme uppercases it through the hook, never the component). The app's
 * containers decide the state; this reads what the card draws.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ActivityGroup } from "../src/components/chat/activity-group/activity-group";
import type { ActivityGroupProps } from "../src/components/chat/activity-group/activity-group";
import { classTokens, renderStatic } from "../src/testing";

const ROWS = [
  { key: 1, content: "first step" },
  { key: 2, content: "second step" },
];

const card = (props: Partial<ActivityGroupProps>) =>
  renderStatic(
    createElement(ActivityGroup, { kind: "tool", state: "done", title: "Done", ...props }),
  );

describe("ActivityGroup", () => {
  it("opens while running, a sticky head over rows one tree level down, the last marked", () => {
    const html = card({
      state: "running",
      stepRunning: true,
      title: "Running",
      count: "2 steps",
      rows: ROWS,
    });
    expect(html).toMatch(/<div class="ui-frame [^"]*"><button type="button" data-group-header/);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(
      /class="ui-activity sticky [^"]*" data-slot="head" data-kind="tool" data-state="running"/,
    );
    expect(html).toContain(">2 steps</span>");
    expect(html).toContain('data-slot="progress"');
    expect(html).toMatch(/<div data-slot="body" class="ui-tree [^"]*">/);
    expect(html).toContain('<div data-depth="1">first step</div>');
    expect(html).toContain('<div data-depth="1" data-last="true">second step</div>');
  });

  it("starts collapsed once settled, its duration settled and no progress slot", () => {
    const html = card({ durationMs: 2300, rows: ROWS });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="done"');
    expect(html).toContain(">2.3s</span>");
    expect(html).not.toContain('data-slot="progress"');
    expect(html).not.toContain("first step");
  });

  it("is forced open by a pending approval, whose buttons live in the body", () => {
    const html = card({ pending: true, rows: ROWS });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("first step");
  });

  it("is a static head with no body, its detail and duration after the title", () => {
    const html = card({ kind: "event", title: "Compacted", detail: "12 tools", durationMs: 1500 });
    expect(html).not.toContain("<button");
    expect(html).not.toContain('data-slot="toggle"');
    expect(html).toContain('data-kind="event" data-state="done"');
    expect(html).toMatch(/>Compacted<\/span><span data-slot="detail" data-tooltip="12 tools"/);
    expect(html).toContain(">1.5s</span>");
  });

  it("folds a failure onto the error state, closed, its title in the danger ink", () => {
    const html = card({ kind: "event", state: "failed", title: "Compaction", children: "report" });
    expect(html).toContain('data-state="error"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(
      /<span data-slot="label" class="[^"]*text-tone-danger-fg[^"]*">Compaction</,
    );
  });

  it("keeps a one-piece body out of the tree, and its title in sentence case", () => {
    const html = card({ kind: "event", state: "running", title: "Compacting", children: "report" });
    expect(html).toContain('<div data-slot="body" class="anim-fade">report</div>');
    expect(html).not.toContain("ui-tree");
    expect(classTokens(html)).not.toContain("uppercase");
  });
});
