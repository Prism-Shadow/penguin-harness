/**
 * The fixed-grid marks (src/components/icons/marks/marks.tsx): the caret and the close cross keep
 * the small grids their two strokes were drawn on, and every mark is decorative.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  CheckIcon,
  ChevronDown,
  CloseIcon,
  DownloadIcon,
  PlusIcon,
  UploadIcon,
} from "../src/components/icons/marks/marks";
import { Chevron } from "../src/components/icons/chevron/chevron";
import { renderStatic } from "../src/testing";

describe("marks", () => {
  it("draw the caret on a 12x12 grid and the close cross on 14x14, at 1.5", () => {
    const caret = renderStatic(createElement(ChevronDown));
    expect(caret).toContain('viewBox="0 0 12 12"');
    expect(caret).toContain('stroke-width="1.5"');
    const cross = renderStatic(createElement(CloseIcon));
    expect(cross).toContain('viewBox="0 0 14 14"');
    expect(cross).toContain('stroke-width="1.5"');
  });

  it("draw the rest on the 24x24 line grid, hidden from assistive technology", () => {
    const marks = [
      createElement(CheckIcon),
      createElement(PlusIcon),
      createElement(DownloadIcon),
      createElement(UploadIcon),
    ];
    for (const mark of marks) {
      const html = renderStatic(mark);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('aria-hidden="true"');
    }
  });

  it("let the plus take a lighter or heavier stroke", () => {
    expect(renderStatic(createElement(PlusIcon, { strokeWidth: 2 }))).toContain('stroke-width="2"');
  });
});

describe("Chevron", () => {
  it("points down when open and rotates only by its transform", () => {
    expect(renderStatic(createElement(Chevron, { open: true }))).toContain("rotate-90");
    const closed = renderStatic(createElement(Chevron, { open: false }));
    expect(closed).not.toContain("rotate-90");
    expect(closed).toContain("transition-transform");
  });
});
