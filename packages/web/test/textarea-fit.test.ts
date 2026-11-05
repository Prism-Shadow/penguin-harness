/**
 * Sizing an auto-growing textarea (lib/textarea-fit.ts): the collapse that measures the box
 * happens with the box's parent held at its height, so the layout the measurement forces is the
 * same outside the parent and a transcript parked at the bottom above a composer is not clamped
 * up by it. Afterwards the box has its new height and the parent its own min-height back.
 */
import { describe, expect, it, vi } from "vitest";
import { fitTextarea } from "../src/lib/textarea-fit";

function fakeBox(parentMinHeight: string | null) {
  const parent =
    parentMinHeight === null ? null : { style: { minHeight: parentMinHeight }, height: "131.52px" };
  const box = { style: { height: "66px" }, scrollHeight: 96, parentElement: parent };
  vi.stubGlobal("getComputedStyle", (el: { height: string }) => ({ height: el.height }));
  return { box: box as unknown as HTMLTextAreaElement, parent };
}

describe("fitTextarea", () => {
  it("measures the collapsed box with its parent held at its height, then releases the hold", () => {
    const { box, parent } = fakeBox("2.5rem");
    const seen: { box: string; parent: string | undefined }[] = [];
    fitTextarea(box, (collapsed) => {
      seen.push({ box: collapsed.style.height, parent: parent?.style.minHeight });
      return Math.min(collapsed.scrollHeight, 176);
    });
    expect(seen).toEqual([{ box: "auto", parent: "131.52px" }]);
    expect(box.style.height).toBe("96px");
    expect(parent?.style.minHeight).toBe("2.5rem");
  });

  it("sizes a box without a parent", () => {
    const { box } = fakeBox(null);
    fitTextarea(box, (collapsed) => collapsed.scrollHeight);
    expect(box.style.height).toBe("96px");
  });
});
