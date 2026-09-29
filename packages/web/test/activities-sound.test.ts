import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, SoundProviderStatus } from "@prismshadow/penguin-server/api";
import {
  canGenerateSound,
  chosenProvider,
  lengthText,
  parseLength,
  providerOptions,
  soundCandidateLabel,
  soundFailure,
  soundPromptOf,
  soundMaxSeconds,
  withSoundPrompt,
} from "../src/features/activities/sound-model";

const eleven = (over: Partial<SoundProviderStatus> = {}): SoundProviderStatus => ({
  id: "elevenlabs",
  kinds: ["music", "sfx"],
  credential: "ELEVENLABS_API_KEY",
  models: { music: "music_v1", sfx: "sound-generation" },
  available: true,
  ...over,
});

it("offers exact local sound-effect providers with their clip limits", () => {
  const providers: SoundProviderStatus[] = [
    {
      id: "audiogen",
      kinds: ["sfx"],
      credential: "",
      models: { sfx: "facebook/audiogen-medium" },
      available: true,
    },
    {
      id: "audioldm",
      kinds: ["sfx"],
      credential: "",
      models: { sfx: "cvssp/audioldm-s-full-v2" },
      available: false,
      problem: "runtime_missing",
    },
  ];
  const options = providerOptions(providers, "sfx");
  expect(options[0]).toMatchObject({ label: "AudioGen (local)", problem: null });
  expect(options[1]?.problem).toBeTruthy();
  expect(soundMaxSeconds("audiogen")).toBe(10);
  expect(soundMaxSeconds("audioldm")).toBe(10);
  expect(soundMaxSeconds("musicgen")).toBe(30);
});

describe("a sound's prompt", () => {
  it("is the script, or the body of Loom's tag", () => {
    expect(soundPromptOf("gentle marimba")).toBe("gentle marimba");
    expect(soundPromptOf('<audio kind="music" loop="true">soft rain</audio>')).toBe("soft rain");
    expect(soundPromptOf(undefined)).toBe("");
  });

  it("is edited in place, keeping the tag and its attributes", () => {
    const tagged = '<audio kind="sfx" duration="3">door</audio>';
    expect(withSoundPrompt(tagged, "a heavy gate")).toBe(
      '<audio kind="sfx" duration="3">a heavy gate</audio>',
    );
    expect(withSoundPrompt("door", "a heavy gate")).toBe("a heavy gate");
    expect(withSoundPrompt(undefined, "rain ")).toBe("rain ");
  });
});

describe("the Length field", () => {
  it("shows seconds and reads 1 to 60 seconds, or empty for the model's choice", () => {
    expect(lengthText(undefined)).toBe("");
    expect(lengthText(3000)).toBe("3");
    expect(lengthText(2500)).toBe("2.5");
    expect(parseLength("")).toEqual({ ok: true, ms: undefined });
    expect(parseLength(" 12 ")).toEqual({ ok: true, ms: 12000 });
    expect(parseLength("1.25")).toEqual({ ok: true, ms: 1250 });
    for (const text of ["0.5", "61", "abc", "-3"]) expect(parseLength(text)).toEqual({ ok: false });
  });
});

describe("the Provider picker", () => {
  it("offers an available provider and names what an unavailable one needs", () => {
    expect(providerOptions([eleven()], "sfx")).toEqual([
      { id: "elevenlabs", label: "ElevenLabs", problem: null, models: [] },
    ]);
    const missing = providerOptions(
      [eleven({ available: false, problem: "credential_missing" })],
      "music",
    );
    expect(missing[0]!.problem).toContain("ELEVENLABS_API_KEY");
    expect(providerOptions([eleven({ kinds: ["music"] })], "sfx")[0]!.problem).toBeTruthy();
    expect(
      providerOptions(
        [eleven({ id: "agenthub", available: false, problem: "provider_unknown" })],
        "music",
      )[0],
    ).toMatchObject({ label: "Model", problem: expect.any(String) });
  });

  it("keeps the author's choice, else the first usable provider, else shows the first", () => {
    const usable = { id: "elevenlabs" as const, label: "ElevenLabs", problem: null, models: [] };
    const blocked = { id: "agenthub" as const, label: "Model", problem: "Not here.", models: [] };
    expect(chosenProvider([blocked, usable], null)).toBe(usable);
    expect(chosenProvider([blocked, usable], "agenthub")).toBe(blocked);
    expect(chosenProvider([blocked], null)).toBe(blocked);
    expect(chosenProvider([], null)).toBeNull();
  });

  it("allows Generate only with a usable provider, a valid length and a 1-2000 character prompt", () => {
    const usable = { id: "elevenlabs" as const, label: "ElevenLabs", problem: null, models: [] };
    expect(canGenerateSound("rain", usable, true)).toBe(true);
    expect(canGenerateSound("  ", usable, true)).toBe(false);
    expect(canGenerateSound("x".repeat(2001), usable, true)).toBe(false);
    expect(canGenerateSound("rain", usable, false)).toBe(false);
    expect(canGenerateSound("rain", { ...usable, problem: "Add a key." }, true)).toBe(false);
    expect(canGenerateSound("rain", null, true)).toBe(false);
  });
});

describe("sound candidates", () => {
  const run = (audio: ActivityRunSummary["audio"]) =>
    ({ runId: "run_1", kind: "audio", audio }) as ActivityRunSummary;

  it("are described by provider and requested length; speech keeps its voice", () => {
    const sound = {
      provider: "elevenlabs" as const,
      model: "sound-generation",
      kind: "sfx" as const,
      prompt: "door",
    };
    const base = { language: "en-US", assetKey: "door", script: "door", model: "m" };
    expect(soundCandidateLabel(run({ ...base, sound: { ...sound, targetDurationMs: 3000 } }))).toBe(
      "ElevenLabs · 3 s",
    );
    expect(soundCandidateLabel(run({ ...base, sound }))).toBe("ElevenLabs");
    expect(soundCandidateLabel(run({ ...base, voice: "Kore" }))).toBe("Kore");
  });

  it("word a refused plan or key", () => {
    expect(soundFailure("provider refused: plan or key")).toContain("plan or the key");
    expect(soundFailure("The session ended without sound.mp3.")).toBe(
      "The session ended without sound.mp3.",
    );
    expect(soundFailure(null)).toBeNull();
  });
});
