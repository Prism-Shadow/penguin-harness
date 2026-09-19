/**
 * The live-variant clock's pure half: frames advance when their hold runs out and loop, the rate
 * scales wall time, pausing keeps the time already spent, and a still sits at a frame's end.
 */
import { describe, expect, it } from "vitest";
import type { SceneFrame } from "../src/module";
import {
  at,
  cueTimeline,
  frameElapsed,
  msToNextFrame,
  reached,
  sceneClock,
  sceneReducer,
} from "../src/scene";
import type { SceneAction, SceneTimeline } from "../src/scene";

const FRAMES: readonly SceneFrame[] = [
  { key: "sent", title: "Sent", hold: 1000 },
  { key: "streaming", title: "Streaming", hold: 2000 },
  { key: "settled", title: "Settled", hold: 500 },
];

const run = (t: SceneTimeline, ...actions: SceneAction[]) =>
  actions.reduce((state, action) => sceneReducer(FRAMES, state, action), t);

const playing = (now = 0) => cueTimeline(FRAMES, 0, { playing: true, now });

describe("the scene clock", () => {
  it("advances when a frame's hold runs out and loops from the last frame to the first", () => {
    expect(run(playing(), { type: "tick", now: 999 }).index).toBe(0);
    expect(run(playing(), { type: "tick", now: 1000 }).index).toBe(1);
    const last = run(playing(), { type: "tick", now: 3100 });
    expect(last.index).toBe(2);
    expect(frameElapsed(FRAMES, last, 3100)).toBe(100);
    // 3500 ms is one whole loop: back on the first frame, at its start.
    const looped = run(playing(), { type: "tick", now: 3500 });
    expect(looped.index).toBe(0);
    expect(frameElapsed(FRAMES, looped, 3500)).toBe(0);
    // A tab hidden for many loops lands where the clock would be.
    expect(run(playing(), { type: "tick", now: 3500 * 1000 + 1200 }).index).toBe(1);
  });

  it("scales wall time by the rate, keeping the time spent when the rate changes", () => {
    const fast = cueTimeline(FRAMES, 0, { playing: true, rate: 2, now: 0 });
    expect(msToNextFrame(FRAMES, fast, 0)).toBe(500);
    expect(run(fast, { type: "tick", now: 500 }).index).toBe(1);
    const slowed = run(playing(), { type: "rate", rate: 0.5, now: 400 });
    expect(frameElapsed(FRAMES, slowed, 400)).toBe(400);
    expect(msToNextFrame(FRAMES, slowed, 400)).toBe(1200);
  });

  it("keeps the time spent across a pause, frozen while paused", () => {
    const paused = run(playing(), { type: "pause", now: 1500 });
    expect(paused).toMatchObject({ index: 1, playing: false, pausedElapsed: 500 });
    expect(frameElapsed(FRAMES, paused, 99_999)).toBe(500);
    expect(msToNextFrame(FRAMES, paused, 99_999)).toBeNull();
    const resumed = run(paused, { type: "play", now: 10_000 });
    expect(frameElapsed(FRAMES, resumed, 10_000)).toBe(500);
    expect(run(resumed, { type: "tick", now: 11_500 }).index).toBe(2);
  });

  it("holds a still at a frame's end, and plays that frame again from its start", () => {
    const paused = run(playing(), { type: "pause", now: 100 });
    const jumped = run(paused, { type: "jump", index: 1, now: 200 });
    expect(jumped).toMatchObject({ index: 1, playing: false });
    expect(frameElapsed(FRAMES, jumped, 200)).toBe(2000);
    const replay = run(jumped, { type: "play", now: 300 });
    expect(frameElapsed(FRAMES, replay, 300)).toBe(0);
    // A jump while playing keeps playing, from the frame's start.
    expect(run(playing(), { type: "jump", index: 2, now: 50 })).toMatchObject({
      index: 2,
      playing: true,
      frameStartedAt: 50,
    });
  });

  it("steps one frame either way, wrapping and pausing; restart plays from the first frame", () => {
    expect(run(playing(), { type: "step", by: -1, now: 10 })).toMatchObject({
      index: 2,
      playing: false,
    });
    const onLast = cueTimeline(FRAMES, 2, { now: 0 });
    expect(run(onLast, { type: "step", by: 1, now: 10 }).index).toBe(0);
    const restarted = run(onLast, { type: "restart", now: 70 });
    expect(restarted).toMatchObject({ index: 0, playing: true, frameStartedAt: 70 });
  });

  it("reads a static view as settled: reached is true and at is false without a clock", () => {
    expect(reached(null, "settled")).toBe(true);
    expect(at(null, "settled")).toBe(false);
    const clock = sceneClock(FRAMES, cueTimeline(FRAMES, 1, { now: 0 }), false);
    expect(clock.frame).toBe("streaming");
    const keys = ["sent", "streaming", "settled"];
    expect(keys.map((key) => reached(clock, key))).toEqual([true, true, false]);
    expect(keys.map((key) => at(clock, key))).toEqual([false, true, false]);
    expect(reached(clock, "no-such-frame")).toBe(false);
  });
});
