/**
 * The scene clock's pure half: frames advance when their hold runs out and the clock settles past
 * the last one, play from a settled clock starts over, the rate scales wall time, pausing keeps
 * the time already spent, and a still sits at a frame's end.
 */
import { describe, expect, it } from "vitest";
import type { SceneFrame } from "../src/module";
import {
  at,
  cueTimeline,
  frameElapsed,
  isSettled,
  msToNextFrame,
  reached,
  sceneClock,
  sceneControls,
  sceneReducer,
  settledTimeline,
} from "../src/scene";
import type { SceneAction, SceneCommand, SceneTimeline } from "../src/scene";

const FRAMES: readonly SceneFrame[] = [
  { key: "sent", title: "Sent", hold: 1000 },
  { key: "streaming", title: "Streaming", hold: 2000 },
  { key: "settled", title: "Settled", hold: 500 },
];

const run = (t: SceneTimeline, ...actions: SceneAction[]) =>
  actions.reduce((state, action) => sceneReducer(FRAMES, state, action), t);

const playing = (now = 0) => cueTimeline(FRAMES, 0, { playing: true, now });

describe("the scene clock", () => {
  it("rests settled: paused at the end of the last frame, which is what a card shows unasked", () => {
    const rest = settledTimeline(FRAMES, 0);
    expect(rest).toMatchObject({ index: 2, playing: false, pausedElapsed: 500 });
    expect(isSettled(FRAMES, rest)).toBe(true);
    expect(msToNextFrame(FRAMES, rest, 99_999)).toBeNull();
    expect(frameElapsed(FRAMES, rest, 99_999)).toBe(500);
    // Neither a playing clock nor one paused midway is settled.
    expect(isSettled(FRAMES, playing())).toBe(false);
    expect(isSettled(FRAMES, run(playing(), { type: "pause", now: 1500 }))).toBe(false);
    expect(isSettled(FRAMES, cueTimeline(FRAMES, 1, { now: 0 }))).toBe(false);
  });

  it("advances when a frame's hold runs out and settles past the last frame, never looping", () => {
    expect(run(playing(), { type: "tick", now: 999 }).index).toBe(0);
    expect(run(playing(), { type: "tick", now: 1000 }).index).toBe(1);
    const last = run(playing(), { type: "tick", now: 3100 });
    expect(last).toMatchObject({ index: 2, playing: true });
    expect(frameElapsed(FRAMES, last, 3100)).toBe(100);
    // 3500 ms is the whole scene: it has run, and rests on the last frame's end.
    const done = run(playing(), { type: "tick", now: 3500 });
    expect(done).toMatchObject({ index: 2, playing: false, pausedElapsed: 500 });
    expect(isSettled(FRAMES, done)).toBe(true);
    // A tab hidden for an hour comes back settled, not somewhere in a loop.
    expect(isSettled(FRAMES, run(playing(), { type: "tick", now: 3_600_000 }))).toBe(true);
    // A settled clock stays put through further ticks.
    expect(run(done, { type: "tick", now: 9_999 })).toEqual(done);
  });

  it("plays again from the first frame when played while settled", () => {
    const rest = settledTimeline(FRAMES, 0);
    const again = run(rest, { type: "play", now: 5000 });
    expect(again).toMatchObject({ index: 0, playing: true, frameStartedAt: 5000 });
    expect(frameElapsed(FRAMES, again, 5000)).toBe(0);
    expect(run(again, { type: "tick", now: 6000 }).index).toBe(1);
    // A rate set while settled carries into the replay.
    const fast = run(rest, { type: "rate", rate: 2, now: 10 }, { type: "play", now: 20 });
    expect(fast.rate).toBe(2);
    expect(msToNextFrame(FRAMES, fast, 20)).toBe(500);
  });

  it("scales wall time by the rate, keeping the time spent when the rate changes", () => {
    const fast = cueTimeline(FRAMES, 0, { playing: true, rate: 2, now: 0 });
    expect(msToNextFrame(FRAMES, fast, 0)).toBe(500);
    expect(run(fast, { type: "tick", now: 500 }).index).toBe(1);
    const slowed = run(playing(), { type: "rate", rate: 0.5, now: 400 });
    expect(frameElapsed(FRAMES, slowed, 400)).toBe(400);
    expect(msToNextFrame(FRAMES, slowed, 400)).toBe(1200);
  });

  it("keeps the time spent across a pause, frozen while paused, and resumes from there", () => {
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
    expect(replay).toMatchObject({ index: 1, playing: true });
    expect(frameElapsed(FRAMES, replay, 300)).toBe(0);
    // A jump while playing keeps playing, from the frame's start; on the last frame it then settles.
    const onLast = run(playing(), { type: "jump", index: 2, now: 50 });
    expect(onLast).toMatchObject({ index: 2, playing: true, frameStartedAt: 50 });
    expect(isSettled(FRAMES, run(onLast, { type: "tick", now: 550 }))).toBe(true);
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

  it("settles on request, keeping the rate, and plays on from a named frame", () => {
    const fast = run(playing(), { type: "rate", rate: 2, now: 100 });
    const settled = run(fast, { type: "settle", now: 200 });
    expect(isSettled(FRAMES, settled)).toBe(true);
    expect(settled.rate).toBe(2);
    // A repeated ask changes nothing, so nothing re-renders for it.
    expect(run(settled, { type: "settle", now: 300 })).toBe(settled);
    const from = run(settled, { type: "playFrom", index: 1, now: 400 });
    expect(from).toMatchObject({ index: 1, playing: true, frameStartedAt: 400, rate: 2 });
    expect(isSettled(FRAMES, run(from, { type: "tick", now: 400 + 1250 }))).toBe(true);
  });

  it("gives a composition controls that are single commands to whatever runs the clock", () => {
    const sent: SceneCommand[] = [];
    const controls = sceneControls(FRAMES, (command) => sent.push(command));
    controls.play();
    controls.pause();
    controls.restart();
    controls.settle();
    controls.playFrom("streaming");
    controls.playFrom("no-such-frame");
    expect(sent).toEqual([
      { type: "play" },
      { type: "pause" },
      { type: "restart" },
      { type: "settle" },
      { type: "playFrom", index: 1 },
      { type: "playFrom", index: 0 },
    ]);
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
