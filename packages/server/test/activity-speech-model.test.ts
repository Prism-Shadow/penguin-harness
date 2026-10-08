import { describe, expect, it } from "vitest";
import { audioTarget } from "../src/activities/audio.js";
import { contentRevision, type ActivityDetail } from "../src/activities/domain.js";
import { validateManifest, type MediaAsset } from "../src/activities/media.js";

const address = { productCode: "p", refNum: 1 };
const VOICE = "21m00Tcm4TlvDq8ikWAM";

function manifest(asset: Record<string, unknown>) {
  return {
    ...address,
    assets: { "en-US": [{ key: "a", description: "d", usages: [], ...asset }] },
  };
}

/** Just enough of an activity for `audioTarget`: a valid draft whose plan is current. */
function activity(asset: Partial<MediaAsset>): ActivityDetail {
  const spec = { title: "t" };
  return {
    draft: {
      status: "valid",
      spec,
      mediaPlan: {
        specRevision: contentRevision(spec),
        manifest: {
          ...address,
          assets: {
            "en-US": [
              { key: "a", type: "audio", description: "d", script: "Hello.", usages: [], ...asset },
            ],
          },
        },
      },
    },
  } as unknown as ActivityDetail;
}

describe("a narration's ElevenLabs model", () => {
  it("is kept in the manifest for a narration and refused anywhere else", () => {
    expect(
      validateManifest(manifest({ type: "audio", speechModel: "eleven_v4" }), address).assets[
        "en-US"
      ]![0]!.speechModel,
    ).toBe("eleven_v4");
    expect(
      validateManifest(manifest({ type: "audio" }), address).assets["en-US"]![0]!.speechModel,
    ).toBeUndefined();
    expect(() =>
      validateManifest(manifest({ type: "audio", speechModel: "eleven_v9" }), address),
    ).toThrow(/ElevenLabs model/);
    expect(() =>
      validateManifest(manifest({ type: "image", speechModel: "eleven_v3" }), address),
    ).toThrow(/ElevenLabs model/);
    expect(() =>
      validateManifest(
        manifest({
          type: "audio",
          kind: "music",
          channel: "music",
          loop: true,
          volume: 0.4,
          speechModel: "eleven_v3",
        }),
        address,
      ),
    ).toThrow(/ElevenLabs model/);
  });

  it("is what an ElevenLabs run speaks with, eleven_v3 when the narration names none", () => {
    const input = { language: "en-US", assetKey: "a", voice: VOICE };
    expect(
      audioTarget(activity({ speechProvider: "elevenlabs", speechModel: "eleven_v4" }), input)
        .model,
    ).toBe("eleven_v4");
    expect(audioTarget(activity({}), input).model).toBe("eleven_v3");
    // A request naming its own model still wins over the saved one.
    expect(
      audioTarget(activity({ speechModel: "eleven_v4" }), {
        ...input,
        model: "eleven_multilingual_v2",
      }).model,
    ).toBe("eleven_multilingual_v2");
  });

  it("is ignored by Gemini", () => {
    expect(
      audioTarget(activity({ speechProvider: "gemini", speechModel: "eleven_v4" }), {
        language: "en-US",
        assetKey: "a",
        voice: "Kore",
      }).model,
    ).not.toBe("eleven_v4");
  });
});
