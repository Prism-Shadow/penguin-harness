/**
 * The page area of a hosted tab: the picture of a page in the Chrome a server runs on its own
 * machine, and the viewer's mouse, wheel and keyboard sent back to it. It stands where the
 * `<webview>` does for the built-in browser and the "open in your Chrome" card does for the
 * user's Chrome; the panel around it (hosted-panel.tsx) keys it by tab, so each tab starts over.
 *
 * The picture is the server's event stream of JPEG frames (api/sse.ts `openBrowserView`), drawn
 * on a canvas scaled to fit. The page is laid out to this panel: the size goes with the request
 * that opens the stream, and a resize is told once it settles.
 *
 * - The stream is watched only while the panel is on screen and the window is shown; a hidden
 *   panel costs the machine no encoding.
 * - It ends when the tab closes or its Chrome exits, and nothing else says so, so an end also
 *   re-reads the browser's status. While the tab is still listed the stream is opened again,
 *   waiting longer each time; after the last wait the surface says so and offers Retry.
 *
 * The input (hosted-input.ts does the translation):
 *
 * - Mouse presses, moves and releases at the frame's own pixels. A press takes the keyboard and
 *   follows the pointer through the whole window until the release, so a drag may leave the
 *   panel.
 * - The keyboard goes to an invisible text field over the picture, the only way a browser hands
 *   out an input method's composed text and a paste: keys are sent as keys, committed text and
 *   pasted text as text.
 * - Losing the keyboard or the window releases whatever is still down.
 * - Events are sent in order, one request at a time; whatever arrives while a request is on its
 *   way waits in the queue, where runs of moves fold into one.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CompositionEvent as ReactCompositionEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import type {
  BuiltinBrowserTab,
  HostedBrowserFrame,
  HostedBrowserInputEvent,
  HostedBrowserViewport,
} from "@prismshadow/penguin-server/api";
import { Button, EmptyState, Spinner } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { openBrowserView } from "../../api/sse";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { refreshBrowserStatus } from "./browser-actions";
import {
  HeldInput,
  InputQueue,
  framePoint,
  isPasteKey,
  keyInput,
  mouseInput,
  textInput,
  viewportOf,
  wheelInput,
  type FrameSize,
} from "./hosted-input";

/** The waits before each new attempt at a stream that ended (ms); after the last, Retry. */
const RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000] as const;
/** A stream that lasted this long was a working one: the waits start over. */
const SETTLED_MS = 10_000;
/** How long a new panel size has to stand before the page is laid out to it. */
const RESIZE_SETTLE_MS = 150;
/** How long the first event of a batch waits for the ones that come with it. */
const FLUSH_MS = 16;

/** How the picture stands: none yet, live, ended and about to be asked for again, or given up. */
type Phase = "connecting" | "live" | "waiting" | "failed";

function sameViewport(a: HostedBrowserViewport | null, b: HostedBrowserViewport | null): boolean {
  return a?.width === b?.width && a?.height === b?.height;
}

export function HostedSurface({
  server,
  tab,
  active,
  busy,
}: {
  /** The server whose Chrome the tab is in: null for this one, a machine id otherwise. */
  server: string | null;
  tab: BuiltinBrowserTab;
  /** Whether the panel is the one its dock shows. */
  active: boolean;
  /** Whether an agent is acting in this tab now. */
  busy: boolean;
}) {
  const tabId = tab.id;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [viewport, setViewport] = useState<HostedBrowserViewport | null>(null);
  const [windowShown, setWindowShown] = useState(() => document.visibilityState !== "hidden");

  // What the handlers read without re-binding: the frame on screen, the stream's bookkeeping.
  const frame = useRef<FrameSize | null>(null);
  const failures = useRef(0);
  const toldViewport = useRef<HostedBrowserViewport | null>(null);
  const viewportNow = useRef<HostedBrowserViewport | null>(null);
  viewportNow.current = viewport;

  // ------------------------------------------------------------------------------ the size

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const measure = () => {
      const next = viewportOf({ width: root.clientWidth, height: root.clientHeight });
      setViewport((current) => (sameViewport(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const changed = () => setWindowShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);

  // ------------------------------------------------------------------------------ the input

  const queue = useRef(new InputQueue());
  const held = useRef(new HeldInput());
  const sending = useRef(false);
  const flushTimer = useRef<number | null>(null);
  const unmounted = useRef(false);

  const flush = useCallback(() => {
    flushTimer.current = null;
    if (sending.current || unmounted.current) return;
    const events = queue.current.take();
    if (events.length === 0) return;
    sending.current = true;
    api
      .sendHostedBrowserInput(tabId, { events }, server)
      .catch((err: unknown) => {
        // What was typed for a page that is gone, or a browser that stopped, has nowhere to
        // go; a request the network dropped is not worth replaying out of order either.
        queue.current.clear();
        if (err instanceof ApiError && err.status !== 0 && err.status !== 404) {
          void refreshBrowserStatus(server);
        }
      })
      .finally(() => {
        sending.current = false;
        if (queue.current.size > 0) flush();
      });
  }, [server, tabId]);

  const send = useCallback(
    (event: HostedBrowserInputEvent | null) => {
      if (event === null) return;
      held.current.track(event);
      queue.current.push(event);
      if (!sending.current && flushTimer.current === null) {
        flushTimer.current = window.setTimeout(flush, FLUSH_MS);
      }
    },
    [flush],
  );

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    };
  }, []);

  /** A pointer position as a position in the frame; null before the first frame. */
  const pointOf = useCallback((client: { clientX: number; clientY: number }) => {
    const root = rootRef.current;
    const size = frame.current;
    if (root === null || size === null) return null;
    const box = root.getBoundingClientRect();
    return framePoint({ x: client.clientX, y: client.clientY }, box, size);
  }, []);

  const releaseAll = useCallback(() => {
    for (const event of held.current.releaseAll()) send(event);
  }, [send]);

  // A drag follows the pointer through the whole window: the page gets every move and the
  // release wherever they happen, and a release the window never saw ends at the window's blur.
  const drag = useRef<(() => void) | null>(null);
  const endDrag = useCallback(() => {
    drag.current?.();
    drag.current = null;
  }, []);
  useEffect(() => endDrag, [endDrag]);

  const onMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    const point = pointOf(event);
    if (point === null) return;
    // The press would otherwise select the app's text and leave the keyboard where it was.
    event.preventDefault();
    const field = fieldRef.current;
    if (field !== null) {
      // An input method anchors its candidates at the field, so the field goes where the press was.
      const box = event.currentTarget.getBoundingClientRect();
      field.style.left = `${event.clientX - box.left}px`;
      field.style.top = `${event.clientY - box.top}px`;
      field.focus({ preventScroll: true });
    }
    send(mouseInput("down", event, point));
    if (drag.current !== null) return;
    const move = (moved: MouseEvent) => {
      const at = pointOf(moved);
      if (at !== null) send(mouseInput("move", moved, at));
    };
    const up = (released: MouseEvent) => {
      const at = pointOf(released);
      if (at !== null) send(mouseInput("up", released, at));
      if (!held.current.dragging) endDrag();
    };
    const lost = () => {
      releaseAll();
      endDrag();
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", up, true);
    window.addEventListener("blur", lost);
    drag.current = () => {
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", up, true);
      window.removeEventListener("blur", lost);
    };
  };

  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    // While a button is down the window's listener sends the moves.
    if (drag.current !== null) return;
    const point = pointOf(event);
    if (point !== null) send(mouseInput("move", event, point));
  };

  // The wheel: bound by hand, because the page must not scroll with it and React's wheel
  // listener is passive.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const wheel = (event: WheelEvent) => {
      const size = frame.current;
      const point = pointOf(event);
      if (size === null || point === null) return;
      event.preventDefault();
      send(wheelInput(event, point, size));
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [pointOf, send]);

  const onKey = (action: "down" | "up") => (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent;
    // Paste is the browser's to run: it hands the text to onPaste, and the page gets that.
    if (isPasteKey(native)) return;
    const input = keyInput(action, native);
    if (input === null) return;
    event.preventDefault();
    send(input);
  };

  const onCompositionEnd = (event: ReactCompositionEvent<HTMLTextAreaElement>) => {
    send(textInput(event.data));
    event.currentTarget.value = "";
  };

  // Text that reached the field without a key the surface sent (a virtual keyboard, a dictation).
  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    if ((event.nativeEvent as InputEvent).isComposing) return;
    send(textInput(event.currentTarget.value));
    event.currentTarget.value = "";
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    send(textInput(event.clipboardData.getData("text/plain")));
  };

  // ------------------------------------------------------------------------------ the picture

  const watching = active && windowShown && viewport !== null;
  useEffect(() => {
    if (!watching) return;
    const size = viewportNow.current;
    if (size === null) return;
    let over = false;
    let timer = 0;
    let drawn = 0;
    let received = 0;
    const openedAt = Date.now();
    toldViewport.current = size;
    const draw = (next: HostedBrowserFrame) => {
      const order = ++received;
      const image = new Image();
      image.onload = () => {
        const canvas = canvasRef.current;
        // A frame decoded after a newer one was drawn is stale.
        if (over || canvas === null || order < drawn) return;
        drawn = order;
        if (canvas.width !== next.width) canvas.width = next.width;
        if (canvas.height !== next.height) canvas.height = next.height;
        canvas.getContext("2d")?.drawImage(image, 0, 0);
        frame.current = { width: next.width, height: next.height };
        setPhase("live");
      };
      image.src = `data:image/jpeg;base64,${next.data}`;
    };
    const connection = openBrowserView(tabId, size, server, {
      onFrame: draw,
      onEnd: () => {
        if (over) return;
        // The tab closing and its Chrome exiting both end the stream, and nothing else tells.
        void refreshBrowserStatus(server);
        if (Date.now() - openedAt >= SETTLED_MS) failures.current = 0;
        const wait = RETRY_MS[failures.current];
        failures.current += 1;
        if (wait === undefined) {
          setPhase("failed");
          return;
        }
        setPhase("waiting");
        timer = window.setTimeout(() => setAttempt((count) => count + 1), wait);
      },
    });
    return () => {
      over = true;
      connection.close();
      window.clearTimeout(timer);
    };
  }, [watching, server, tabId, attempt]);

  // A new panel size, once it has stood for a moment, is the size the page is laid out to.
  useEffect(() => {
    if (!watching || viewport === null || sameViewport(viewport, toldViewport.current)) return;
    const timer = window.setTimeout(() => {
      toldViewport.current = viewport;
      void api.sendHostedBrowserInput(tabId, { viewport }, server).catch(() => undefined);
    }, RESIZE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [watching, viewport, server, tabId]);

  const retry = () => {
    failures.current = 0;
    setPhase(frame.current === null ? "connecting" : "waiting");
    setAttempt((count) => count + 1);
  };

  const hasFrame = frame.current !== null;
  return (
    <div
      ref={rootRef}
      data-testid="hosted-browser-surface"
      data-phase={phase}
      className="relative h-full w-full overflow-hidden bg-surface-muted"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onContextMenu={(event) => event.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        data-testid="hosted-browser-picture"
        aria-hidden
        className={`absolute inset-0 h-full w-full object-contain ${
          phase === "live" ? "" : "opacity-60"
        }`}
      />
      <textarea
        ref={fieldRef}
        data-testid="hosted-browser-keys"
        aria-label={S.builtinBrowser.hostedPageInput(tab.title)}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        rows={1}
        className="pointer-events-none absolute left-0 top-0 h-px w-px resize-none overflow-hidden border-0 bg-transparent p-0 opacity-0 outline-none"
        onKeyDown={onKey("down")}
        onKeyUp={onKey("up")}
        onCompositionEnd={onCompositionEnd}
        onInput={onInput}
        onPaste={onPaste}
        onBlur={releaseAll}
      />
      {phase === "connecting" && (
        <div
          role="status"
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs text-fg-muted"
        >
          <Spinner size="sm" label={S.builtinBrowser.hostedConnecting} />
          {S.builtinBrowser.hostedConnecting}
        </div>
      )}
      {phase === "waiting" && (
        <div
          role="status"
          data-testid="hosted-browser-reconnecting"
          className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2 rounded-md border border-line bg-canvas px-2 py-1 text-xs text-fg-muted"
        >
          <Spinner size="sm" label={S.builtinBrowser.hostedReconnecting} />
          {S.builtinBrowser.hostedReconnecting}
        </div>
      )}
      {phase === "failed" && (
        <div
          data-testid="hosted-browser-failed"
          className={`absolute inset-0 flex items-center justify-center overflow-y-auto p-4 ${
            hasFrame ? "bg-canvas/80" : ""
          }`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <EmptyState
            title={S.builtinBrowser.hostedViewLostTitle}
            description={S.builtinBrowser.hostedViewLostBody}
            action={
              <Button size="sm" onClick={retry}>
                {S.common.retry}
              </Button>
            }
          />
        </div>
      )}
      {busy && (
        <div
          aria-hidden
          data-testid="hosted-browser-agent-ring"
          className={`browser-agent-ring pointer-events-none absolute inset-0 ${toneInk.busy}`}
        />
      )}
    </div>
  );
}
