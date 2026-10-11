/**
 * The viewer's input in a hosted tab's picture, as the events its server takes
 * (features/builtin-browser/hosted-input.ts):
 *
 * - A pointer position on screen becomes a position in the frame's own pixels, through the box
 *   the frame is drawn in (scaled to fit, centred); a position outside the picture is held to
 *   its edge.
 * - Mouse, wheel and key events carry CDP's modifier bits; a press names its button and counts
 *   its clicks, a move names none.
 * - A key that types carries its character, Enter a carriage return, a shortcut none; a key an
 *   input method composes with is not sent, and the committed text is inserted as text.
 * - Every press is paired with a release: what is still down is released on demand.
 * - The queue folds runs of moves and of wheels, keeps everything else in order, and hands out
 *   at most one request's worth at a time.
 */
import { describe, expect, it } from "vitest";
import type { HostedBrowserInputEvent } from "@prismshadow/penguin-server/api";
import {
  HeldInput,
  InputQueue,
  MAX_INPUT_BATCH,
  frameBox,
  framePoint,
  isPasteKey,
  keyInput,
  modifierBits,
  mouseInput,
  textInput,
  viewportOf,
  wheelInput,
  type KeyLike,
  type MouseLike,
} from "../src/features/builtin-browser/hosted-input";

const NO_KEYS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

const mouse = (over: Partial<MouseLike> = {}): MouseLike => ({
  ...NO_KEYS,
  button: 0,
  buttons: 0,
  detail: 0,
  ...over,
});

const key = (name: string, over: Partial<KeyLike> = {}): KeyLike => ({
  ...NO_KEYS,
  key: name,
  code: name.length === 1 ? `Key${name.toUpperCase()}` : name,
  keyCode: name.length === 1 ? name.toUpperCase().charCodeAt(0) : 0,
  repeat: false,
  isComposing: false,
  ...over,
});

describe("the panel's size as the page's viewport", () => {
  it("is whole CSS pixels, and none while the panel has no area", () => {
    expect(viewportOf({ width: 799.6, height: 600.2 })).toEqual({ width: 800, height: 600 });
    expect(viewportOf({ width: 0, height: 600 })).toBeNull();
    expect(viewportOf({ width: 800, height: 0.2 })).toBeNull();
  });
});

describe("from the element to the frame's pixels", () => {
  const element = { left: 100, top: 50, width: 800, height: 600 };

  it("maps one to one when the frame is the element's size", () => {
    const frame = { width: 800, height: 600 };
    expect(frameBox(element, frame)).toEqual(element);
    expect(framePoint({ x: 100, y: 50 }, element, frame)).toEqual({ x: 0, y: 0 });
    expect(framePoint({ x: 500, y: 350 }, element, frame)).toEqual({ x: 400, y: 300 });
  });

  it("scales when the frame has more pixels than the element", () => {
    const frame = { width: 1600, height: 1200 };
    expect(framePoint({ x: 300, y: 200 }, element, frame)).toEqual({ x: 400, y: 300 });
  });

  it("accounts for the bars beside a frame of another shape", () => {
    // A 400×600 frame in an 800×600 element is drawn 400 wide, centred: 200 px bars on each side.
    const frame = { width: 400, height: 600 };
    expect(frameBox(element, frame)).toEqual({ left: 300, top: 50, width: 400, height: 600 });
    expect(framePoint({ x: 300, y: 50 }, element, frame)).toEqual({ x: 0, y: 0 });
    expect(framePoint({ x: 500, y: 350 }, element, frame)).toEqual({ x: 200, y: 300 });
  });

  it("holds a position outside the picture to its edge", () => {
    const frame = { width: 800, height: 600 };
    expect(framePoint({ x: 0, y: 0 }, element, frame)).toEqual({ x: 0, y: 0 });
    expect(framePoint({ x: 5000, y: 5000 }, element, frame)).toEqual({ x: 799, y: 599 });
  });

  it("answers the origin while there is no frame or no area", () => {
    expect(framePoint({ x: 10, y: 10 }, element, { width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
    const flat = { left: 0, top: 0, width: 0, height: 0 };
    expect(framePoint({ x: 10, y: 10 }, flat, { width: 800, height: 600 })).toEqual({ x: 0, y: 0 });
  });
});

describe("modifier bits", () => {
  it("are CDP's: Alt 1, Ctrl 2, Meta 4, Shift 8", () => {
    expect(modifierBits(NO_KEYS)).toBe(0);
    expect(modifierBits({ ...NO_KEYS, altKey: true })).toBe(1);
    expect(modifierBits({ ...NO_KEYS, ctrlKey: true })).toBe(2);
    expect(modifierBits({ ...NO_KEYS, metaKey: true })).toBe(4);
    expect(modifierBits({ ...NO_KEYS, shiftKey: true })).toBe(8);
    expect(modifierBits({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15);
  });
});

describe("mouse and wheel", () => {
  const at = { x: 40, y: 30 };

  it("names the button and counts the clicks of a press and its release", () => {
    expect(mouseInput("down", mouse({ buttons: 1, detail: 1 }), at)).toEqual({
      type: "mouse",
      action: "down",
      x: 40,
      y: 30,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    });
    const second = mouseInput("down", mouse({ buttons: 1, detail: 2, shiftKey: true }), at);
    expect(second).toMatchObject({ clickCount: 2, modifiers: 8 });
    expect(mouseInput("up", mouse({ button: 2, buttons: 0, detail: 1 }), at)).toMatchObject({
      action: "up",
      button: "right",
      buttons: 0,
      clickCount: 1,
    });
    expect(mouseInput("down", mouse({ button: 1, buttons: 4 }), at)).toMatchObject({
      button: "middle",
      clickCount: 1,
    });
  });

  it("names no button and counts no click for a move, and keeps the buttons held", () => {
    expect(mouseInput("move", mouse({ buttons: 1, detail: 1 }), at)).toMatchObject({
      action: "move",
      button: "none",
      buttons: 1,
      clickCount: 0,
    });
  });

  it("gives the wheel's deltas in pixels, whatever unit the device reported", () => {
    const frame = { width: 800, height: 600 };
    const wheel = (deltaMode: number) =>
      wheelInput({ ...NO_KEYS, ctrlKey: true, deltaX: 1, deltaY: 3, deltaMode }, at, frame);
    expect(wheel(0)).toEqual({ type: "wheel", x: 40, y: 30, deltaX: 1, deltaY: 3, modifiers: 2 });
    expect(wheel(1)).toMatchObject({ deltaX: 16, deltaY: 48 });
    expect(wheel(2)).toMatchObject({ deltaX: 600, deltaY: 1800 });
  });
});

describe("keys and text", () => {
  it("sends a typing key with its character, and its release without", () => {
    expect(keyInput("down", key("a"))).toEqual({
      type: "key",
      action: "down",
      key: "a",
      code: "KeyA",
      keyCode: 65,
      text: "a",
      modifiers: 0,
    });
    expect(keyInput("up", key("a"))).toEqual({
      type: "key",
      action: "up",
      key: "a",
      code: "KeyA",
      keyCode: 65,
      modifiers: 0,
    });
    expect(keyInput("down", key("A", { shiftKey: true }))).toMatchObject({
      text: "A",
      modifiers: 8,
    });
  });

  it("types a carriage return for Enter, and nothing for a key that types nothing", () => {
    expect(keyInput("down", key("Enter", { keyCode: 13 }))).toMatchObject({ text: "\r" });
    expect(keyInput("down", key("ArrowLeft", { keyCode: 37 }))).not.toHaveProperty("text");
    expect(keyInput("down", key("Tab", { keyCode: 9 }))).not.toHaveProperty("text");
  });

  it("types nothing for a shortcut, and still types through AltGr", () => {
    expect(keyInput("down", key("a", { ctrlKey: true }))).not.toHaveProperty("text");
    expect(keyInput("down", key("a", { metaKey: true }))).not.toHaveProperty("text");
    expect(keyInput("down", key("@", { ctrlKey: true, altKey: true }))).toMatchObject({
      text: "@",
      modifiers: 3,
    });
  });

  it("marks a held key's repeats, on the press only", () => {
    expect(keyInput("down", key("a", { repeat: true }))).toMatchObject({ repeat: true });
    expect(keyInput("up", key("a", { repeat: true }))).not.toHaveProperty("repeat");
  });

  it("leaves a key to the input method while it composes", () => {
    expect(keyInput("down", key("a", { isComposing: true }))).toBeNull();
    expect(keyInput("down", key("Process", { keyCode: 229 }))).toBeNull();
    expect(keyInput("up", key("a", { keyCode: 229 }))).toBeNull();
  });

  it("knows the paste chord, which the browser runs itself", () => {
    expect(isPasteKey(key("v", { ctrlKey: true }))).toBe(true);
    expect(isPasteKey(key("V", { metaKey: true, shiftKey: true }))).toBe(true);
    expect(isPasteKey(key("v"))).toBe(false);
    expect(isPasteKey(key("v", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPasteKey(key("c", { ctrlKey: true }))).toBe(false);
  });

  it("inserts committed or pasted text as text, and nothing for none", () => {
    expect(textInput("你好")).toEqual({ type: "text", text: "你好" });
    expect(textInput("")).toBeNull();
  });
});

describe("what is still down", () => {
  it("is released on demand: buttons where the pointer last was, then keys", () => {
    const held = new HeldInput();
    const shift = keyInput(
      "down",
      key("Shift", { code: "ShiftLeft", keyCode: 16, shiftKey: true }),
    )!;
    held.track(shift);
    held.track(mouseInput("down", mouse({ buttons: 1, detail: 1 }), { x: 10, y: 10 }));
    held.track(mouseInput("move", mouse({ buttons: 1 }), { x: 60, y: 70 }));
    expect(held.dragging).toBe(true);
    expect(held.releaseAll()).toEqual([
      {
        type: "mouse",
        action: "up",
        x: 60,
        y: 70,
        button: "left",
        buttons: 0,
        clickCount: 1,
        modifiers: 0,
      },
      { type: "key", action: "up", key: "Shift", code: "ShiftLeft", keyCode: 16, modifiers: 0 },
    ]);
    expect(held.dragging).toBe(false);
    expect(held.releaseAll()).toEqual([]);
  });

  it("owes nothing for what was already released", () => {
    const held = new HeldInput();
    held.track(keyInput("down", key("a"))!);
    held.track(keyInput("up", key("a"))!);
    held.track(mouseInput("down", mouse({ button: 2, buttons: 2, detail: 1 }), { x: 1, y: 1 }));
    held.track(mouseInput("up", mouse({ button: 2, buttons: 0, detail: 1 }), { x: 1, y: 1 }));
    expect(held.dragging).toBe(false);
    expect(held.releaseAll()).toEqual([]);
  });
});

describe("the queue of unsent input", () => {
  const move = (x: number, buttons = 0): HostedBrowserInputEvent =>
    mouseInput("move", mouse({ buttons }), { x, y: 0 });
  const down = mouseInput("down", mouse({ buttons: 1, detail: 1 }), { x: 5, y: 0 });
  const wheel = (deltaY: number): HostedBrowserInputEvent =>
    wheelInput(
      { ...NO_KEYS, deltaX: 0, deltaY, deltaMode: 0 },
      { x: 0, y: 0 },
      { width: 1, height: 1 },
    );

  it("folds a run of moves into the last one", () => {
    const queue = new InputQueue();
    for (let x = 0; x < 50; x++) queue.push(move(x));
    expect(queue.size).toBe(1);
    expect(queue.take()).toEqual([move(49)]);
    expect(queue.size).toBe(0);
  });

  it("keeps a press between the moves around it, and a drag's moves apart from a hover's", () => {
    const queue = new InputQueue();
    queue.push(move(1));
    queue.push(move(2));
    queue.push(down);
    queue.push(move(3, 1));
    queue.push(move(4, 1));
    queue.push(move(5));
    expect(queue.take()).toEqual([move(2), down, move(4, 1), move(5)]);
  });

  it("adds up a run of wheels", () => {
    const queue = new InputQueue();
    queue.push(wheel(10));
    queue.push(wheel(15));
    queue.push(wheel(-5));
    expect(queue.take()).toEqual([wheel(20)]);
  });

  it("hands out one request's worth at a time, oldest first", () => {
    const queue = new InputQueue();
    const keys = Array.from({ length: MAX_INPUT_BATCH + 20 }, (_, i) =>
      keyInput(i % 2 === 0 ? "down" : "up", key("a"))!,
    );
    for (const event of keys) queue.push(event);
    expect(queue.take()).toEqual(keys.slice(0, MAX_INPUT_BATCH));
    expect(queue.take()).toEqual(keys.slice(MAX_INPUT_BATCH));
    expect(queue.take()).toEqual([]);
  });

  it("forgets everything when cleared", () => {
    const queue = new InputQueue();
    queue.push(down);
    queue.clear();
    expect(queue.size).toBe(0);
  });
});
