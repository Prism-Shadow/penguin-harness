import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { contentRevision, type ActivityDetail } from "../src/activities/domain.js";
import { planMedia } from "../src/activities/media.js";
import {
  audioMimeType,
  inspectGeneratedAudio,
  inspectMp3,
  soundTarget,
} from "../src/activities/sound.js";
import { soundProviderFor, soundSetup } from "../src/activities/audio-providers.js";
import { durationFromScript, soundPromptOf } from "../src/activities/playback.js";
import { activitySpec } from "./activity-fixtures.js";
import { soundMp3, speechWave } from "./audio-fixtures.js";

const FRAME_MS = (1152 * 1000) / 44100;

function activity(tracks: Record<string, unknown>[]): ActivityDetail {
  const base: ActivityDetail = {
    id: "act_one",
    collectionId: "col_one",
    productCode: "P",
    productId: null,
    displayName: null,
    stable: false,
    refNum: 1,
    title: "Sounds",
    activityType: "standard",
    archived: false,
    tags: [],
    createdAt: "",
    updatedAt: "",
    draft: {
      draftId: "draft_one",
      activityId: "act_one",
      baseVersionId: null,
      contentRevision: "",
      status: "valid",
      description: "Sounds",
      updatedAt: "",
      spec: {
        ...activitySpec,
        scenes: [{ id: "intro", description: "Listen", audio: { tracks } }],
      },
    },
  };
  return { ...base, draft: { ...base.draft, mediaPlan: planMedia(base) } };
}

const door = {
  key: "door",
  description: "A door",
  script: '<audio kind="sfx" duration="3s">a wooden door creaks open</audio>',
};
const theme = { key: "theme", description: "Theme", script: '<audio kind="music">marimba</audio>' };
const narration = { key: "hello", description: "Greeting", script: "Hello!" };

describe("what a sound run asks for", () => {
  it("takes the prompt from the tag body and the length from its duration", () => {
    const target = soundTarget(activity([door, theme]), {
      language: "en-US",
      assetKey: "door",
      provider: "elevenlabs",
    });
    expect(target).toEqual({
      language: "en-US",
      assetKey: "door",
      script: door.script,
      model: "sound-generation",
      sound: {
        provider: "elevenlabs",
        model: "sound-generation",
        kind: "sfx",
        prompt: "a wooden door creaks open",
        targetDurationMs: 3000,
      },
    });
    const music = soundTarget(activity([theme]), {
      language: "en-US",
      assetKey: "theme",
      provider: "elevenlabs",
    });
    expect(music.sound).toEqual({
      provider: "elevenlabs",
      model: "music_v1",
      kind: "music",
      prompt: "marimba",
    });
  });

  it("refuses narration, an empty or long prompt, an unknown provider and a stale plan", () => {
    const refusal = (value: ActivityDetail, assetKey: string, provider = "elevenlabs") => {
      try {
        soundTarget(value, { language: "en-US", assetKey, provider });
      } catch (error) {
        return (error as { code?: string }).code;
      }
      return "none";
    };
    expect(refusal(activity([narration]), "hello")).toBe("sound_invalid");
    expect(refusal(activity([{ ...door, script: '<audio kind="sfx">  </audio>' }]), "door")).toBe(
      "sound_invalid",
    );
    expect(
      refusal(
        activity([{ ...door, script: `<audio kind="sfx">${"x".repeat(2001)}</audio>` }]),
        "door",
      ),
    ).toBe("sound_invalid");
    expect(refusal(activity([door]), "missing")).toBe("sound_invalid");
    expect(refusal(activity([door]), "door", "musicgen")).toBe("sound_provider_unknown");
    const stale = activity([door]);
    stale.draft.mediaPlan!.specRevision = contentRevision({ other: true });
    expect(refusal(stale, "door")).toBe("media_stale");
  });
});

describe("the sound provider seam", () => {
  it("names the model per kind and the key a provider needs", () => {
    expect(soundProviderFor("music", "elevenlabs", ["ELEVENLABS_API_KEY"])).toEqual({
      provider: "elevenlabs",
      model: "music_v1",
    });
    expect(soundProviderFor("sfx", "elevenlabs", ["ELEVENLABS_API_KEY"])).toEqual({
      provider: "elevenlabs",
      model: "sound-generation",
    });
    expect(soundProviderFor("sfx", "elevenlabs", ["GEMINI_API_KEY"])).toEqual({
      problem: "credential_missing",
      credential: "ELEVENLABS_API_KEY",
    });
    // The model hub has no sound model in this build: a known provider with nothing to offer.
    expect(soundProviderFor("music", "agenthub", ["GEMINI_API_KEY"])).toEqual({
      problem: "no_model",
    });
    expect(soundProviderFor("sfx", "musicgen", ["GEMINI_API_KEY"])).toEqual({
      problem: "provider_unknown",
    });
  });

  it("reports each provider's availability for an agent's keys", () => {
    expect(soundSetup([])).toEqual([
      {
        id: "elevenlabs",
        kinds: ["music", "sfx"],
        credential: "ELEVENLABS_API_KEY",
        models: { music: "music_v1", sfx: "sound-generation" },
        available: false,
        problem: "credential_missing",
      },
      {
        id: "agenthub",
        kinds: ["music", "sfx"],
        credential: "",
        models: {},
        available: false,
        problem: "no_model",
        modelChoices: [],
      },
    ]);
    expect(soundSetup(["ELEVENLABS_API_KEY"])[0]).toMatchObject({ available: true });
    expect(soundSetup(["ELEVENLABS_API_KEY"])[0]).not.toHaveProperty("problem");
  });
});

describe("Loom's sound tags", () => {
  it("reads the prompt and a clamped length", () => {
    expect(soundPromptOf('<audio kind="music" loop="true"> soft rain </audio>')).toBe("soft rain");
    expect(soundPromptOf("  plain prompt ")).toBe("plain prompt");
    expect(soundPromptOf(undefined)).toBe("");
    expect(durationFromScript('<audio kind="sfx" duration="2.5">x</audio>')).toBe(2500);
    expect(durationFromScript('<audio kind="sfx" duration="90s">x</audio>')).toBe(60000);
    expect(durationFromScript('<audio kind="sfx" duration="0.2">x</audio>')).toBe(1000);
    expect(durationFromScript('<audio kind="sfx" duration="long">x</audio>')).toBeUndefined();
    expect(durationFromScript('<audio kind="sfx">x</audio>')).toBeUndefined();
    expect(durationFromScript("no tag")).toBeUndefined();
  });
});

describe("MP3 output", () => {
  it("accepts frames after an ID3 tag and sums their length", async () => {
    const fixture = await fs.readFile(new URL("./fixtures/sound-effect.mp3", import.meta.url));
    expect(fixture).toEqual(soundMp3());
    expect(inspectMp3(fixture, "run_test")).toMatchObject({
      runId: "run_test",
      bytes: fixture.length,
      durationMs: Math.round(20 * FRAME_MS),
      mimeType: "audio/mpeg",
      format: "mp3",
    });
    expect(inspectMp3(soundMp3(3, false), "run_test").durationMs).toBe(Math.round(3 * FRAME_MS));
    // An ID3v1 tag may close the file.
    const tagged = Buffer.concat([soundMp3(2), Buffer.from("TAG"), Buffer.alloc(125)]);
    expect(inspectMp3(tagged, "run_test").durationMs).toBe(Math.round(2 * FRAME_MS));
  });

  it("refuses what is not MPEG audio", () => {
    expect(() => inspectMp3(Buffer.alloc(0), "run_test")).toThrow();
    expect(() => inspectMp3(speechWave(), "run_test")).toThrow("not MPEG audio");
    // A tag with no audio after it.
    expect(() => inspectMp3(soundMp3(0), "run_test")).toThrow();
    // A cut-off last frame.
    expect(() => inspectMp3(soundMp3(2).subarray(0, 600), "run_test")).toThrow("Truncated");
    // Garbage between frames.
    const garbage = Buffer.concat([soundMp3(1), Buffer.from("junk"), soundMp3(1, false)]);
    expect(() => inspectMp3(garbage, "run_test")).toThrow("not MPEG audio");
    // A reserved bitrate.
    const bad = soundMp3(1, false);
    bad[2] = 0xf0;
    expect(() => inspectMp3(bad, "run_test")).toThrow();
    // Over the size limit.
    expect(() => inspectMp3(Buffer.alloc(20 * 1024 * 1024 + 1, 0xff), "run_test")).toThrow(
      "bounded",
    );
  });

  it("checks stored audio by its recorded format and names its type from its bytes", () => {
    expect(inspectGeneratedAudio(speechWave(), "run_test", undefined).mimeType).toBe("audio/wav");
    expect(inspectGeneratedAudio(soundMp3(), "run_test", "mp3").mimeType).toBe("audio/mpeg");
    expect(() => inspectGeneratedAudio(soundMp3(), "run_test", "wav")).toThrow();
    expect(audioMimeType(speechWave())).toBe("audio/wav");
    expect(audioMimeType(soundMp3())).toBe("audio/mpeg");
  });
});
