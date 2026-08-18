/**
 * Drag-and-drop upload logic (lib/file-drop.ts): what counts as a file drag, the overlay's
 * drag-depth machine, how a dropped batch splits across the composer's two intakes, and the
 * app-shell guard that cancels the browser's navigate-to-file default.
 *
 * The depth machine is the part that earns the tests: dragenter/dragleave fire for every
 * element boundary crossed, so the naive boolean flickers the overlay off inside the window,
 * and an unpaired leave (browsers drop one occasionally) must not strand it visible or drive
 * the counter negative.
 */
import { describe, expect, it } from "vitest";
import {
  guardWindowDragOver,
  guardWindowDrop,
  isFileDrag,
  nextDragDepth,
  splitDroppedFiles,
} from "../src/lib/file-drop";
import type { DragGuardEvent } from "../src/lib/file-drop";

describe("isFileDrag", () => {
  it("recognizes an OS file drag by the Files type, alone or among others", () => {
    expect(isFileDrag(["Files"])).toBe(true);
    // Chrome lists extra types alongside Files for some sources.
    expect(isFileDrag(["text/uri-list", "Files"])).toBe(true);
  });

  it("ignores every non-file drag: text selections, links, in-app drags", () => {
    expect(isFileDrag(["text/plain"])).toBe(false);
    expect(isFileDrag(["text/uri-list", "text/html"])).toBe(false);
    // The sidebar's session reorder uses a private MIME precisely so nothing else reacts.
    expect(isFileDrag(["application/x-penguin-session-id"])).toBe(false);
    expect(isFileDrag([])).toBe(false);
  });

  it("treats a missing dataTransfer (null/undefined types) as not a file drag", () => {
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag(undefined)).toBe(false);
  });
});

describe("nextDragDepth", () => {
  it("counts nested enter/leave pairs so internal boundary crossings keep the overlay up", () => {
    // Enter the window, then cross into a child (enter fires before the parent's leave).
    let depth = nextDragDepth(0, "enter", true);
    expect(depth).toBe(1);
    depth = nextDragDepth(depth, "enter", true);
    expect(depth).toBe(2);
    depth = nextDragDepth(depth, "leave", true);
    expect(depth).toBe(1); // still over the window → overlay stays
    depth = nextDragDepth(depth, "leave", true);
    expect(depth).toBe(0); // genuinely left the window → overlay hides
  });

  it("never moves for a non-file drag, in either direction", () => {
    expect(nextDragDepth(0, "enter", false)).toBe(0);
    expect(nextDragDepth(2, "enter", false)).toBe(2);
    expect(nextDragDepth(2, "leave", false)).toBe(2);
  });

  it("clamps at 0 on an unpaired leave instead of going negative", () => {
    // A negative depth would make the NEXT drag's first enter land on 0 → overlay never shows.
    expect(nextDragDepth(0, "leave", true)).toBe(0);
  });

  it("drop and dragend reset outright, recovering from any missed dragleave", () => {
    expect(nextDragDepth(3, "drop", true)).toBe(0);
    expect(nextDragDepth(3, "end", true)).toBe(0);
    // Reset is unconditional — it ends the whole drag, whatever the event's own types said.
    expect(nextDragDepth(3, "drop", false)).toBe(0);
  });
});

describe("splitDroppedFiles", () => {
  it("routes by MIME type: image/* to the image intake, everything else to attachments", () => {
    const png = { type: "image/png", name: "a.png" };
    const pdf = { type: "application/pdf", name: "b.pdf" };
    const svg = { type: "image/svg+xml", name: "c.svg" };
    const none = { type: "", name: "Makefile" }; // OS gives some files no MIME type at all
    const { images, files } = splitDroppedFiles([png, pdf, svg, none]);
    expect(images).toEqual([png, svg]);
    expect(files).toEqual([pdf, none]);
  });

  it("keeps drop order within each intake and handles an empty batch", () => {
    const a = { type: "text/plain" };
    const b = { type: "application/zip" };
    expect(splitDroppedFiles([a, b]).files).toEqual([a, b]);
    expect(splitDroppedFiles([])).toEqual({ images: [], files: [] });
  });
});

/** A window-level guard event: `types` = the drag's payload, null = no dataTransfer at all. */
function guardEvent(
  types: readonly string[] | null,
  defaultPrevented = false,
): DragGuardEvent & { prevented: boolean } {
  return {
    defaultPrevented,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    dataTransfer: types === null ? null : { types, dropEffect: "copy" },
  };
}

describe("app-shell drop guard", () => {
  it("cancels an unclaimed file drag: no-drop cursor on dragover, no navigation on drop", () => {
    const over = guardEvent(["Files"]);
    guardWindowDragOver(over);
    expect(over.prevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe("none");
    const drop = guardEvent(["Files"]);
    guardWindowDrop(drop);
    expect(drop.prevented).toBe(true);
  });

  it("stands aside when a drop zone already claimed the drag (defaultPrevented)", () => {
    // The composer's FileDropZone claimed it: the guard must not overwrite its copy cursor.
    const over = guardEvent(["Files"], true);
    guardWindowDragOver(over);
    expect(over.prevented).toBe(false);
    expect(over.dataTransfer?.dropEffect).toBe("copy");
    const drop = guardEvent(["Files"], true);
    guardWindowDrop(drop);
    expect(drop.prevented).toBe(false);
  });

  it("leaves non-file drags to their native behavior (text drops into the composer)", () => {
    const over = guardEvent(["text/plain"]);
    guardWindowDragOver(over);
    expect(over.prevented).toBe(false);
    expect(over.dataTransfer?.dropEffect).toBe("copy");
    const drop = guardEvent(["text/plain"]);
    guardWindowDrop(drop);
    expect(drop.prevented).toBe(false);
    // No dataTransfer at all: nothing to judge, nothing to cancel.
    const bare = guardEvent(null);
    guardWindowDragOver(bare);
    guardWindowDrop(bare);
    expect(bare.prevented).toBe(false);
  });
});
