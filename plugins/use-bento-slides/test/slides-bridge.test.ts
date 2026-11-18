// A deck opened from a LAN address needs an independent editor token even without randomUUID.
// Editor and presentation save controls commit active text before requesting a workbench save.
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureSave, connectSave, editorToken } from "../workbenches/slides/ui/bridge.js";

it("creates a new frame token on HTTP hosts that only offer getRandomValues", () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal("crypto", { getRandomValues });
  try {
    const first = editorToken();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(editorToken()).not.toBe(first);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("saving from an embedded Bento editor or presentation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["ctrlKey", "metaKey"])(
    "commits active text before requesting a save with %s",
    (modifier) => {
      const events = new EventTarget();
      const changes: string[] = [];
      vi.stubGlobal("window", events);
      vi.stubGlobal("document", {
        activeElement: { isContentEditable: true, blur: () => changes.push("commit") },
      });
      vi.stubGlobal("parent", {
        postMessage: (message: { type: string; token: string }) =>
          changes.push(message.type + "/" + message.token),
      });
      connectSave("open-deck", captureSave, "Save");
      const key = Object.assign(new Event("keydown", { cancelable: true }), {
        key: "s",
        [modifier]: true,
      });
      expect(events.dispatchEvent(key)).toBe(false);
      expect(changes).toEqual(["commit", "save/open-deck"]);
      const saveAs = Object.assign(new Event("keydown", { cancelable: true }), {
        key: "S",
        shiftKey: true,
        [modifier]: true,
      });
      expect(events.dispatchEvent(saveAs)).toBe(true);
      expect(changes).toHaveLength(2);
    },
  );

  it("intercepts the embedded file-save button alone", () => {
    const event = (dirty: boolean) => ({
      type: "click",
      target: {
        closest: (name: string) =>
          name === "button"
            ? { querySelector: (selector: string) => dirty && selector === ".ed-dirty" }
            : null,
      },
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    });
    const save = event(true);
    expect(captureSave(save)).toBe(true);
    expect(save.preventDefault).toHaveBeenCalledOnce();
    const other = event(false);
    expect(captureSave(other)).toBe(false);
    expect(other.preventDefault).not.toHaveBeenCalled();
  });
});
