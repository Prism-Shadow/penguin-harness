import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/activities/media.js";
import { speechTargets, translationTargets } from "../src/activities/pipeline-run.js";
import { playbackFromScript, readPlayback } from "../src/activities/playback.js";

const usage = { sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 };
const address = { productCode: "words", refNum: 1 };
const music = {
  key: "theme",
  type: "audio",
  description: "Background music",
  script: "Calm piano",
  kind: "music",
  channel: "music",
  loop: true,
  volume: 0.4,
  usages: [{ ...usage, sourceKey: "theme" }],
};

describe("audio playback, as the module reads it", () => {
  it("keeps music's kind, channel, loop and volume through validation", () => {
    const manifest = validateManifest({ ...address, assets: { "en-US": [music] } }, address);
    expect(manifest.assets["en-US"]![0]).toEqual(music);
  });

  it("refuses half a setting, a volume out of range, or playback on an image", () => {
    const refuse = (asset: Record<string, unknown>) =>
      expect(() => validateManifest({ ...address, assets: { "en-US": [asset] } }, address)).toThrow(
        /playback/,
      );
    const { loop: _loop, ...noLoop } = music;
    refuse(noLoop);
    refuse({ ...music, volume: 1.5 });
    refuse({ ...music, kind: "speech" });
    refuse({ ...music, channel: "Music Channel" });
    refuse({ ...music, type: "image", script: undefined });
  });

  it("reads narration as having no playback", () => {
    expect(readPlayback({ key: "hi" })).toBeNull();
    expect(readPlayback({ kind: "sfx" })).toBe("invalid");
  });

  it("takes playback from a Loom audio tag, with the kind's defaults for the rest", () => {
    expect(playbackFromScript('<audio kind="music">Calm piano</audio>')).toEqual({
      kind: "music",
      channel: "music",
      loop: true,
      volume: 0.4,
    });
    expect(playbackFromScript("<audio kind=sfx loop='yes' volume=0.5>Pop</audio>")).toEqual({
      kind: "sfx",
      channel: "sfx",
      loop: true,
      volume: 0.5,
    });
    expect(playbackFromScript('<audio kind="speech">Hi</audio>')).toBeNull();
    expect(playbackFromScript("Plain narration")).toBeNull();
    expect(playbackFromScript('<audio kind="music" volume="9">x</audio>')?.volume).toBe(0.4);
  });

  it("does not speak or translate music and sound effects", () => {
    const manifest = validateManifest(
      {
        ...address,
        assets: {
          "en-US": [
            music,
            { key: "hi", type: "audio", description: "Hi", script: "Hi", usages: [usage] },
          ],
          "es-MX": [
            {
              key: "theme",
              type: "audio",
              description: "Música",
              kind: "music",
              channel: "music",
              loop: true,
              volume: 0.4,
              usages: [usage],
            },
            { key: "hi", type: "audio", description: "Hola", usages: [usage] },
          ],
        },
      },
      address,
    );
    expect(speechTargets(manifest)).toEqual([{ language: "en-US", assetKey: "hi" }]);
    expect(translationTargets(manifest)).toEqual([{ language: "es-MX", assetKey: "hi" }]);
  });
});
