/**
 * The clock a live variant plays on (see module.ts): which frame is showing, whether it is moving,
 * how fast, and how far into the frame it is.
 *
 * A composition reads the clock and draws the state the current frame names:
 *
 *   function LiveStream({ f }: { f: Fixtures }) {
 *     const clock = useScene();
 *     const t = useFrameTime();
 *     const settled = reached(clock, "settled");
 *     …
 *   }
 *
 * The render function a module declares stays hook-free and returns such a component; the gallery
 * wraps whatever it renders in a `SceneContext` provider. Outside a live variant (a static variant,
 * the Web App) there is no clock: `useScene()` is null, `reached` is true (a static view is the
 * settled one) and `at` is false.
 *
 * Time is wall-clock based so that several documents can show the same moment: the card that owns
 * the clock hands its `SceneTimeline` to the compare frames, and each one computes the time in the
 * frame from `Date.now()` and that timeline alone. Only the owner advances frames.
 *
 * The pure half — the timeline, `sceneReducer`, `frameElapsed`, `msToNextFrame` — needs no React
 * and no DOM, so the gallery's player and the tests call it directly.
 */
import { createContext, useContext, useEffect, useReducer } from "react";
import type { SceneFrame } from "./module";

/** The speeds the gallery offers. */
export const SCENE_RATES = [0.5, 1, 2] as const;

/** The moving part of a clock — what a compare frame receives from the card that owns the clock. */
export interface SceneTimeline {
  /** The current frame. */
  index: number;
  playing: boolean;
  /** Speed: 1 plays each frame for its `hold`, 2 for half of it. */
  rate: number;
  /**
   * `Date.now()` at which the current frame started, at the current rate: while playing, the time
   * spent in the frame is `(Date.now() - frameStartedAt) × rate`. A rate change re-bases it, so the
   * time already spent is kept. Meaningless while paused.
   */
  frameStartedAt: number;
  /** While paused: ms (at 1×) already spent in the current frame. 0 while playing. */
  pausedElapsed: number;
}

export interface SceneClock extends SceneTimeline {
  frames: readonly SceneFrame[];
  /** `frames[index].key`. */
  frame: string;
  /**
   * Reduced motion: frames still step, but a component shows each frame's END state at once — a
   * stream its whole text, a typing field its whole value.
   */
  reduced: boolean;
}

export type SceneAction =
  | { type: "play"; now: number }
  | { type: "pause"; now: number }
  /** Back to the first frame, playing. */
  | { type: "restart"; now: number }
  /** One frame back (-1) or on (+1), wrapping; pauses, so the frame can be read. */
  | { type: "step"; by: number; now: number }
  /** To one frame, keeping the play state. */
  | { type: "jump"; index: number; now: number }
  | { type: "rate"; rate: number; now: number }
  /** Advance past every frame whose hold has run out, looping from the last frame to the first. */
  | { type: "tick"; now: number };

// ---------------------------------------------------------------------------------------------
// Pure timeline logic
// ---------------------------------------------------------------------------------------------

/** A frame's hold at 1×. A missing or non-positive hold would stall the loop: it reads as 1 s. */
export function holdOf(frame: SceneFrame | undefined): number {
  const hold = frame?.hold;
  return typeof hold === "number" && Number.isFinite(hold) && hold > 0 ? hold : 1000;
}

const wrap = (index: number, count: number) => ((index % count) + count) % count;

const validRate = (rate: number) => Number.isFinite(rate) && rate > 0;

/** The index of the frame with `key`, or -1. */
export function frameIndexOf(frames: readonly SceneFrame[], key: string): number {
  return frames.findIndex((frame) => frame.key === key);
}

/**
 * A timeline sitting on one frame. Playing, the frame starts now; paused, it sits at the frame's
 * END, so a still (a paused card, a screenshot) shows what the frame arrives at rather than the
 * instant it begins.
 */
export function cueTimeline(
  frames: readonly SceneFrame[],
  index: number,
  { playing = false, rate = 1, now }: { playing?: boolean; rate?: number; now: number },
): SceneTimeline {
  const at = frames.length > 0 ? wrap(Math.trunc(index) || 0, frames.length) : 0;
  return {
    index: at,
    playing,
    rate: validRate(rate) ? rate : 1,
    frameStartedAt: now,
    pausedElapsed: playing ? 0 : holdOf(frames[at]),
  };
}

/** Ms (at 1×) spent in the current frame at `now`, between 0 and the frame's hold. */
export function frameElapsed(
  frames: readonly SceneFrame[],
  timeline: SceneTimeline,
  now: number,
): number {
  const hold = holdOf(frames[timeline.index]);
  const spent = timeline.playing
    ? (now - timeline.frameStartedAt) * timeline.rate
    : timeline.pausedElapsed;
  return Math.min(hold, Math.max(0, spent));
}

/** Wall-clock ms until the current frame's hold runs out, or null while paused. */
export function msToNextFrame(
  frames: readonly SceneFrame[],
  timeline: SceneTimeline,
  now: number,
): number | null {
  if (!timeline.playing || frames.length === 0) return null;
  const left = holdOf(frames[timeline.index]) - (now - timeline.frameStartedAt) * timeline.rate;
  return Math.max(0, left / timeline.rate);
}

/** A playing timeline moved on to the frame showing at `now`. */
function settle(frames: readonly SceneFrame[], t: SceneTimeline, now: number): SceneTimeline {
  if (!t.playing || frames.length === 0) return t;
  const cycle = frames.reduce((sum, frame) => sum + holdOf(frame), 0) / t.rate;
  let { index, frameStartedAt } = t;
  while ((now - frameStartedAt) * t.rate >= holdOf(frames[index])) {
    frameStartedAt += holdOf(frames[index]) / t.rate;
    index = (index + 1) % frames.length;
    // A tab left in the background for an hour skips whole loops at once, not frame by frame.
    if (now - frameStartedAt >= cycle) {
      frameStartedAt += Math.floor((now - frameStartedAt) / cycle) * cycle;
    }
  }
  return index === t.index && frameStartedAt === t.frameStartedAt
    ? t
    : { ...t, index, frameStartedAt };
}

export function sceneReducer(
  frames: readonly SceneFrame[],
  timeline: SceneTimeline,
  action: SceneAction,
): SceneTimeline {
  if (frames.length === 0) return timeline;
  const { now } = action;
  const t = settle(frames, timeline, now);
  switch (action.type) {
    case "tick":
      return t;
    case "play": {
      if (t.playing) return t;
      // A frame paused at its end (a jump, a step, the initial cue) plays again from its start;
      // one paused midway resumes where it stopped.
      const hold = holdOf(frames[t.index]);
      const spent = t.pausedElapsed >= hold ? 0 : t.pausedElapsed;
      return { ...t, playing: true, frameStartedAt: now - spent / t.rate, pausedElapsed: 0 };
    }
    case "pause":
      if (!t.playing) return t;
      return { ...t, playing: false, pausedElapsed: frameElapsed(frames, t, now) };
    case "restart":
      return cueTimeline(frames, 0, { playing: true, rate: t.rate, now });
    case "step":
      return cueTimeline(frames, t.index + (Math.trunc(action.by) || 0), { rate: t.rate, now });
    case "jump":
      return cueTimeline(frames, action.index, { playing: t.playing, rate: t.rate, now });
    case "rate": {
      if (!validRate(action.rate) || action.rate === t.rate) return t;
      if (!t.playing) return { ...t, rate: action.rate };
      const spent = frameElapsed(frames, t, now);
      return { ...t, rate: action.rate, frameStartedAt: now - spent / action.rate };
    }
  }
}

/** The clock a composition reads, from a scene's frames and where its timeline stands. */
export function sceneClock(
  frames: readonly SceneFrame[],
  timeline: SceneTimeline,
  reduced: boolean,
): SceneClock {
  const index = frames.length > 0 ? wrap(timeline.index, frames.length) : 0;
  return { ...timeline, index, frames, frame: frames[index]?.key ?? "", reduced };
}

/** True when the clock is at `key` or a later frame. No clock → true: a static view is settled. */
export function reached(clock: SceneClock | null, key: string): boolean {
  if (clock === null) return true;
  const target = frameIndexOf(clock.frames, key);
  return target !== -1 && clock.index >= target;
}

/** True only while the clock is exactly at `key`. No clock → false. */
export function at(clock: SceneClock | null, key: string): boolean {
  return clock !== null && clock.frame === key;
}

// ---------------------------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------------------------

export const SceneContext = createContext<SceneClock | null>(null);
SceneContext.displayName = "SceneContext";

/** The clock of the live variant this component renders in, or null (a static variant, the app). */
export function useScene(): SceneClock | null {
  return useContext(SceneContext);
}

/**
 * Ms (at 1×, so comparable with a frame's `hold`) spent in the current frame. While playing it
 * updates every animation frame until the hold runs out — re-rendering only the component that
 * calls it, never the clock's other readers. Paused it is frozen; under reduced motion it is the
 * frame's hold, its end; without a clock it is 0.
 */
export function useFrameTime(): number {
  const clock = useScene();
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const moving = clock !== null && clock.playing && !clock.reduced;
  const frames = clock?.frames;
  const index = clock?.index ?? 0;
  const startedAt = clock?.frameStartedAt ?? 0;
  const rate = clock?.rate ?? 1;
  useEffect(() => {
    if (!moving || !frames) return;
    const hold = holdOf(frames[index]);
    let id = requestAnimationFrame(function loop() {
      redraw();
      if ((Date.now() - startedAt) * rate < hold) id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, [moving, frames, index, startedAt, rate]);
  if (clock === null) return 0;
  if (clock.reduced) return holdOf(clock.frames[clock.index]);
  return frameElapsed(clock.frames, clock, Date.now());
}
