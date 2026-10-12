/**
 * What keeps the live widgets live, and cheap: the time now, ticking once a second; whether a
 * widget is near the viewport; and whether the reader asked for less motion.
 *
 * `useNow` is one module store for every clock and countdown on the page: one timer, aligned to
 * the second boundary so every subscriber turns over together, stopped while nobody listens and
 * while the document is hidden. Its snapshot is read on each call (the second the render happens
 * in), so a static render shows the instant it renders at and a test pins it with fake timers.
 *
 * `useInView` shares one IntersectionObserver among every widget, with a 200 px margin so a widget
 * is already ticking when it scrolls in. Where the observer is missing (a test, a server render)
 * everything counts as in view.
 *
 * `useMotionReduced` reads both signals the theme CSS honours: the system preference and the
 * root's `data-motion="reduced"` switch (the gallery's). It is for what CSS cannot still on its
 * own: a clock's seconds hand, drawn per render.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { usePrefersReducedMotion } from "../../../motion/use-reduced-motion";

// ---------------------------------------------------------------------------
// The second
// ---------------------------------------------------------------------------

const tickers = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let watchingVisibility = false;

const hidden = () => typeof document !== "undefined" && document.hidden === true;

/** The current second, in milliseconds. */
const second = () => Math.floor(Date.now() / 1000) * 1000;

function tick() {
  timer = null;
  for (const listener of [...tickers]) listener();
  schedule();
}

/** Arms the timer for the next second boundary, unless nobody listens or nobody can see. */
function schedule() {
  if (timer !== null || tickers.size === 0 || hidden()) return;
  // A few ms past the boundary, so the read on the other side lands in the new second.
  timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
}

function stop() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function onVisibility() {
  if (hidden()) stop();
  else {
    // Back in view: catch up at once, then tick on the boundary again.
    for (const listener of [...tickers]) listener();
    schedule();
  }
}

function subscribeNow(listener: () => void): () => void {
  tickers.add(listener);
  if (!watchingVisibility && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
    watchingVisibility = true;
  }
  schedule();
  return () => {
    tickers.delete(listener);
    if (tickers.size > 0) return;
    stop();
    if (watchingVisibility) {
      document.removeEventListener("visibilitychange", onVisibility);
      watchingVisibility = false;
    }
  };
}

const still = () => () => {};

/**
 * Milliseconds now, floored to the second; re-renders each second while `enabled`. Disabled, it
 * still answers with the second the component renders in, and stops re-rendering it.
 */
export function useNow(enabled: boolean): number {
  return useSyncExternalStore(enabled ? subscribeNow : still, second, second);
}

// ---------------------------------------------------------------------------
// In view
// ---------------------------------------------------------------------------

let observer: IntersectionObserver | null = null;
const watched = new Map<Element, (inView: boolean) => void>();

function watch(element: Element, report: (inView: boolean) => void): () => void {
  if (observer === null) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) watched.get(entry.target)?.(entry.isIntersecting);
      },
      { rootMargin: "200px" },
    );
  }
  watched.set(element, report);
  observer.observe(element);
  return () => {
    watched.delete(element);
    observer?.unobserve(element);
    if (watched.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/**
 * Whether the element is within 200 px of the viewport; true where IntersectionObserver is
 * missing (tests, SSR).
 */
export function useInView<T extends Element>(ref: RefObject<T | null>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;
    return watch(element, setInView);
  }, [ref]);
  return inView;
}

// ---------------------------------------------------------------------------
// Reduced motion
// ---------------------------------------------------------------------------

const rootReduced = () =>
  typeof document !== "undefined" &&
  document.documentElement?.getAttribute("data-motion") === "reduced";

const motionListeners = new Set<() => void>();
let rootObserver: MutationObserver | null = null;

function subscribeMotion(listener: () => void): () => void {
  motionListeners.add(listener);
  if (rootObserver === null && typeof MutationObserver !== "undefined") {
    rootObserver = new MutationObserver(() => {
      for (const l of [...motionListeners]) l();
    });
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion"],
    });
  }
  return () => {
    motionListeners.delete(listener);
    if (motionListeners.size === 0) {
      rootObserver?.disconnect();
      rootObserver = null;
    }
  };
}

/** Whether motion should rest: the system preference, or the root's `data-motion="reduced"`. */
export function useMotionReduced(): boolean {
  const system = usePrefersReducedMotion();
  // The root is read on the server render too, so a static render under the switch is still.
  const root = useSyncExternalStore(subscribeMotion, rootReduced, rootReduced);
  return system || root;
}
