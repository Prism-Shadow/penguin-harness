/**
 * A hosted tab's picture and input (TabView) over a fake CDP session:
 *
 * - The screencast runs while somebody watches, and stops with the last viewer.
 * - Frames are passed on no faster than the cap, each acknowledged as it is passed on.
 * - A viewer holds at most one unsent frame: a newer one replaces it.
 * - Input events become Input.dispatch* calls, pointer coordinates scaled from the frame's
 *   pixels to the page's CSS pixels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedBrowserFrame } from "../../src/api/types.js";
import type { TabSession } from "../../src/builtin-browser/hosted-tabs.js";
import { TabView, jpegSize } from "../../src/builtin-browser/hosted-view.js";
import type { FrameSink } from "../../src/builtin-browser/hosted-view.js";
import { jpeg } from "./fake-cdp.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Sent = { method: string; params: Record<string, unknown> };
type SessionListener = (method: string, params: Record<string, unknown>) => void;

function fakeSession() {
  const sent: Sent[] = [];
  const listeners = new Set<SessionListener>();
  /** Answers every command; a test replaces it. */
  const answers: { of: (method: string, params: Record<string, unknown>) => unknown } = {
    of: () => ({}),
  };
  const session: TabSession = {
    send: async (method, params = {}) => {
      sent.push({ method, params });
      return answers.of(method, params);
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    sent,
    listeners,
    answers,
    session,
    /** Chrome sends frame number `n`; its width tells the frames apart. */
    frame(n: number, size = { width: 100 + n, height: 50 }, page = size): void {
      for (const listener of [...listeners]) {
        listener("Page.screencastFrame", {
          data: jpeg(size.width, size.height),
          sessionId: n,
          metadata: { deviceWidth: page.width, deviceHeight: page.height },
        });
      }
    },
    methods: (): string[] => sent.map((command) => command.method),
    acks: (): unknown[] =>
      sent.filter((c) => c.method === "Page.screencastFrameAck").map((c) => c.params.sessionId),
  };
}

/** A viewer whose writes end at once, or only when the test lets them (`hold`). */
function viewer(hold = false) {
  const frames: number[] = [];
  const releases: (() => void)[] = [];
  const state = {
    /** The widths of the frames written, in order. */
    frames,
    ended: false,
    /** Lets the write under way end. */
    release: () => releases.shift()?.(),
    sink: {
      write: (frame: HostedBrowserFrame) => {
        frames.push(frame.width);
        return hold ? new Promise<void>((resolve) => releases.push(resolve)) : Promise.resolve();
      },
      end: () => {
        state.ended = true;
      },
    } satisfies FrameSink,
  };
  return state;
}

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

describe("the screencast", () => {
  it("starts with the first viewer and stops when the last one leaves", () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    expect(chrome.sent).toEqual([]);

    const leaveA = view.watch(viewer().sink);
    expect(chrome.sent).toEqual([
      { method: "Page.bringToFront", params: {} },
      { method: "Page.startScreencast", params: { format: "jpeg", quality: 70 } },
    ]);
    const leaveB = view.watch(viewer().sink);
    expect(chrome.methods().filter((m) => m === "Page.startScreencast")).toHaveLength(1);

    leaveA();
    expect(chrome.methods()).not.toContain("Page.stopScreencast");
    leaveB();
    expect(chrome.methods().at(-1)).toBe("Page.stopScreencast");
    expect(chrome.listeners.size).toBe(0);
    // Leaving twice changes nothing.
    leaveB();
    expect(chrome.methods().filter((m) => m === "Page.stopScreencast")).toHaveLength(1);

    // Somebody watches again: it starts again.
    view.watch(viewer().sink);
    expect(chrome.methods().filter((m) => m === "Page.startScreencast")).toHaveLength(2);
  });

  it("passes a frame on with its size in pixels, and acknowledges it", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    const written: HostedBrowserFrame[] = [];
    view.watch({ write: async (frame) => void written.push(frame), end: () => {} });
    chrome.frame(1, { width: 640, height: 360 });
    await tick();
    expect(written).toEqual([{ data: jpeg(640, 360), width: 640, height: 360 }]);
    expect(chrome.acks()).toEqual([1]);
  });

  it("passes frames on no faster than the cap, acknowledging each as it goes", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session, { maxFps: 10 });
    const watching = viewer();
    view.watch(watching.sink);

    chrome.frame(1);
    chrome.frame(2);
    await tick();
    // The first goes at once; the second waits its turn, unacknowledged.
    expect(watching.frames).toEqual([101]);
    expect(chrome.acks()).toEqual([1]);
    await tick(99);
    expect(watching.frames).toEqual([101]);
    await tick(1);
    expect(watching.frames).toEqual([101, 102]);
    expect(chrome.acks()).toEqual([1, 2]);

    // A page that repaints every 10 ms for a second is seen ten times, not a hundred.
    const before = watching.frames.length;
    for (let n = 3; n < 103; n++) {
      chrome.frame(n);
      await tick(10);
    }
    const passed = watching.frames.length - before;
    expect(passed).toBeGreaterThanOrEqual(9);
    expect(passed).toBeLessThanOrEqual(10);
    // Every frame Chrome sent was acknowledged or is one of the two still held.
    expect(chrome.acks().length).toBeGreaterThanOrEqual(100);
  });

  it("holds at most one unsent frame per viewer: a newer one replaces it", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session, { maxFps: 100 });
    const slow = viewer(true);
    const fast = viewer();
    view.watch(slow.sink);
    view.watch(fast.sink);

    for (const n of [1, 2, 3]) {
      chrome.frame(n);
      await tick(10);
    }
    // The fast viewer saw all three; the slow one is still writing the first.
    expect(fast.frames).toEqual([101, 102, 103]);
    expect(slow.frames).toEqual([101]);
    slow.release();
    await tick();
    // The second was replaced while it waited: the slow viewer goes straight to the third.
    expect(slow.frames).toEqual([101, 103]);
    slow.release();
    await tick();
    expect(slow.frames).toEqual([101, 103]);
  });

  it("gives somebody who starts watching the latest frame at once", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    view.watch(viewer().sink);
    chrome.frame(1);
    await tick();
    const late = viewer();
    view.watch(late.sink);
    expect(late.frames).toEqual([101]);
  });

  it("drops a viewer whose connection fails, and stops when that was the last", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    view.watch({ write: () => Promise.reject(new Error("closed")), end: () => {} });
    chrome.frame(1);
    await tick();
    expect(view.viewerCount).toBe(0);
    expect(chrome.methods().at(-1)).toBe("Page.stopScreencast");
  });

  it("closes every viewer's connection when the tab is gone, and any later one at once", () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    const a = viewer();
    const b = viewer();
    view.watch(a.sink);
    view.watch(b.sink);
    view.end();
    expect([a.ended, b.ended]).toEqual([true, true]);
    expect(view.viewerCount).toBe(0);
    const late = viewer();
    view.watch(late.sink);
    expect(late.ended).toBe(true);
  });

  it("skips a frame that is not a JPEG, acknowledging it so Chrome sends the next", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    const watching = viewer();
    view.watch(watching.sink);
    for (const listener of chrome.listeners) {
      listener("Page.screencastFrame", { data: "bm90IGEganBlZw==", sessionId: 7, metadata: {} });
    }
    await tick();
    expect(watching.frames).toEqual([]);
    expect(chrome.acks()).toEqual([7]);
  });
});

describe("the page's size", () => {
  it("lays the page out to the viewer's panel, within limits, once per size", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    await view.resize({ width: 900.4, height: 500 });
    await view.resize({ width: 900, height: 500 });
    await view.resize({ width: 10, height: 100_000 });
    expect(chrome.sent).toEqual([
      {
        method: "Emulation.setDeviceMetricsOverride",
        params: { width: 900, height: 500, deviceScaleFactor: 0, mobile: false },
      },
      {
        method: "Emulation.setDeviceMetricsOverride",
        params: { width: 240, height: 2160, deviceScaleFactor: 0, mobile: false },
      },
    ]);
  });
});

describe("input", () => {
  it("scales pointer coordinates from the frame's pixels to the page's CSS pixels", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    view.watch(viewer().sink);
    // A 400×300 picture of a page laid out 800 CSS pixels wide and 600 high.
    chrome.frame(1, { width: 400, height: 300 }, { width: 800, height: 600 });
    await tick();
    chrome.sent.length = 0;

    await view.input([
      { type: "mouse", action: "move", x: 100, y: 50 },
      { type: "mouse", action: "down", x: 100, y: 50, buttons: 1, modifiers: 8 },
      { type: "mouse", action: "up", x: 100, y: 50, button: "right", clickCount: 2 },
      { type: "wheel", x: 10, y: 20, deltaX: 0, deltaY: 120 },
    ]);
    expect(chrome.sent).toEqual([
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseMoved",
          x: 200,
          y: 100,
          button: "none",
          buttons: 0,
          clickCount: 0,
          modifiers: 0,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mousePressed",
          x: 200,
          y: 100,
          button: "left",
          buttons: 1,
          clickCount: 1,
          modifiers: 8,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseReleased",
          x: 200,
          y: 100,
          button: "right",
          buttons: 0,
          clickCount: 2,
          modifiers: 0,
        },
      },
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseWheel", x: 20, y: 40, deltaX: 0, deltaY: 120, modifiers: 0 },
      },
    ]);
  });

  it("leaves coordinates as they are before any frame was seen", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    await view.input([{ type: "mouse", action: "move", x: 30, y: 40 }]);
    expect(chrome.sent[0]?.params).toMatchObject({ x: 30, y: 40 });
  });

  it("turns keys into key events — a press that types as keyDown — and text into insertText", async () => {
    const chrome = fakeSession();
    const view = new TabView(chrome.session);
    await view.input([
      { type: "key", action: "down", key: "a", code: "KeyA", keyCode: 65, text: "a" },
      { type: "key", action: "up", key: "a", code: "KeyA", keyCode: 65 },
      {
        type: "key",
        action: "down",
        key: "ArrowLeft",
        code: "ArrowLeft",
        keyCode: 37,
        repeat: true,
        modifiers: 2,
      },
      { type: "text", text: "你好" },
    ]);
    expect(chrome.sent).toEqual([
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
          text: "a",
          unmodifiedText: "a",
          autoRepeat: false,
          modifiers: 0,
        },
      },
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyUp",
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 65,
          autoRepeat: false,
          modifiers: 0,
        },
      },
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "rawKeyDown",
          key: "ArrowLeft",
          code: "ArrowLeft",
          windowsVirtualKeyCode: 37,
          nativeVirtualKeyCode: 37,
          autoRepeat: true,
          modifiers: 2,
        },
      },
      { method: "Input.insertText", params: { text: "你好" } },
    ]);
  });

  it("goes back and forward through the tab's history, reloads and stops", async () => {
    const chrome = fakeSession();
    chrome.answers.of = (method) =>
      method === "Page.getNavigationHistory"
        ? { currentIndex: 1, entries: [{ id: 11 }, { id: 12 }, { id: 13 }] }
        : {};
    const view = new TabView(chrome.session);
    await view.input([
      { type: "nav", action: "back" },
      { type: "nav", action: "forward" },
      { type: "nav", action: "reload" },
      { type: "nav", action: "stop" },
    ]);
    expect(chrome.sent.filter((c) => c.method !== "Page.getNavigationHistory")).toEqual([
      { method: "Page.navigateToHistoryEntry", params: { entryId: 11 } },
      { method: "Page.navigateToHistoryEntry", params: { entryId: 13 } },
      { method: "Page.reload", params: {} },
      { method: "Page.stopLoading", params: {} },
    ]);

    // Nowhere to go back to: nothing happens.
    chrome.answers.of = () => ({ currentIndex: 0, entries: [{ id: 11 }] });
    chrome.sent.length = 0;
    await view.input([{ type: "nav", action: "back" }]);
    expect(chrome.methods()).toEqual(["Page.getNavigationHistory"]);
  });
});

describe("jpegSize", () => {
  it("reads a JPEG's size, and answers null for anything else", () => {
    expect(jpegSize(jpeg(1280, 800))).toEqual({ width: 1280, height: 800 });
    expect(jpegSize(Buffer.from("not a jpeg").toString("base64"))).toBeNull();
    expect(jpegSize("")).toBeNull();
  });
});
