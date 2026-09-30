/**
 * The resize family (src/components/layout/resize-handle): the handle is a named separator in the
 * info tone that joins the tab order only when it can step, and the split pane lays its leading
 * column and handle in a window that slides shut when collapsed.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  RESIZE_HANDLE_PX,
  ResizeHandle,
} from "../src/components/layout/resize-handle/resize-handle";
import { SplitPane } from "../src/components/layout/resize-handle/split-pane";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => undefined;

describe("ResizeHandle", () => {
  it("is a separator named by its label, across the axis it moves along", () => {
    const html = renderStatic(
      createElement(ResizeHandle, { axis: "x", label: "Resize the file tree", onResize: noop }),
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Resize the file tree"');
    expect(html).toContain('data-tooltip="Resize the file tree"');
    // Pointer-only without a step: not in the tab order, and no value to report.
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("aria-valuenow");
    const y = renderStatic(
      createElement(ResizeHandle, { axis: "y", label: "Resize", onResize: noop }),
    );
    expect(y).toContain('aria-orientation="horizontal"');
    expect(classTokens(y)).toContain("cursor-row-resize");
  });

  it("reports its value and joins the tab order when it can step", () => {
    const html = renderStatic(
      createElement(ResizeHandle, {
        axis: "x",
        label: "Resize",
        onResize: noop,
        value: 220,
        min: 160,
        max: 400,
        onStep: noop,
      }),
    );
    expect(html).toContain('aria-valuenow="220"');
    expect(html).toContain('aria-valuemin="160"');
    expect(html).toContain('aria-valuemax="400"');
    expect(html).toContain('tabindex="0"');
  });

  it("draws in the info tone, as a row sibling or straddling an edge", () => {
    const inline = classTokens(
      renderStatic(createElement(ResizeHandle, { axis: "x", label: "Resize", onResize: noop })),
    );
    expect(inline).toEqual(expect.arrayContaining(["w-1.5", "shrink-0", "cursor-col-resize"]));
    expect(inline).toContain("hover:bg-tone-info-emphasis/40");
    expect(inline).not.toContain("absolute");
    const edge = classTokens(
      renderStatic(
        createElement(ResizeHandle, { axis: "y", label: "Resize", onResize: noop, edge: "start" }),
      ),
    );
    expect(edge).toEqual(expect.arrayContaining(["absolute", "-top-[3px]", "h-1.5"]));
  });
});

describe("SplitPane", () => {
  const render = (collapsed: boolean) =>
    renderStatic(
      createElement(SplitPane, {
        size: 220,
        min: 160,
        max: 400,
        label: "Resize the file tree",
        onResize: noop,
        collapsed,
        first: createElement("p", null, "tree"),
        second: createElement("p", null, "preview"),
      }),
    );

  it("gives the leading column its width, and the window that width plus the handle", () => {
    const html = render(false);
    expect(html).toContain(`style="width:${220 + RESIZE_HANDLE_PX}px"`);
    expect(html).toContain('style="width:220px"');
    expect(html).toContain('aria-valuenow="220"');
    expect(html).toContain('tabindex="0"');
    expect(html.indexOf(">tree<")).toBeLessThan(html.indexOf(">preview<"));
    expect(classTokens(html)).toEqual(expect.arrayContaining(["border-r", "border-line"]));
  });

  it("slides the column shut when collapsed, keeping it mounted but out of reach", () => {
    const html = render(true);
    expect(html).toContain('style="width:0"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("inert");
    expect(html).toContain(">tree<");
  });
});
