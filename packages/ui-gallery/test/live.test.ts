/**
 * A live variant's addresses and the compare frames' clock messages: an embed holds still on the
 * last frame unless told otherwise, its params ride beside the view state in one URL, and a frame
 * follows only the clock meant for the variant it shows.
 */
import { describe, expect, it } from "vitest";
import type { SceneFrame } from "../../ui/src/module";
import { sceneClock } from "../../ui/src/scene";
import { clockMessage, parseEmbedCue, readClockMessage } from "../src/lib/live";
import { DEFAULT_STATE, formatGalleryQuery, parseGalleryState } from "../src/lib/url-state";
import type { GalleryState } from "../src/lib/url-state";

const FRAMES: readonly SceneFrame[] = [
  { key: "expanded", title: "Expanded", hold: 1600 },
  { key: "rail", title: "Rail", hold: 1400 },
  { key: "tooltip", title: "Tooltip", hold: 1400 },
];

describe("a live variant's embed address", () => {
  it("holds still on the last frame unless `frame` or `play` say otherwise", () => {
    expect(parseEmbedCue(FRAMES, "")).toEqual({ index: 2, playing: false });
    expect(parseEmbedCue(FRAMES, "?frame=rail")).toEqual({ index: 1, playing: false });
    expect(parseEmbedCue(FRAMES, "?play=1")).toEqual({ index: 0, playing: true });
    expect(parseEmbedCue(FRAMES, "?frame=rail&play=1")).toEqual({ index: 1, playing: true });
    expect(parseEmbedCue(FRAMES, "?frame=gone&play=0")).toEqual({ index: 2, playing: false });
  });

  it("round-trips beside the view state in one URL", () => {
    const state: GalleryState = { ...DEFAULT_STATE, theme: "modern", motion: "reduced" };
    const query = formatGalleryQuery(state, {
      module: "navigation",
      variant: "live-collapse",
      frame: "rail",
      play: "1",
    });
    expect(query).toBe(
      "?theme=modern&mode=light&tier=md&lang=en&module=navigation&variant=live-collapse&frame=rail&play=1&motion=reduced",
    );
    expect(parseGalleryState(query)).toEqual(state);
    expect(parseEmbedCue(FRAMES, query)).toEqual({ index: 1, playing: true });
  });
});

describe("the compare frames' clock messages", () => {
  const timeline = { index: 1, playing: true, rate: 2, frameStartedAt: 1000, pausedElapsed: 0 };
  const message = clockMessage("navigation", "live-collapse", sceneClock(FRAMES, timeline, true));

  it("carry the timeline alone, and reach only the variant they name", () => {
    expect(readClockMessage(message, "navigation", "live-collapse")).toEqual(timeline);
    expect(readClockMessage(message, "navigation", "collapsed")).toBeNull();
    expect(readClockMessage(message, "overlays", "live-collapse")).toBeNull();
  });

  it("are refused when malformed", () => {
    const broken = { ...message, timeline: { ...timeline, rate: 0 } };
    expect(readClockMessage(broken, "navigation", "live-collapse")).toBeNull();
    expect(readClockMessage({ type: "gallery:height" }, "navigation", "live-collapse")).toBeNull();
    expect(readClockMessage(null, "navigation", "live-collapse")).toBeNull();
  });
});
