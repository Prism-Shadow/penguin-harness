import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import {
  SPEECH_SCRIPT_MAX,
  neediestLanguage,
  pendingSpeechKeys,
  speechScriptUsable,
  speechStatuses,
  speechTally,
} from "../src/features/activities/bulk-speech";
import {
  clipTime,
  normalizePeaks,
  playedFraction,
  seekTime,
  waveformPeaks,
} from "../src/features/activities/waveform";

type MediaAsset = AssetManifest["assets"][string][number];

function asset(over: Partial<MediaAsset> & Pick<MediaAsset, "key">): MediaAsset {
  return {
    type: "audio",
    description: `${over.key} description`,
    usages: [{ sceneId: "intro", sourceKey: over.key, occurrence: 1, sceneOccurrenceCount: 1 }],
    ...over,
  } as MediaAsset;
}

const assets: MediaAsset[] = [
  asset({ key: "bound_generated", script: "Hi", path: "media/generated/run_x.wav" }),
  asset({ key: "bound_upload", script: "Hi", path: "media/uploads/hi-1234abcd.wav" }),
  asset({ key: "needs_speech", script: "Say this" }),
  asset({ key: "also_needs", script: "And this" }),
  asset({ key: "no_script", script: "   " }),
  asset({ key: "script_too_long", script: "a".repeat(SPEECH_SCRIPT_MAX + 1) }),
  asset({ key: "a_picture", type: "image" }),
];

describe("speech readiness", () => {
  it("treats any binding as ready, however the audio got there", () => {
    const states = Object.fromEntries(
      speechStatuses(assets).map((status) => [status.key, status.state]),
    );
    expect(states.bound_generated).toBe("ready");
    expect(states.bound_upload).toBe("ready");
    expect(states.needs_speech).toBe("missing");
  });

  it("separates what cannot be generated from what simply has not been", () => {
    const states = Object.fromEntries(
      speechStatuses(assets).map((status) => [status.key, status.state]),
    );
    expect(states.no_script).toBe("scriptMissing");
    expect(states.script_too_long).toBe("scriptTooLong");
  });

  it("looks only at narration", () => {
    expect(speechStatuses(assets).some((status) => status.key === "a_picture")).toBe(false);
    expect(speechStatuses([])).toEqual([]);
  });

  it("names the scenes asking for a narration, once each", () => {
    const shared = asset({
      key: "shared",
      usages: [
        { sceneId: "intro", sourceKey: "shared", occurrence: 1, sceneOccurrenceCount: 2 },
        { sceneId: "intro", sourceKey: "shared", occurrence: 2, sceneOccurrenceCount: 2 },
        { sceneId: "quiz", sourceKey: "shared", occurrence: 1, sceneOccurrenceCount: 1 },
      ],
    });
    expect(speechStatuses([shared])[0]!.sceneIds).toEqual(["intro", "quiz"]);
  });

  it("agrees with itself about what a bulk run would do", () => {
    expect(pendingSpeechKeys(assets)).toEqual(["needs_speech", "also_needs"]);
    expect(pendingSpeechKeys(assets)).toHaveLength(speechTally(assets).pending);
  });

  it("counts every narration exactly once", () => {
    const tally = speechTally(assets);
    expect(tally).toEqual({ total: 6, ready: 2, pending: 2, blocked: 2 });
    expect(tally.ready + tally.pending + tally.blocked).toBe(tally.total);
    expect(speechTally([])).toEqual({ total: 0, ready: 0, pending: 0, blocked: 0 });
  });

  it("judges a script by the endpoint's own limit", () => {
    expect(speechScriptUsable(asset({ key: "a", script: "Hello" }))).toBe(true);
    expect(speechScriptUsable(asset({ key: "a", script: " " }))).toBe(false);
    expect(speechScriptUsable(asset({ key: "a" }))).toBe(false);
    expect(speechScriptUsable(asset({ key: "a", script: "a".repeat(SPEECH_SCRIPT_MAX) }))).toBe(
      true,
    );
    expect(speechScriptUsable(asset({ key: "a", script: "a".repeat(SPEECH_SCRIPT_MAX + 1) }))).toBe(
      false,
    );
  });

  it("opens on the language with the most speech still to do", () => {
    const manifest = {
      productCode: "p",
      refNum: 1,
      assets: {
        "en-US": [asset({ key: "a", script: "x", path: "media/a.wav" })],
        "fr-FR": [asset({ key: "a", script: "x" }), asset({ key: "b", script: "y" })],
      },
    } as unknown as AssetManifest;
    expect(neediestLanguage(manifest)).toBe("fr-FR");
    expect(
      neediestLanguage({ productCode: "p", refNum: 1, assets: {} } as unknown as AssetManifest),
    ).toBe("en-US");
  });
});

describe("waveform arithmetic", () => {
  it("keeps the loudest sample in each column, not the average", () => {
    const samples = new Float32Array([0, 0, 0, 0.9, 0, 0, 0, 0.1]);
    const peaks = waveformPeaks(samples, 2);
    // Float32 storage, so compare within its precision rather than exactly.
    expect(peaks[0]).toBeCloseTo(0.9, 6);
    expect(peaks[1]).toBeCloseTo(0.1, 6);
  });

  it("covers every sample and never reads past the end", () => {
    const samples = new Float32Array([0.2, 0.4, 0.6]);
    const exact = waveformPeaks(samples, 3);
    expect(exact).toHaveLength(3);
    for (const [index, value] of [0.2, 0.4, 0.6].entries())
      expect(exact[index]).toBeCloseTo(value, 6);
    expect(waveformPeaks(samples, 5)).toHaveLength(5);
    expect(waveformPeaks(samples, 5).every((value) => value > 0)).toBe(true);
  });

  it("returns nothing to draw rather than failing on empty input", () => {
    expect(waveformPeaks(new Float32Array(), 10)).toEqual([]);
    expect(waveformPeaks(new Float32Array([0.5]), 0)).toEqual([]);
  });

  it("lifts quiet narration to fill the height, and leaves silence flat", () => {
    expect(normalizePeaks([0.1, 0.05, 0.2])).toEqual([0.5, 0.25, 1]);
    expect(normalizePeaks([0, 0])).toEqual([0, 0]);
    expect(normalizePeaks([])).toEqual([]);
  });

  it("maps a click to a position inside the clip", () => {
    expect(seekTime(50, 100, 10)).toBe(5);
    expect(seekTime(-10, 100, 10)).toBe(0);
    expect(seekTime(500, 100, 10)).toBe(10);
    expect(seekTime(50, 0, 10)).toBe(0);
    expect(seekTime(50, 100, 0)).toBe(0);
    expect(seekTime(Number.NaN, 100, 10)).toBe(0);
  });

  it("reports progress as a clamped fraction", () => {
    expect(playedFraction(5, 10)).toBe(0.5);
    expect(playedFraction(20, 10)).toBe(1);
    expect(playedFraction(-1, 10)).toBe(0);
    expect(playedFraction(5, 0)).toBe(0);
    expect(playedFraction(Number.NaN, 10)).toBe(0);
  });

  it("reads a clip position as minutes and seconds", () => {
    expect(clipTime(0)).toBe("0:00");
    expect(clipTime(9.7)).toBe("0:09");
    expect(clipTime(65)).toBe("1:05");
    expect(clipTime(600)).toBe("10:00");
    expect(clipTime(-1)).toBe("0:00");
    expect(clipTime(Number.NaN)).toBe("0:00");
  });
});
