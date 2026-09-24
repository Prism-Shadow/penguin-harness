/**
 * The built-in browser's pages, hosted once for the whole app. AppLayout mounts this; the
 * detached /terminal window and the full-window workflow route do not, and only the desktop
 * app's main window has a `<webview>` element at all — everywhere else this renders nothing.
 *
 * Why here and not in the dock: a `<webview>` reloads its page whenever it is moved in the
 * DOM, and the dock's bodies move — between the right and bottom docks, in and out of the
 * narrow merged view, with every conversation switch. So the pages live in this one layer,
 * in creation order, never re-parented, and are laid OVER the dock's viewport slot by
 * coordinates (geometry.ts): the active tab covers the visible part of the slot, every other
 * page parks off-screen at a real size, so a page an agent works in while the dock is closed
 * keeps a desktop layout. While a browser panel is on screen a frame loop follows its slot,
 * because the dock resizes, slides and moves with the layout around it and nothing announces
 * all of those.
 *
 * It also runs the lifecycle the server asks for over the user channel: `builtin_browser_open`
 * creates a page; once the page attaches, its webContents id claims the request (the first
 * window to claim wins, and a 409 removes this copy); `builtin_browser_close` removes one. An
 * agent opening a page or starting to act for the conversation on screen brings the browser's
 * dock tab up — once per conversation, so hiding it again is respected.
 */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CSSProperties } from "react";
import { toneInk } from "../../lib/tone";
import { currentDockScope, isTabShown, openPanel } from "../dock/dock-state";
import { isBlankUrl } from "./address";
import { claimGuest, closeBrowserTab, refreshBrowserStatus } from "./browser-actions";
import { subscribeBuiltinBrowserEvents, subscribeBuiltinBrowserResync } from "./browser-events";
import { activeTab, guestByKey, shouldReveal, type BrowserGuest } from "./browser-state";
import { browserState, dispatchBrowser, subscribeBrowser } from "./browser-store";
import {
  DEFAULT_PARK_SIZE,
  PARK_LEFT,
  parkedPlacement,
  samePlacement,
  shownSize,
  slotPlacement,
  type Placement,
  type Rect,
  type Size,
} from "./geometry";
import { hasVisibleSlot, slotsVersion, subscribeSlots, visibleSlot } from "./slot-registry";
import {
  BROWSER_PARTITION,
  registerWebview,
  webviewSupported,
  type WebviewElement,
} from "./webview-registry";

/** The dock tab of the browser panel. */
const BROWSER_TAB = "builtin-browser";

/**
 * Status re-reads while the server says the browser cannot run (ms). A shell that was slow to
 * answer the server's handshake at startup counts as unavailable until the server asks again,
 * which it does on the next status request.
 */
const STATUS_RETRY_MS = [3_000, 10_000, 30_000] as const;

/** A page's clipping frame and the page inside it, parked until the first placement. */
const FRAME_STYLE: CSSProperties = {
  position: "fixed",
  left: PARK_LEFT,
  top: 0,
  width: DEFAULT_PARK_SIZE.width,
  height: DEFAULT_PARK_SIZE.height,
  overflow: "hidden",
};
const VIEW_STYLE: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: DEFAULT_PARK_SIZE.width,
  height: DEFAULT_PARK_SIZE.height,
};
const RING_STYLE: CSSProperties = { display: "none" };

interface PageHost {
  frame: HTMLDivElement | null;
  view: WebviewElement | null;
  /** What was last written to the two boxes; a frame that computes the same writes nothing. */
  applied: Placement | undefined;
  /** The size it parks at: the size it was last shown at, or the default. */
  parkSize: Size;
}

/** Each hosted page's boxes, by guest key. */
const hosts = new Map<string, PageHost>();

function hostFor(key: string): PageHost {
  let host = hosts.get(key);
  if (host === undefined) {
    host = { frame: null, view: null, applied: undefined, parkSize: DEFAULT_PARK_SIZE };
    hosts.set(key, host);
  }
  return host;
}

function toRect(box: DOMRect): Rect {
  return { left: box.left, top: box.top, width: box.width, height: box.height };
}

function writeRect(style: CSSStyleDeclaration, rect: Rect): void {
  style.left = `${rect.left}px`;
  style.top = `${rect.top}px`;
  style.width = `${rect.width}px`;
  style.height = `${rect.height}px`;
}

/**
 * Lays every hosted page out for this frame: the active tab over the visible slot, unless
 * its page is blank (the panel's own surface shows then), and everything else parked. The
 * ring, when mounted, frames the visible slot.
 */
function placePages(ring: HTMLDivElement | null): void {
  const state = browserState();
  const tab = activeTab(state);
  const slot = tab === null ? null : visibleSlot();
  const onScreen =
    slot === null
      ? null
      : slotPlacement(
          toRect(slot.element.getBoundingClientRect()),
          slot.clips.map((clip) => toRect(clip.getBoundingClientRect())),
          DEFAULT_PARK_SIZE,
        );
  const showPage =
    onScreen !== null && onScreen.shown && tab !== null && !(isBlankUrl(tab.url) && !tab.loading);
  for (const guest of state.guests) {
    const host = hosts.get(guest.key);
    if (host === undefined || host.frame === null || host.view === null) continue;
    const placement =
      showPage && onScreen !== null && guest.tabId !== null && guest.tabId === state.activeTabId
        ? onScreen
        : parkedPlacement(host.parkSize);
    host.parkSize = shownSize(placement) ?? host.parkSize;
    if (samePlacement(host.applied, placement)) continue;
    writeRect(host.frame.style, placement.frame);
    writeRect(host.view.style, placement.view);
    host.applied = placement;
  }
  if (ring !== null) {
    if (onScreen !== null && onScreen.shown) {
      ring.style.display = "";
      writeRect(ring.style, onScreen.frame);
    } else {
      ring.style.display = "none";
    }
  }
}

/**
 * One hosted page. Memoised, and its element props never change after creation: React must
 * never touch the element again — a new `src` would navigate it, and a remount would reload it.
 */
const GuestPage = memo(function GuestPage({ guest }: { guest: BrowserGuest }) {
  const { key } = guest;

  const frameRef = useCallback(
    (element: HTMLDivElement) => {
      const host = hostFor(key);
      host.frame = element;
      host.applied = undefined;
      return () => {
        hosts.delete(key);
      };
    },
    [key],
  );

  const viewRef = useCallback(
    (element: HTMLWebViewElement) => {
      const view = element as WebviewElement;
      const host = hostFor(key);
      host.view = view;
      host.applied = undefined;
      registerWebview(key, view);
      // The tab id exists once the page has attached; either event may be the first to find
      // it, and the claim is made once.
      let claimed = false;
      const claim = () => {
        const current = guestByKey(browserState(), key);
        if (claimed || current === null || current.tabId !== null) return;
        let tabId: number;
        try {
          tabId = view.getWebContentsId();
        } catch {
          return; // not attached yet
        }
        claimed = true;
        void claimGuest(current, tabId);
      };
      // The page asked to close itself (window.close()).
      const close = () => {
        const tabId = guestByKey(browserState(), key)?.tabId ?? null;
        if (tabId !== null) closeBrowserTab(tabId);
      };
      // A press inside the page reaches the page alone, yet to the app it is a press outside
      // every open menu: replayed on the element as the page takes focus, the app's own
      // outside-press handlers close whatever was open.
      const pressedInside = () => {
        view.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      };
      view.addEventListener("did-attach", claim);
      view.addEventListener("dom-ready", claim);
      view.addEventListener("close", close);
      view.addEventListener("focus", pressedInside);
      return () => {
        view.removeEventListener("did-attach", claim);
        view.removeEventListener("dom-ready", claim);
        view.removeEventListener("close", close);
        view.removeEventListener("focus", pressedInside);
        registerWebview(key, null);
        host.view = null;
      };
    },
    [key],
  );

  return (
    <div ref={frameRef} data-testid="builtin-browser-page" data-guest={key} style={FRAME_STYLE}>
      {/* partition before src: the page's profile has to be set before its first load. */}
      <webview ref={viewRef} partition={BROWSER_PARTITION} src={guest.src} style={VIEW_STYLE} />
    </div>
  );
});

export function BuiltinBrowserLayer() {
  // Decided once: whether this window has the element does not change while it is open.
  const [supported] = useState(webviewSupported);
  return supported ? <LayerHost /> : null;
}

function LayerHost() {
  const state = useSyncExternalStore(subscribeBrowser, browserState);
  useSyncExternalStore(subscribeSlots, slotsVersion);
  const slotShown = hasVisibleSlot();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);

  // This window hosts the pages from here on: read the registry, follow its events, and
  // re-read it whenever events may have been lost. Unmounting (signing out) drops the pages,
  // and the store forgets them with it.
  useEffect(() => {
    dispatchBrowser({ type: "supported", supported: true });
    void refreshBrowserStatus();
    const revealed = new Set<string>();
    const offEvents = subscribeBuiltinBrowserEvents((event) => {
      dispatchBrowser({ type: "event", event });
      const conversation = currentDockScope();
      const onScreen = { conversation, browserShown: isTabShown(BROWSER_TAB) };
      if (shouldReveal(event, onScreen, revealed)) {
        revealed.add(conversation);
        openPanel(BROWSER_TAB);
      }
    });
    const offResync = subscribeBuiltinBrowserResync(() => {
      dispatchBrowser({ type: "resync" });
      void refreshBrowserStatus();
    });
    return () => {
      offEvents();
      offResync();
      dispatchBrowser({ type: "supported", supported: false });
    };
  }, []);

  const available = state.available;
  useEffect(() => {
    if (available) return;
    let cancelled = false;
    let attempt = 0;
    let timer = 0;
    const schedule = () => {
      const delay = STATUS_RETRY_MS[attempt];
      if (cancelled || delay === undefined) return;
      attempt += 1;
      timer = window.setTimeout(() => void refreshBrowserStatus().then(schedule), delay);
    };
    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [available]);

  // After every render: a new page gets its boxes, and a switched tab moves at once.
  useLayoutEffect(() => placePages(ringRef.current));

  // While a browser panel is on screen, follow its slot every frame.
  useEffect(() => {
    if (!slotShown) return;
    let frame = requestAnimationFrame(function tick() {
      placePages(ringRef.current);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [slotShown]);

  // A press in the app turns the pages transparent to the pointer until it is released, so a
  // drag that starts outside a page (a dock resize, a tab drag, a text selection) keeps
  // reaching the app while it crosses one — a page would otherwise take the pointer over.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const release = () => {
      root.style.pointerEvents = "";
    };
    const press = (event: PointerEvent) => {
      if (event.button === 0) root.style.pointerEvents = "none";
    };
    // A release the window never saw (let go outside it) ends the press at the next move.
    const move = (event: PointerEvent) => {
      if (event.buttons === 0 && root.style.pointerEvents !== "") release();
    };
    window.addEventListener("pointerdown", press, true);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerdown", press, true);
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  // The agent-at-work ring frames the page on screen while an agent acts in that tab.
  const ringShown =
    slotShown && state.activeTabId !== null && state.activity[state.activeTabId] !== undefined;

  return (
    <div ref={rootRef} data-testid="builtin-browser-layer">
      {state.guests.map((guest) => (
        <GuestPage key={guest.key} guest={guest} />
      ))}
      {ringShown && (
        <div
          ref={ringRef}
          aria-hidden
          data-testid="builtin-browser-agent-ring"
          style={RING_STYLE}
          className={`browser-agent-ring pointer-events-none fixed ${toneInk.busy}`}
        />
      )}
    </div>
  );
}
