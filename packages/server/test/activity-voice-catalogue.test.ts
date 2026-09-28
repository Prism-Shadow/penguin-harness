import { afterEach, describe, expect, it } from "vitest";
import {
  SPEECH_CATALOGUE,
  SPEECH_MODEL,
  SPEECH_VOICES,
  isSpeechVoice,
} from "../src/activities/voice-catalogue.js";
import * as audio from "../src/activities/audio.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("the speech voice catalogue", () => {
  it("describes exactly the voices Penguin speaks with, in order", () => {
    expect(SPEECH_CATALOGUE.map((option) => option.id)).toEqual([...SPEECH_VOICES]);
    expect(audio.SPEECH_VOICES).toBe(SPEECH_VOICES);
    expect(audio.SPEECH_MODEL).toBe(SPEECH_MODEL);
  });

  it("names each voice with its provider, model and style, and offers no sample it lacks", () => {
    for (const option of SPEECH_CATALOGUE) {
      expect(option).toMatchObject({
        label: option.id,
        provider: "Gemini",
        model: SPEECH_MODEL,
        languages: [],
        previewUrl: null,
      });
      expect(option.description).toBeTruthy();
    }
    expect(SPEECH_CATALOGUE.find((option) => option.id === "Fenrir")?.description).toBe(
      "Excitable",
    );
  });

  it("knows a voice it can speak from one it cannot", () => {
    expect(isSpeechVoice("Kore")).toBe(true);
    expect(isSpeechVoice("kore")).toBe(false);
    expect(isSpeechVoice(undefined)).toBe(false);
  });
});

describe("the speech setup route", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("offers the catalogue beside the plain voice list", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "voice_owner");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "voice_owner-voices" })).status).toBe(
      201,
    );
    const response = await client.get("/api/projects/voice_owner-voices/activities/speech-setup");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      voices: string[];
      catalogue: { id: string }[];
    };
    expect(body.voices).toEqual([...SPEECH_VOICES]);
    expect(body.catalogue.map((option) => option.id)).toEqual([...SPEECH_VOICES]);
    expect(body.catalogue).toEqual(JSON.parse(JSON.stringify(SPEECH_CATALOGUE)));
  });
});
