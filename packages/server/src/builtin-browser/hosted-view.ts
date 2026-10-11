/**
 * What a person sees of a hosted tab, and what they do to it: the tab's picture as a stream of
 * JPEG frames (CDP's screencast), and their mouse, wheel and keyboard turned into CDP input.
 * One TabView per tab, shared by everyone watching it.
 *
 * The picture:
 *
 * - The screencast runs only while somebody watches: the first viewer starts it (bringing the
 *   tab to the front of its window, since a hidden tab paints nothing), the last one to leave
 *   stops it. Chrome sends a frame when the page changes and none while it is still.
 * - Frames are passed on no faster than `maxFps`. A frame is acknowledged to Chrome when it is
 *   passed on, and Chrome sends no more than a couple unacknowledged, so the cap holds back the
 *   encoder too.
 * - A viewer holds at most one frame it has not been sent yet: while a write is under way a
 *   newer frame replaces the one waiting. A slow connection sees fewer frames, never stale ones.
 * - Somebody who starts watching gets the latest frame at once, however still the page is.
 *
 * The input: pointer coordinates arrive in the pixels of the frame on screen and are scaled to
 * the page's CSS pixels by the frame's own measure of the page.
 */
import type {
  HostedBrowserFrame,
  HostedBrowserInputEvent,
  HostedBrowserViewport,
} from "../api/types.js";
import type { TabSession } from "./hosted-tabs.js";

/** Where a viewer's frames go: one event-stream connection. */
export interface FrameSink {
  /** Resolves once the frame is written; a rejection ends this viewer. */
  write(frame: HostedBrowserFrame): Promise<void>;
  /** The view is over (the tab closed, Chrome exited): close the connection. */
  end(): void;
}

export interface TabViewOptions {
  /** The most frames a second passed on to the viewers. */
  maxFps?: number;
  /** The JPEG quality asked of Chrome, 0–100. */
  quality?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export const DEFAULT_VIEW_MAX_FPS = 15;
const DEFAULT_QUALITY = 70;
/** Starting and stopping the screencast, and each input event: a page answers these at once. */
const VIEW_TIMEOUT_MS = 5_000;
/** The frames held for their turn; Chrome keeps no more than this unacknowledged. */
const MAX_QUEUED_FRAMES = 2;
/** The page sizes a viewer may ask for, in CSS pixels. */
const VIEWPORT_LIMITS = { minWidth: 240, maxWidth: 3840, minHeight: 160, maxHeight: 2160 };

interface Viewer {
  sink: FrameSink;
  /** The frame to send once the write under way ends. */
  waiting: HostedBrowserFrame | null;
  writing: boolean;
}

interface QueuedFrame {
  frame: HostedBrowserFrame;
  /** Chrome's id for the frame, to acknowledge it by. */
  ack: number;
  /** The page's size in CSS pixels as this frame shows it. */
  page: { width: number; height: number };
}

/**
 * A JPEG's size in pixels, read from the start-of-frame marker in the beginning of its base64
 * text; null when that is not a JPEG's.
 */
export function jpegSize(base64: string): { width: number; height: number } | null {
  const bytes = Buffer.from(base64.slice(0, 8192), "base64");
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    // SOF0–SOF15, except the three in that range that are tables, not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  return null;
}

const CDP_MOUSE = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;

export class TabView {
  private readonly viewers = new Set<Viewer>();
  private readonly intervalMs: number;
  private readonly quality: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly queue: QueuedFrame[] = [];
  private pumpTimer: NodeJS.Timeout | null = null;
  private passedAt = Number.NEGATIVE_INFINITY;
  /** The frame passed on last, for a viewer who arrives while the page is still. */
  private latest: HostedBrowserFrame | null = null;
  /** CSS pixels per frame pixel, by the last frame; 1 before the first. */
  private scale = { x: 1, y: 1 };
  private viewport: HostedBrowserViewport | null = null;
  private unlisten: (() => void) | null = null;
  private ended = false;

  constructor(
    private readonly session: TabSession,
    opts: TabViewOptions = {},
  ) {
    this.intervalMs = 1000 / (opts.maxFps ?? DEFAULT_VIEW_MAX_FPS);
    this.quality = opts.quality ?? DEFAULT_QUALITY;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  /** Starts sending the tab's frames to `sink`; the call returned ends it. */
  watch(sink: FrameSink): () => void {
    if (this.ended) {
      sink.end();
      return () => {};
    }
    const viewer: Viewer = { sink, waiting: null, writing: false };
    this.viewers.add(viewer);
    if (this.viewers.size === 1) this.startScreencast();
    else if (this.latest !== null) this.deliver(viewer, this.latest);
    return () => this.leave(viewer);
  }

  /** Lays the page out to the viewer's panel; the last size asked for is the one that stands. */
  async resize(viewport: HostedBrowserViewport): Promise<void> {
    const width = clamp(viewport.width, VIEWPORT_LIMITS.minWidth, VIEWPORT_LIMITS.maxWidth);
    const height = clamp(viewport.height, VIEWPORT_LIMITS.minHeight, VIEWPORT_LIMITS.maxHeight);
    if (this.viewport?.width === width && this.viewport.height === height) return;
    await this.session.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 0, mobile: false },
      VIEW_TIMEOUT_MS,
    );
    this.viewport = { width, height };
  }

  /** Applies a batch of the viewer's input events, in order. */
  async input(events: readonly HostedBrowserInputEvent[]): Promise<void> {
    for (const event of events) await this.dispatch(event);
  }

  /** The tab is gone: every viewer's connection is closed. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.unlisten?.();
    this.unlisten = null;
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.queue.length = 0;
    this.latest = null;
    for (const viewer of [...this.viewers]) {
      this.viewers.delete(viewer);
      viewer.sink.end();
    }
  }

  // --- the picture ---------------------------------------------------------------

  private startScreencast(): void {
    this.unlisten = this.session.onEvent((method, params) => {
      if (method === "Page.screencastFrame") this.onFrame(params);
    });
    this.command("Page.bringToFront", {});
    this.command("Page.startScreencast", { format: "jpeg", quality: this.quality });
  }

  private leave(viewer: Viewer): void {
    if (!this.viewers.delete(viewer) || this.viewers.size > 0 || this.ended) return;
    this.unlisten?.();
    this.unlisten = null;
    if (this.pumpTimer !== null) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
    this.queue.length = 0;
    this.latest = null;
    this.command("Page.stopScreencast", {});
  }

  /** A command whose failure changes nothing here (the tab is closing, Chrome is going away). */
  private command(method: string, params: Record<string, unknown>): void {
    this.session.send(method, params, VIEW_TIMEOUT_MS).catch((err: unknown) => {
      this.log(`hosted browser: ${method} failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  private onFrame(params: Record<string, unknown>): void {
    const { data, sessionId, metadata } = params;
    if (typeof data !== "string" || typeof sessionId !== "number") return;
    const size = jpegSize(data);
    if (size === null || size.width === 0 || size.height === 0) {
      this.command("Page.screencastFrameAck", { sessionId });
      return;
    }
    const measured = (metadata ?? {}) as { deviceWidth?: unknown; deviceHeight?: unknown };
    const pageWidth = typeof measured.deviceWidth === "number" ? measured.deviceWidth : size.width;
    const pageHeight =
      typeof measured.deviceHeight === "number" ? measured.deviceHeight : size.height;
    this.queue.push({
      frame: { data, width: size.width, height: size.height },
      ack: sessionId,
      page: { width: pageWidth, height: pageHeight },
    });
    // More than Chrome should have sent unacknowledged: the oldest gives way.
    while (this.queue.length > MAX_QUEUED_FRAMES) {
      this.command("Page.screencastFrameAck", { sessionId: this.queue.shift()!.ack });
    }
    this.pump();
  }

  /** Passes the queued frames on, one per interval. */
  private pump(): void {
    if (this.pumpTimer !== null) return;
    const next = this.queue[0];
    if (next === undefined) return;
    const wait = this.passedAt + this.intervalMs - this.now();
    if (wait > 0) {
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = null;
        this.pump();
      }, wait);
      this.pumpTimer.unref?.();
      return;
    }
    this.queue.shift();
    this.passedAt = this.now();
    this.command("Page.screencastFrameAck", { sessionId: next.ack });
    this.latest = next.frame;
    this.scale = {
      x: next.page.width / next.frame.width,
      y: next.page.height / next.frame.height,
    };
    for (const viewer of this.viewers) this.deliver(viewer, next.frame);
    this.pump();
  }

  private deliver(viewer: Viewer, frame: HostedBrowserFrame): void {
    if (viewer.writing) {
      viewer.waiting = frame;
      return;
    }
    viewer.writing = true;
    viewer.sink.write(frame).then(
      () => {
        viewer.writing = false;
        const waiting = viewer.waiting;
        viewer.waiting = null;
        if (waiting !== null && this.viewers.has(viewer)) this.deliver(viewer, waiting);
      },
      () => {
        // The connection is gone; its own teardown leaves too, and twice is harmless.
        this.leave(viewer);
      },
    );
  }

  // --- the input -----------------------------------------------------------------

  private async dispatch(event: HostedBrowserInputEvent): Promise<void> {
    const send = (method: string, params: Record<string, unknown>) =>
      this.session.send(method, params, VIEW_TIMEOUT_MS);
    switch (event.type) {
      case "mouse":
        await send("Input.dispatchMouseEvent", {
          type: CDP_MOUSE[event.action],
          x: event.x * this.scale.x,
          y: event.y * this.scale.y,
          button: event.button ?? (event.action === "move" ? "none" : "left"),
          buttons: event.buttons ?? 0,
          clickCount: event.clickCount ?? (event.action === "move" ? 0 : 1),
          modifiers: event.modifiers ?? 0,
        });
        return;
      case "wheel":
        await send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: event.x * this.scale.x,
          y: event.y * this.scale.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          modifiers: event.modifiers ?? 0,
        });
        return;
      case "key":
        await send("Input.dispatchKeyEvent", {
          // A press that types a character is a `keyDown`; one that types nothing a `rawKeyDown`.
          type:
            event.action === "up" ? "keyUp" : event.text !== undefined ? "keyDown" : "rawKeyDown",
          key: event.key,
          code: event.code,
          ...(event.keyCode !== undefined
            ? { windowsVirtualKeyCode: event.keyCode, nativeVirtualKeyCode: event.keyCode }
            : {}),
          ...(event.action === "down" && event.text !== undefined
            ? { text: event.text, unmodifiedText: event.text }
            : {}),
          autoRepeat: event.repeat === true,
          modifiers: event.modifiers ?? 0,
        });
        return;
      case "text":
        await send("Input.insertText", { text: event.text });
        return;
      case "nav":
        await this.navigate(event.action);
        return;
    }
  }

  private async navigate(action: "back" | "forward" | "reload" | "stop"): Promise<void> {
    if (action === "reload") {
      await this.session.send("Page.reload", {}, VIEW_TIMEOUT_MS);
      return;
    }
    if (action === "stop") {
      await this.session.send("Page.stopLoading", {}, VIEW_TIMEOUT_MS);
      return;
    }
    const history = (await this.session.send("Page.getNavigationHistory", {}, VIEW_TIMEOUT_MS)) as {
      currentIndex?: number;
      entries?: { id?: number }[];
    };
    const target = history.entries?.[(history.currentIndex ?? 0) + (action === "back" ? -1 : 1)];
    // Nowhere to go that way: the button was stale, and pressing it does nothing.
    if (typeof target?.id !== "number") return;
    await this.session.send("Page.navigateToHistoryEntry", { entryId: target.id }, VIEW_TIMEOUT_MS);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
