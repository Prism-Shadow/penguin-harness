/**
 * A scene's addresses and the framed embeds' clock messages: an embed holds still, settled, unless
 * told otherwise, its params ride beside the view state in one URL, and a frame follows only the
 * clock meant for the variant it shows.
 */
import { describe, expect, it } from "vitest";
import type { SceneFrame } from "../../ui/src/module";
import { sceneClock } from "../../ui/src/scene";
import {
  clockMessage,
  controlMessage,
  parseEmbedCue,
  readClockMessage,
  readControlMessage,
} from "../src/lib/live";
import { DEFAULT_STATE, formatGalleryQuery, parseGalleryState } from "../src/lib/url-state";
import type { GalleryState } from "../src/lib/url-state";

const FRAMES: readonly SceneFrame[] = [
  { key: "expanded", title: "Expanded", hold: 1600 },
  { key: "rail", title: "Rail", hold: 1400 },
  { key: "tooltip", title: "Tooltip", hold: 1400 },
];

describe("a scene's embed address", () => {
  it("holds still on the last frame unless `frame` or `play` say otherwise", () => {
    expect(parseEmbedCue(FRAMES, "")).toEqual({ index: 2, playing: false });
    expect(parseEmbedCue(FRAMES, "?frame=rail")).toEqual({ index: 1, playing: false });
    expect(parseEmbedCue(FRAMES, "?play=1")).toEqual({ index: 0, playing: true });
    expect(parseEmbedCue(FRAMES, "?frame=rail&play=1")).toEqual({ index: 1, playing: true });
    expect(parseEmbedCue(FRAMES, "?frame=gone&play=0")).toEqual({ index: 2, playing: false });
  });

  it("round-trips beside the view state in one URL", () => {
    const state: GalleryState = {
      ...DEFAULT_STATE,
      theme: "modern",
      view: "phone",
      motion: "reduced",
    };
    const query = formatGalleryQuery(state, {
      module: "navigation",
      variant: "sidebar",
      frame: "rail",
      play: "1",
    });
    expect(query).toBe(
      "?theme=modern&mode=light&tier=md&lang=en&accent=neutral&module=navigation&variant=sidebar&frame=rail&play=1&view=phone&motion=reduced",
    );
    expect(parseGalleryState(query)).toEqual(state);
    expect(parseEmbedCue(FRAMES, query)).toEqual({ index: 1, playing: true });
  });
});

describe("the framed embeds' clock messages", () => {
  const timeline = { index: 1, playing: true, rate: 2, frameStartedAt: 1000, pausedElapsed: 0 };
  const message = clockMessage("navigation", "sidebar", sceneClock(FRAMES, timeline, true));

  it("carry the timeline alone, and reach only the variant they name", () => {
    expect(readClockMessage(message, "navigation", "sidebar")).toEqual(timeline);
    expect(readClockMessage(message, "navigation", "collapsed")).toBeNull();
    expect(readClockMessage(message, "overlays", "sidebar")).toBeNull();
  });

  it("are refused when malformed", () => {
    const broken = { ...message, timeline: { ...timeline, rate: 0 } };
    expect(readClockMessage(broken, "navigation", "sidebar")).toBeNull();
    expect(readClockMessage({ type: "gallery:height" }, "navigation", "sidebar")).toBeNull();
    expect(readClockMessage(null, "navigation", "sidebar")).toBeNull();
  });
});

describe("a framed composition's commands for the card's clock", () => {
  it("come back as the controls' commands, for the variant they name", () => {
    for (const command of [
      { type: "play" as const },
      { type: "pause" as const },
      { type: "restart" as const },
      { type: "settle" as const },
      { type: "playFrom" as const, index: 2 },
    ]) {
      const message = controlMessage("hero", "settled", command);
      expect(readControlMessage(message, "hero", "settled")).toEqual(command);
      expect(readControlMessage(message, "hero", "empty")).toBeNull();
    }
  });

  it("are refused when malformed, or when they are not a composition's to send", () => {
    const at = (command: unknown) =>
      readControlMessage(
        { type: "gallery:control", module: "hero", variant: "settled", command },
        "hero",
        "settled",
      );
    expect(at({ type: "playFrom" })).toBeNull();
    expect(at({ type: "playFrom", index: "two" })).toBeNull();
    expect(at({ type: "step", by: 1 })).toBeNull();
    expect(at({ type: "rate", rate: 2 })).toBeNull();
    expect(at(undefined)).toBeNull();
    expect(readControlMessage(null, "hero", "settled")).toBeNull();
  });
});
