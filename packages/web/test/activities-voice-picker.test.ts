import { describe, expect, it } from "vitest";
import type { MediaAsset, VoiceOption } from "@prismshadow/penguin-server/api";
import {
  NO_VOICE_FILTERS,
  applyVoice,
  facetValues,
  filterVoices,
  matchesVoice,
  mixedVoice,
  optionsFromVoices,
  shownFacet,
  tokens,
  voiceDetails,
  voiceFor,
} from "../src/features/activities/voice-catalogue";

const gemini = (id: string): VoiceOption => ({
  id,
  label: id,
  provider: "Gemini",
  model: "tts",
  languages: [],
  previewUrl: null,
});
const catalogue: VoiceOption[] = ["Kore", "Puck", "Charon", "Fenrir", "Aoede"].map(gemini);
const other: VoiceOption = {
  id: "warm_story-teller",
  label: "Warm StoryTeller",
  provider: "Other",
  model: "v2",
  languages: ["es-MX"],
  previewUrl: "https://example.test/warm.mp3",
};
const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];
const narration = (key: string, voice?: string): MediaAsset => ({
  key,
  type: "audio",
  description: key,
  script: key,
  ...(voice ? { voice } : {}),
  usages: usage,
});

describe("voice search", () => {
  it("splits names at spaces, underscores, dashes and camelCase humps", () => {
    expect(tokens("Warm StoryTeller")).toEqual(["warm", "story", "teller"]);
    expect(tokens("warm_story-teller")).toEqual(["warm", "story", "teller"]);
    expect(tokens("HTTPVoice2")).toEqual(["http", "voice2"]);
    expect(tokens("  ")).toEqual([]);
  });

  it("finds a voice by part of its name or id, every word of the query", () => {
    expect(filterVoices(catalogue, { ...NO_VOICE_FILTERS, query: "fen" }).map((o) => o.id)).toEqual(
      ["Fenrir"],
    );
    expect(matchesVoice(other, "story teller")).toBe(true);
    expect(matchesVoice(other, "storyteller")).toBe(true);
    expect(matchesVoice(other, "warm_story")).toBe(true);
    expect(matchesVoice(other, "cold")).toBe(false);
    expect(matchesVoice(other, "")).toBe(true);
  });

  it("narrows by provider, model and language, a voice naming no language speaking all", () => {
    const all = [...catalogue, other];
    const pick = (filters: Partial<typeof NO_VOICE_FILTERS>) =>
      filterVoices(all, { ...NO_VOICE_FILTERS, ...filters }).map((o) => o.id);
    expect(pick({ provider: "Other" })).toEqual(["warm_story-teller"]);
    expect(pick({ model: "tts" })).toHaveLength(5);
    expect(pick({ language: "es-MX" })).toHaveLength(6);
    expect(pick({ language: "ro-RO" })).toHaveLength(5);
    expect(pick({ provider: "Gemini", query: "warm" })).toEqual([]);
  });
});

describe("voice facets and details", () => {
  it("offers a filter only where there are two values to choose between", () => {
    const one = facetValues(catalogue);
    expect(one).toEqual({ providers: ["Gemini"], models: ["tts"], languages: [] });
    expect(shownFacet(one.providers)).toBe(false);
    const two = facetValues([...catalogue, other]);
    expect(two.providers).toEqual(["Gemini", "Other"]);
    expect(shownFacet(two.providers)).toBe(true);
    expect(shownFacet(two.languages)).toBe(false);
  });

  it("describes a voice by provider, model and the languages it names", () => {
    expect(voiceDetails(catalogue[0]!)).toEqual(["Gemini", "tts"]);
    expect(voiceDetails(other)).toEqual(["Other", "v2", "es-MX"]);
    expect(voiceDetails(optionsFromVoices(["Kore"])[0]!)).toEqual([]);
  });
});

describe("narration voices", () => {
  it("names the shared voice, says when they differ, and is empty when none is chosen", () => {
    const music: MediaAsset = {
      key: "theme",
      type: "audio",
      description: "Theme",
      kind: "music",
      channel: "music",
      loop: true,
      volume: 1,
      usages: usage,
    };
    expect(mixedVoice([narration("a", "Puck"), narration("b", "Puck"), music])).toBe("Puck");
    expect(mixedVoice([narration("a", "Puck"), narration("b", "Kore")])).toBe("mixed");
    expect(mixedVoice([narration("a", "Puck"), narration("b")])).toBe("mixed");
    expect(mixedVoice([narration("a"), narration("b")])).toBeNull();
    expect(mixedVoice([music])).toBeNull();
  });

  it("counts a saved voice Penguin cannot speak as naming none", () => {
    expect(
      mixedVoice([narration("a", "Retired"), narration("b", "Retired")], catalogue),
    ).toBeNull();
    expect(mixedVoice([narration("a", "Puck"), narration("b", "Puck")], catalogue)).toBe("Puck");
    expect(mixedVoice([narration("a", "Puck"), narration("b", "Retired")], catalogue)).toBe(
      "mixed",
    );
  });

  it("applies one voice to every narration and to nothing else", () => {
    const image: MediaAsset = { key: "cat", type: "image", description: "Cat", usages: usage };
    const group = [narration("a", "Kore"), narration("b"), image];
    expect(applyVoice(group, "Fenrir")).toBe(2);
    expect(group.map((asset) => asset.voice)).toEqual(["Fenrir", "Fenrir", undefined]);
  });

  it("speaks a narration in its own voice when it can, the default otherwise", () => {
    expect(voiceFor(narration("a", "Puck"), catalogue, "Kore")).toBe("Puck");
    expect(voiceFor(narration("a", "Retired"), catalogue, "Kore")).toBe("Kore");
    expect(voiceFor(narration("a"), catalogue, "Kore")).toBe("Kore");
    expect(voiceFor(undefined, catalogue, "Kore")).toBe("Kore");
  });
});
