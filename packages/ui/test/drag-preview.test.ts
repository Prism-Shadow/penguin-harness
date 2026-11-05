/**
 * The drag image every draggable row hands the browser
 * (src/components/overlays/drag-preview/drag-preview.ts): a copy of the row in an opaque chip
 * painted in tokens, at the row's width, offset by the pointer's place in the row, gone a task
 * later. The suite has no DOM, so the helper runs against a few stand-in nodes that record what
 * it does; the rows that drag are held to calling it against their source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DRAG_PREVIEW_CLASS,
  setDragPreview,
} from "../src/components/overlays/drag-preview/drag-preview";
import type { DragStartLike } from "../src/components/overlays/drag-preview/drag-preview";
import { SRC_DIR, WEB_DIR } from "./helpers/paths";

/** A stand-in element: attributes, children, a box, and what `setDragPreview` reads and writes. */
class FakeNode {
  readonly attributes = new Map<string, string>();
  readonly children: FakeNode[] = [];
  parent: FakeNode | null = null;
  className = "";
  readonly style: Record<string, string> = {};
  readonly clientLeft = 1;
  constructor(readonly ownerDocument: FakeDoc) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  append(child: FakeNode) {
    child.parent = this;
    this.children.push(child);
  }
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  cloneNode(): FakeNode {
    const copy = new FakeNode(this.ownerDocument);
    copy.className = this.className;
    for (const [name, value] of this.attributes) copy.setAttribute(name, value);
    for (const child of this.children) copy.append(child.cloneNode());
    return copy;
  }
  /** Every descendant: the helper asks only for the ones with an id or a test id. */
  querySelectorAll(): FakeNode[] {
    return this.children.flatMap((child) => [child, ...child.querySelectorAll()]);
  }
  getBoundingClientRect() {
    return { left: 100, top: 40, width: 240, height: 32 };
  }
}

class FakeDoc {
  readonly body: FakeNode = new FakeNode(this);
  readonly defaultView = {
    getComputedStyle: () => ({
      fontFamily: "MiSans",
      fontSize: "15px",
      lineHeight: "22px",
      letterSpacing: "normal",
    }),
  };
  createElement() {
    return new FakeNode(this);
  }
}

function dragFrom(row: FakeNode) {
  const setDragImage = vi.fn();
  const event = {
    dataTransfer: { setDragImage },
    clientX: 130,
    clientY: 52,
    currentTarget: row,
  } as unknown as DragStartLike;
  return { event, setDragImage };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setDragPreview", () => {
  it("lends the drag a copy of the row in a themed chip, at the pointer's place in the row", () => {
    vi.useFakeTimers();
    const doc = new FakeDoc();
    const row = new FakeNode(doc);
    row.setAttribute("id", "row-1");
    const button = new FakeNode(doc);
    button.setAttribute("data-testid", "session-row");
    row.append(button);
    const { event, setDragImage } = dragFrom(row);

    setDragPreview(event);

    const chip = doc.body.children[0]!;
    expect(chip.className).toBe(DRAG_PREVIEW_CLASS);
    expect(chip.attributes.get("aria-hidden")).toBe("true");
    expect(chip.attributes.has("inert")).toBe(true);
    expect(chip.style).toMatchObject({ width: "240px", fontSize: "15px", fontFamily: "MiSans" });
    // The pointer sits 30 × 12 into the row; the chip's 1px line moves it as far again.
    expect(setDragImage).toHaveBeenCalledWith(chip, 31, 13);
    // The copy is the row, its ids and test ids dropped; the row itself is untouched.
    const copy = chip.children[0]!;
    expect(copy.attributes.has("id")).toBe(false);
    expect(copy.children[0]!.attributes.has("data-testid")).toBe(false);
    expect(row.attributes.get("id")).toBe("row-1");

    vi.runAllTimers();
    expect(doc.body.children).toEqual([]);
  });

  it("paints the chip in tokens, opaque and without a shadow", () => {
    const classes = DRAG_PREVIEW_CLASS.split(" ");
    expect(classes).toEqual(
      expect.arrayContaining(["bg-overlay", "border", "border-line", "rounded-md", "text-fg"]),
    );
    expect(classes.filter((c) => c.startsWith("shadow") || c.includes("/"))).toEqual([]);
  });

  it("is what every row that drags hands the browser, for its own drag only", () => {
    const sources = [
      join(SRC_DIR, "components/shell/sidebar-frame/sidebar-frame.tsx"),
      join(SRC_DIR, "components/shell/session-row/session-row.tsx"),
      join(SRC_DIR, "components/navigation/group-header/group-header.tsx"),
    ];
    for (const path of sources) {
      expect(readFileSync(path, "utf8"), path).toContain(
        "if (e.target === e.currentTarget) setDragPreview(e);",
      );
    }
    // The Models page's group header returns early from a drag that is not its own.
    const models = readFileSync(join(WEB_DIR, "src/features/models/models-page.tsx"), "utf8");
    expect(models).toMatch(
      /if \(e\.target !== e\.currentTarget\) return;[\s\S]{0,400}setDragPreview\(e\);/,
    );
  });
});
