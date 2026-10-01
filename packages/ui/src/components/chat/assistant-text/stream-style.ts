/**
 * How the active theme reveals a streaming reply: the `--ui-stream-*` tokens, read off the
 * root's computed style, for the one part CSS cannot do alone — pacing how much of the text
 * has arrived on screen. The theme's CSS draws the rest (the `ui-stream` hook's veil or caret).
 *
 * - `--ui-stream-reveal`: `instant` (each delta shows as it arrives), `fade` (new text is let
 *   in word by word) or `typewriter` (character by character). Missing or unknown → `instant`.
 * - `--ui-stream-rate`: characters per second of a paced reveal (`fade` paces its words at this
 *   rate too). Missing, zero or not a number → no pacing.
 *
 * Read the way chart-style.ts reads the chart tokens: one MutationObserver on <html> drops the
 * cached record when anything there changes, a subscriber gets the same object while nothing it
 * reads changed, and nothing here ever writes. The observer watches every attribute rather than
 * naming the theme's — reading the tokens is what tells a real change from any other write, and
 * a component never asks which theme is active. The record also carries the root's
 * reduced-motion switch (`data-motion="reduced"` on <html>, the gallery's), the second of the
 * two signals the theme CSS honours beside the media query.
 */
import { useSyncExternalStore } from "react";
import type { StreamReveal } from "../../../tokens";

export interface StreamStyle {
  /** How new text comes in. */
  reveal: StreamReveal;
  /** Characters per second of a paced reveal; 0 when the theme sets none. */
  rate: number;
  /** The root asks for reduced motion (`data-motion="reduced"`). */
  reducedMotion: boolean;
}

/** What a document without the theme sheet reveals with: every delta at once, as before. */
export const DEFAULT_STREAM_STYLE: StreamStyle = {
  reveal: "instant",
  rate: 0,
  reducedMotion: false,
};

/** Far past any reading pace: a larger value is a typo, and is held to this. */
const MAX_RATE = 5000;

/**
 * The record, from a reader of custom properties (`getPropertyValue` on the root's computed
 * style) and the root's `data-motion` attribute.
 */
export function readStreamStyle(
  read: (name: string) => string,
  motion: string | null,
): StreamStyle {
  const keyword = read("--ui-stream-reveal")
    .trim()
    .replace(/^["']|["']$/g, "");
  const rate = Number.parseFloat(read("--ui-stream-rate"));
  return {
    reveal: keyword === "fade" || keyword === "typewriter" ? keyword : "instant",
    rate: Number.isFinite(rate) && rate > 0 ? Math.min(rate, MAX_RATE) : 0,
    reducedMotion: motion === "reduced",
  };
}

/**
 * The mode a reply is actually revealed in: `instant` whenever there is nothing to pace with (no
 * rate) or the reader asked for less motion by either signal — the root's switch in the record,
 * or the operating system's preference, which the caller passes.
 */
export function effectiveReveal(style: StreamStyle, prefersReducedMotion: boolean): StreamReveal {
  if (style.rate <= 0 || style.reducedMotion || prefersReducedMotion) return "instant";
  return style.reveal;
}

/** Whether two records reveal the same way. */
export function sameStreamStyle(a: StreamStyle, b: StreamStyle): boolean {
  return a.reveal === b.reveal && a.rate === b.rate && a.reducedMotion === b.reducedMotion;
}

/**
 * The next record to hand out: `previous` itself when nothing changed, so a subscriber sees the
 * same object and React re-renders nothing. <html> changes for many reasons that are not the
 * theme; a new object on each of those would restart every streaming reply's pacing loop.
 */
export function nextStreamStyle(previous: StreamStyle | null, read: StreamStyle): StreamStyle {
  return previous !== null && sameStreamStyle(previous, read) ? previous : read;
}

let cached: StreamStyle | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/** Reads the root's tokens and motion switch. Reading never writes. */
function readRoot(): StreamStyle {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  return readStreamStyle(
    (name) => computed.getPropertyValue(name),
    root.getAttribute("data-motion"),
  );
}

function snapshot(): StreamStyle {
  if (cached === null) cached = readRoot();
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null) {
    // No one watched <html> while no reply was mounted: catch up once, keeping the same object
    // when nothing changed in the meantime.
    if (cached !== null) cached = nextStreamStyle(cached, readRoot());
    observer = new MutationObserver(() => {
      const next = nextStreamStyle(cached, readRoot());
      if (next === cached) return;
      cached = next;
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, { attributes: true });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** The active theme's stream style; a reply re-renders when the theme or motion switch changes. */
export function useStreamStyle(): StreamStyle {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_STREAM_STYLE);
}
