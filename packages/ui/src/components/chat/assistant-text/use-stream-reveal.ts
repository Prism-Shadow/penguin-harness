/**
 * `useStreamReveal(text, streaming)`: the part of a streaming reply's text to show right now,
 * paced by the active theme's `--ui-stream-reveal` and `--ui-stream-rate` (stream-style.ts), and
 * the runs of it that are still fading in.
 *
 * Under `instant` — Primer, a theme without the tokens, or reduced motion by either signal — it
 * returns `text` itself and runs nothing: the reply renders exactly as it always has. Under
 * `fade` or `typewriter` a requestAnimationFrame loop walks the pacing in stream-reveal.ts and
 * hands React a new prefix only when the visible length changes, at most once per
 * {@link revealFrameMs} (the whole reply's Markdown re-parses on each), and stops once the
 * whole text is showing; new text restarts it. When `streaming` turns false the loop keeps
 * going until the rest is revealed at the rate, so the caller treats the reply as live while
 * the returned prefix is shorter than `text`.
 *
 * Under `fade`, every new prefix also notes an arrival: the stretch it added, stamped with the
 * frame it came in (stream-reveal.ts `noteArrival`). The caller renders each live arrival as a
 * run the theme fades in over its reveal duration (stream-arrivals.ts). The runs ride along with
 * the prefixes the reveal hands React anyway, so they cost no render of their own, except one:
 * once the reveal has caught up — the stream paused, or ended — the last runs are let go when
 * they have finished fading, with a single render, so the text they sat in is plain again.
 *
 * The pacing state lives in a ref the loop advances and the render reads; a counter state
 * re-renders the owner when the prefix changes. A theme switch mid-stream carries on from
 * whatever was on screen: under `instant` the ref is kept level with the text, so switching to a
 * paced theme paces only what arrives next.
 */
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../../motion/use-reduced-motion";
import type { RevealArrival } from "../../content/prose/stream-arrivals";
import { effectiveReveal, useStreamStyle } from "./stream-style";
import {
  noteArrival,
  receiveText,
  revealFrameMs,
  settledReveal,
  startReveal,
  stepReveal,
  visibleLength,
} from "./stream-reveal";
import type { RevealState } from "./stream-reveal";

export interface StreamRevealView {
  /** The text to show now: a prefix of `text`, or `text` itself. */
  revealed: string;
  /** The runs of it still fading in, in order, as offsets into it; empty unless the theme fades. */
  arrivals: readonly RevealArrival[];
}

const NONE: readonly RevealArrival[] = [];

interface Pacer {
  state: RevealState;
  /** The length the last render was handed. */
  shown: number;
  /** When `shown` last changed, on the frame clock. */
  shownAt: number;
  /** The runs still fading in. */
  arrivals: readonly RevealArrival[];
}

export function useStreamReveal(text: string, streaming: boolean): StreamRevealView {
  const style = useStreamStyle();
  const reduced = usePrefersReducedMotion();
  const mode = effectiveReveal(style, reduced);
  const rate = style.rate;
  const paced = mode !== "instant";
  const fadeMs = mode === "fade" ? style.fadeMs : 0;

  const pacerRef = useRef<Pacer | null>(null);
  if (pacerRef.current === null) {
    const now = performance.now();
    const state = startReveal(text, now, { streaming: streaming && paced, rate });
    pacerRef.current = {
      state,
      shown: visibleLength(state, mode, streaming, now),
      shownAt: now,
      arrivals: NONE,
    };
  }
  const [, rerender] = useState(0);

  useEffect(() => {
    const pacer = pacerRef.current!;
    const now = performance.now();
    if (!paced) {
      // Nothing to pace: stay level with the text, so a switch to a paced theme starts here.
      pacer.state = settledReveal(text, now);
      pacer.shown = text.length;
      pacer.arrivals = NONE;
      return;
    }
    if (fadeMs <= 0) pacer.arrivals = NONE;
    pacer.state = receiveText(pacer.state, text, now);
    // Text that replaced a longer one is already whole on screen (the render clamps to it).
    if (pacer.shown > text.length) pacer.shown = text.length;
    let frame = 0;
    let release = 0;
    // Caught up: the last runs finish fading, then rejoin the text in one render.
    const letGo = () => {
      const last = pacer.arrivals[pacer.arrivals.length - 1];
      if (last === undefined) return;
      release = window.setTimeout(
        () => {
          release = 0;
          pacer.arrivals = NONE;
          rerender((n) => n + 1);
        },
        Math.max(0, last.at + fadeMs - performance.now()),
      );
    };
    const tick = (clock: number) => {
      frame = 0;
      // A frame's timestamp can precede the performance.now() read above.
      const at = Math.max(clock, pacer.state.at);
      pacer.state = stepReveal(pacer.state, at, rate);
      // Never take back what is on screen: an edge released at its deadline (a partial word, a
      // lone list mark) would otherwise vanish when the next delta makes it a cut point again.
      const next = Math.max(visibleLength(pacer.state, mode, streaming, at), pacer.shown);
      if (
        next !== pacer.shown &&
        (next >= text.length || at - pacer.shownAt >= revealFrameMs(next))
      ) {
        if (fadeMs > 0) pacer.arrivals = noteArrival(pacer.arrivals, pacer.shown, at, fadeMs);
        pacer.shown = next;
        pacer.shownAt = at;
        rerender((n) => n + 1);
      }
      if (pacer.shown < text.length) frame = requestAnimationFrame(tick);
      else letGo();
    };
    if (pacer.shown < text.length) frame = requestAnimationFrame(tick);
    else letGo();
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      if (release !== 0) window.clearTimeout(release);
    };
  }, [text, streaming, paced, mode, rate, fadeMs]);

  if (!paced) return { revealed: text, arrivals: NONE };
  const pacer = pacerRef.current;
  // The pacing state may still hold the previous text for this render (the effect catches it up
  // after the commit); a prefix of the previous text is a prefix of this one unless the text was
  // replaced, and the next frame corrects that case.
  const revealed = pacer.shown >= text.length ? text : text.slice(0, pacer.shown);
  const { arrivals } = pacer;
  const last = arrivals[arrivals.length - 1];
  return {
    revealed,
    arrivals:
      last === undefined || last.start < revealed.length
        ? arrivals
        : arrivals.filter((arrival) => arrival.start < revealed.length),
  };
}
