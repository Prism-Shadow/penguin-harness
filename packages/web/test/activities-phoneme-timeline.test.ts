import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import {
  activeCue,
  wordRecordingTally,
  wordTimeline,
} from "../src/features/activities/phoneme-timeline";

type MediaAsset = AssetManifest["assets"][string][number];

const word = (extra: Partial<MediaAsset> = {}): MediaAsset => ({
  key: "book-word-cat",
  type: "audio",
  role: "bookWord",
  description: "Pronunciation of “cat”.",
  word: "cat",
  normalizedWord: "cat",
  phonemes: ["k", "æ", "t"],
  usages: [],
  ...extra,
});

const timed = word({
  path: "media/generated/cat.mp3",
  phonemeTimings: [
    { phoneme: "k", startMs: 0, endMs: 400 },
    { phoneme: "æ", startMs: 400, endMs: 800 },
    { phoneme: "t", startMs: 800, endMs: 1200 },
  ],
  wholeWordTiming: { startMs: 1500, endMs: 1900 },
});

describe("a word's sound timeline", () => {
  it("lists each sound and then the whole word, from the stored timings", () => {
    expect(wordTimeline(timed)).toEqual([
      { label: "k", startMs: 0, endMs: 400, whole: false },
      { label: "æ", startMs: 400, endMs: 800, whole: false },
      { label: "t", startMs: 800, endMs: 1200, whole: false },
      { label: "cat", startMs: 1500, endMs: 1900, whole: true },
    ]);
  });

  it("marks the cue being said, and none between or after them", () => {
    const cues = wordTimeline(timed)!;
    expect(activeCue(cues, 0)).toBe(0);
    expect(activeCue(cues, 450)).toBe(1);
    expect(activeCue(cues, 1300)).toBe(-1);
    expect(activeCue(cues, 1600)).toBe(3);
    expect(activeCue(cues, 2000)).toBe(-1);
  });

  it("shares a Loom recording's two word timings between the sounds", () => {
    const imported = word({
      path: "media/cat.mp3",
      wordTimings: [
        { word: "kæt", startMs: 300, endMs: 900 },
        { word: "cat", startMs: 1000, endMs: 1300 },
      ],
    });
    expect(wordTimeline(imported)!.map((cue) => [cue.label, cue.startMs, cue.endMs])).toEqual([
      ["k", 300, 500],
      ["æ", 500, 700],
      ["t", 700, 900],
      ["cat", 1000, 1300],
    ]);
  });

  it("has no timeline without a recording, for untimed recordings, or for changed sounds", () => {
    expect(wordTimeline(word())).toBeNull();
    expect(wordTimeline(word({ path: "media/cat.wav" }))).toBeNull();
    expect(wordTimeline({ ...timed, phonemes: ["k", "a", "t"] })).toBeNull();
  });

  it("counts the words ready to record and the recorded ones without timings", () => {
    const narration = {
      key: "narration-1",
      type: "audio",
      description: "Narration",
      usages: [],
    } as MediaAsset;
    expect(
      wordRecordingTally([
        timed,
        word({ key: "a" }),
        word({ key: "b", phonemes: undefined }),
        word({ key: "c", path: "media/c.wav" }),
        narration,
      ]),
    ).toEqual({ toRecord: 1, untimed: 1 });
  });
});
