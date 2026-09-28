import { describe, expect, it } from "vitest";
import type {
  ActivityRunSummary,
  AssetManifest,
  SoundProviderStatus,
} from "@prismshadow/penguin-server/api";
import {
  bulkSoundProvider,
  pendingSoundKinds,
  soundStatuses,
  soundTally,
} from "../src/features/activities/bulk-sound";

type MediaAsset = AssetManifest["assets"][string][number];

const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];
const sfx = (key: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
  key,
  type: "audio",
  kind: "sfx",
  description: key,
  script: `${key} sound`,
  usages: usage,
  ...over,
});

const soundRun = (
  assetKey: string,
  status: ActivityRunSummary["status"],
  createdAt: string,
  over: Partial<ActivityRunSummary> = {},
): ActivityRunSummary =>
  ({
    runId: `run_${assetKey}_${createdAt}`,
    kind: "audio",
    status,
    createdAt,
    error: status === "failed" ? "provider refused: plan or key" : null,
    audio: {
      language: "en-US",
      assetKey,
      script: `${assetKey} sound`,
      model: "sound-generation",
      sound: { provider: "elevenlabs", model: "sound-generation", kind: "sfx", prompt: "x" },
    },
    ...over,
  }) as unknown as ActivityRunSummary;

describe("the sounds a language still needs", () => {
  const assets: MediaAsset[] = [
    { key: "hello", type: "audio", description: "Narration", script: "Hello", usages: usage },
    sfx("chime", { path: "media/chime.mp3" }),
    sfx("whoosh"),
    sfx("drum", { kind: "music" }),
    sfx("ding"),
    sfx("empty", { script: '<audio kind="sfx"> </audio>' }),
    sfx("long", { script: "x".repeat(2001) }),
    { key: "cat", type: "image", description: "A cat", usages: usage },
  ];

  it("names each music and effect's state, leaving narration and images out", () => {
    const runs = [
      soundRun("whoosh", "failed", "2026-09-25T10:00:00Z"),
      soundRun("drum", "running", "2026-09-25T10:01:00Z"),
      // A failed run of another language does not count here.
      soundRun("ding", "failed", "2026-09-25T09:00:00Z", {
        audio: { language: "es-MX", assetKey: "ding" } as ActivityRunSummary["audio"],
      }),
    ];
    expect(soundStatuses(assets, runs, "en-US")).toEqual([
      { key: "chime", state: "ready" },
      { key: "whoosh", state: "failed", error: "provider refused: plan or key" },
      { key: "drum", state: "generating" },
      { key: "ding", state: "missing" },
      { key: "empty", state: "noPrompt" },
      { key: "long", state: "noPrompt" },
    ]);
  });

  it("counts what the stage would generate: missing and failed, not generating or unprompted", () => {
    expect(soundTally(assets, [soundRun("whoosh", "failed", "t1")], "en-US")).toEqual({
      total: 6,
      ready: 1,
      pending: 3,
      failed: 1,
      generating: 0,
      noPrompt: 2,
    });
    expect(soundTally([assets[0]!], [], "en-US").total).toBe(0);
  });

  it("ignores a narration's speech run for the same key", () => {
    const speech = soundRun("whoosh", "failed", "t2", {
      audio: { language: "en-US", assetKey: "whoosh", script: "", model: "m" } as never,
    });
    expect(soundStatuses([sfx("whoosh")], [speech], "en-US")).toEqual([
      { key: "whoosh", state: "missing" },
    ]);
  });
});

describe("the kinds still needed", () => {
  it("names the kinds of missing and failed sounds only", () => {
    const assets = [
      sfx("chime", { kind: "music", path: "media/chime.mp3" }),
      sfx("whoosh"),
      sfx("drum", { kind: "music" }),
    ];
    const runs = [soundRun("drum", "running", "2026-09-25T10:01:00Z")];
    expect(pendingSoundKinds(assets, runs, "en-US")).toEqual(["sfx"]);
    expect(pendingSoundKinds(assets, [], "en-US")).toEqual(["sfx", "music"]);
  });
});

describe("the provider the stage uses", () => {
  const status = (id: "elevenlabs" | "agenthub", available: boolean): SoundProviderStatus => ({
    id,
    kinds: ["music", "sfx"],
    credential: id === "elevenlabs" ? "ELEVENLABS_API_KEY" : "",
    models: {},
    available,
  });

  it("is ElevenLabs when its key is present, else the first the agent can use", () => {
    expect(bulkSoundProvider([status("elevenlabs", true), status("agenthub", true)])).toEqual({
      id: "elevenlabs",
      available: true,
    });
    expect(bulkSoundProvider([status("elevenlabs", false), status("agenthub", true)])).toEqual({
      id: "agenthub",
      available: true,
    });
  });

  it("prefers one that makes every kind still needed, and passes over one that makes none", () => {
    // The hub's only usable model makes effects; its music model has no key.
    const hub: SoundProviderStatus = {
      ...status("agenthub", true),
      modelChoices: [
        { id: "fx", kinds: ["sfx"], credential: "FX_KEY", available: true },
        { id: "tunes", kinds: ["music"], credential: "MUSIC_KEY", available: false },
      ],
    };
    const eleven = status("elevenlabs", true);
    expect(bulkSoundProvider([hub, eleven], ["music", "sfx"])).toEqual({
      id: "elevenlabs",
      available: true,
    });
    expect(bulkSoundProvider([hub, status("elevenlabs", false)], ["music", "sfx"])).toEqual({
      id: "agenthub",
      available: true,
    });
    expect(bulkSoundProvider([hub, status("elevenlabs", false)], ["music"])).toEqual({
      id: "elevenlabs",
      available: false,
    });
  });

  it("stays ElevenLabs, marked unavailable, when none can be used", () => {
    expect(bulkSoundProvider([status("elevenlabs", false), status("agenthub", false)])).toEqual({
      id: "elevenlabs",
      available: false,
    });
    expect(bulkSoundProvider(null)).toEqual({ id: "elevenlabs", available: false });
  });
});
