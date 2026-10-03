/**
 * DisclosureRow (src/components/layout/disclosure-row/disclosure-row.tsx): a collapsed row that
 * says so, and that carries the activity hook — kind, state and label slot — only for a work step;
 * an open row's body is a fold in the body slot a theme's recipe finds it by, settled when the
 * row mounts open so a page load moves nothing (fold.test.ts covers the fold's phases).
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

  it("folds an open row's body in the body slot, settled at mount, a failed step's label in the danger ink", () => {
    const html = renderStatic(
      createElement(DisclosureRow, {
        icon: null,
        label: "Thinking",
        activity: { kind: "thinking", state: "error" },
        defaultOpen: true,
        children: "body",
      }),
    );
    // The fold's track is the row's sibling and carries the slot, so a recipe's
    // `.ui-activity ~ [data-slot="body"]` still finds it; the body sits in the box inside.
    expect(html).toMatch(
      /<\/button><div data-layout-motion="true" data-fold="settled" data-slot="body" class="grid"><div class="min-h-0">body<\/div><\/div><\/div>$/,
    );
    expect(html).toMatch(/class="[^"]*text-tone-danger-fg[^"]*" data-slot="label">Thinking</);
  });

  it("folds the run states onto the hook's three", () => {
    expect(activityState("waiting")).toBe("running");
    expect(activityState("failed")).toBe("error");
    expect(activityState("stopped")).toBe("done");
  });
});
