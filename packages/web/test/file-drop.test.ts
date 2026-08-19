/**
 * Drag-and-drop upload logic (lib/file-drop.ts): what counts as a file drag, what the chat
 * area's drop zone does with one drag event, how a dropped batch splits across the composer's
 * two intakes, and the app-shell guard that cancels the browser's navigate-to-file default.
 *
 * The region decision is the part that earns the tests, because it is where the feature's
 * scope lives: the overlay and the attachment happen only while the drag is over the chat
 * area, and a file released on the sidebar, the top bar or a docked panel must produce no
 * attachments at all — while still being cancelled by the app-wide guard, so the browser does
 * not navigate to the file. Being stateless is the other half: the overlay is re-derived from
 * every event rather than accumulated, so no missed event can strand it on screen.
 */
import { describe, expect, it } from "vitest";
import {
  dropRegionAction,
  guardWindowDragOver,
  guardWindowDrop,
  isFileDrag,
  splitDroppedFiles,
} from "../src/lib/file-drop";
import type { DragGuardEvent, DragSignal } from "../src/lib/file-drop";

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

describe("dropRegionAction", () => {
  const INSIDE = true;
  const OUTSIDE = false;
  const FILES = true;

  it("shows the overlay and claims the drag while a file drag is over the chat area", () => {
    // Claiming (preventDefault) is also what makes the browser deliver a drop here at all.
    expect(dropRegionAction("over", FILES, INSIDE)).toEqual({
      active: true,
      claim: true,
      accept: false,
    });
  });

  it("attaches a file released inside the chat area, and hides the overlay with it", () => {
    expect(dropRegionAction("drop", FILES, INSIDE)).toEqual({
      active: false,
      claim: true,
      accept: true,
    });
  });

  it("takes nothing from a drop outside the chat area — the sidebar, the top bar, a docked panel", () => {
    // The whole point of the region: the app-shell guard still cancels the browser's
    // navigate-to-file for this drop (see the guard tests below), but the composer gets
    // nothing and no overlay was ever shown.
    expect(dropRegionAction("drop", FILES, OUTSIDE)).toEqual({
      active: false,
      claim: false,
      accept: false,
    });
    expect(dropRegionAction("over", FILES, OUTSIDE)).toEqual({
      active: false,
      claim: false,
      accept: false,
    });
  });

  it("ignores non-file drags wherever they are, so native behavior survives", () => {
    // Dragging selected text into the composer, or a sidebar session reorder crossing the
    // chat area: no overlay, and above all no claim — claiming would swallow the text drop.
    const signals: DragSignal[] = ["over", "leave", "drop", "end"];
    for (const signal of signals) {
      expect(dropRegionAction(signal, false, INSIDE)).toEqual({
        active: false,
        claim: false,
        accept: false,
      });
    }
  });

  it("keeps the overlay up when a dragleave only crossed into a child element", () => {
    // dragleave fires for every element boundary; `inside` is the RELATED target, so a leave
    // heading somewhere still inside the region changes nothing.
    expect(dropRegionAction("leave", FILES, INSIDE).active).toBe(true);
  });

  it("hides the overlay when the drag leaves the region or the window", () => {
    // Leaving for the sidebar, and leaving the window entirely (relatedTarget null → outside)
    // are the same answer.
    expect(dropRegionAction("leave", FILES, OUTSIDE).active).toBe(false);
    // A dragleave is never claimed — there is nothing to allow or cancel about a departure.
    expect(dropRegionAction("leave", FILES, INSIDE).claim).toBe(false);
  });

  it("ends the overlay on dragend whatever the drag was", () => {
    expect(dropRegionAction("end", FILES, INSIDE)).toEqual({
      active: false,
      claim: false,
      accept: false,
    });
  });

  it("is a pure function of the current event, so no missed event can strand the overlay", () => {
    // The regression this replaces: a dragenter/dragleave depth counter drifts permanently
    // out of balance if one dragleave is missed (a drag that ends outside the browser fires
    // neither drop nor dragend), leaving the overlay stuck. Here the answer never depends on
    // history — a lone "over" inside is enough to show it, a lone one outside to hide it,
    // in any order and any number of times.
    const replay: DragSignal[] = ["leave", "leave", "over", "drop", "leave", "end", "over"];
    for (const signal of replay) {
      expect(dropRegionAction(signal, FILES, INSIDE).active).toBe(
        signal !== "drop" && signal !== "end",
      );
    }
    expect(dropRegionAction("over", FILES, INSIDE).active).toBe(true);
    expect(dropRegionAction("over", FILES, OUTSIDE).active).toBe(false);
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
  it("cancels a file drag outside the chat area: no-drop cursor, no navigation, nothing attached", () => {
    // The deliberate remainder of scoping the zone down: dropping a file on the sidebar must
    // do NOTHING — not open the file in the tab, which is the browser's default and would
    // discard the running app. Silent by design: this path has no overlay and no toast.
    const over = guardEvent(["Files"]);
    guardWindowDragOver(over);
    expect(over.prevented).toBe(true);
    expect(over.dataTransfer?.dropEffect).toBe("none");
    const drop = guardEvent(["Files"]);
    guardWindowDrop(drop);
    expect(drop.prevented).toBe(true);
    // And the region agrees the composer gets nothing from it.
    expect(dropRegionAction("drop", true, false).accept).toBe(false);
  });

  it("stands aside when the chat area already claimed the drag (defaultPrevented)", () => {
    // The two are window listeners in registration order, so the guard must not overwrite the
    // zone's copy cursor with its no-drop one when it happens to run second.
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
