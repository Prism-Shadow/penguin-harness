/**
 * DisclosureRow (src/components/layout/disclosure-row/disclosure-row.tsx): a collapsed row that
 * says so, and that carries the activity hook — kind, state and label slot — only for a work step;
 * an open row's body sits in the body slot a theme's recipe finds it by.
 * The expanded bodies' classes are the web app's `disclosure-body` test.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  DisclosureRow,
  activityState,
} from "../src/components/layout/disclosure-row/disclosure-row";
import { renderStatic } from "../src/testing";

const row = (activity?: { kind: "thinking"; state: "running" }) =>
  renderStatic(
    createElement(DisclosureRow, {
      icon: null,
      label: "Thinking",
      ...(activity ? { activity } : {}),
      children: "body",
    }),
  );

describe("DisclosureRow", () => {
  it("starts collapsed, with its body unmounted", () => {
    const html = row();
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("body");
    expect(html).not.toContain("ui-activity");
  });

  it("carries the activity hook for a work step, with its label slot and progress slot", () => {
    const html = row({ kind: "thinking", state: "running" });
    expect(html).toMatch(/class="ui-activity [^"]*" data-kind="thinking" data-state="running"/);
    expect(html).toContain('data-slot="label"');
    expect(html).toContain('data-slot="progress"');
  });

  it("is a static line with nothing to open, and a row naming something has no label", () => {
    const html = renderStatic(
      createElement(DisclosureRow, {
        icon: null,
        trailing: createElement("span", { "data-slot": "detail" }, "github"),
        activity: { kind: "event", state: "done" },
      }),
    );
    expect(html).toMatch(/<div class="ui-activity [^"]*" data-kind="event" data-state="done">/);
    expect(html).not.toContain("<button");
    expect(html).not.toContain('data-slot="toggle"');
    expect(html).not.toContain('data-slot="label"');
  });

  it("holds an open row's body in the body slot, a failed step's label in the danger ink", () => {
    const html = renderStatic(
      createElement(DisclosureRow, {
        icon: null,
        label: "Thinking",
        activity: { kind: "thinking", state: "error" },
        defaultOpen: true,
        children: "body",
      }),
    );
    expect(html).toContain('<div data-slot="body">body</div>');
    expect(html).toMatch(/class="[^"]*text-tone-danger-fg[^"]*" data-slot="label">Thinking</);
  });

  it("folds the run states onto the hook's three", () => {
    expect(activityState("waiting")).toBe("running");
    expect(activityState("failed")).toBe("error");
    expect(activityState("stopped")).toBe("done");
  });
});
