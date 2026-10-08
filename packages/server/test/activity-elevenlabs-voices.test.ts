/**
 * The ElevenLabs voice library as the picker lists it: every page of /v2/voices read with the
 * Media Agent's key, each voice named, playable and tagged with its verified languages, the
 * default first and named, and a refused or failed listing reported without the key.
 */
import { describe, expect, it } from "vitest";
import {
  ElevenLabsVoicesError,
  listElevenLabsVoices,
  withDefaultFirst,
} from "../src/activities/elevenlabs-voices.js";
import {
  ELEVENLABS_BUILTIN_VOICE_ID,
  ELEVENLABS_DEFAULT_OPTION,
  ELEVENLABS_DEFAULT_VOICE,
} from "../src/activities/voice-catalogue.js";

const KEY = "fake-test-only";

function fakeFetch(pages: unknown[], status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string> });
    const body = pages[calls.length - 1] ?? { voices: [] };
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const sarah = {
  voice_id: ELEVENLABS_BUILTIN_VOICE_ID,
  name: "Sarah",
  preview_url: "https://storage.example/sarah.mp3",
  labels: { accent: "american", age: "young", gender: "female", use_case: "entertainment_tv" },
  verified_languages: [
    { language: "en", locale: "en-US", model_id: "eleven_v3" },
    { language: "es", locale: "es-MX", model_id: "eleven_v3" },
  ],
};

describe("listing the ElevenLabs voices", () => {
  it("reads every page with the key, and keeps name, preview, languages and labels", async () => {
    const { impl, calls } = fakeFetch([
      {
        voices: [sarah, { voice_id: "bad id", name: "Broken" }, { voice_id: "abcdefghij12" }],
        has_more: true,
        next_page_token: "page-2",
      },
      {
        voices: [
          {
            voice_id: "ZyxwvutsrqPONM",
            name: "aaron",
            preview_url: "http://insecure.example/a.mp3",
            verified_languages: [{ language: "fr" }],
          },
        ],
        has_more: false,
      },
    ]);
    const voices = await listElevenLabsVoices(KEY, impl);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.elevenlabs.io/v2/voices?page_size=100",
      "https://api.elevenlabs.io/v2/voices?page_size=100&next_page_token=page-2",
    ]);
    expect(calls[0]!.headers["xi-api-key"]).toBe(KEY);
    // Sorted by name, ignoring case; a voice without a usable id or name is left out.
    expect(voices).toEqual([
      {
        id: "ZyxwvutsrqPONM",
        label: "aaron",
        provider: "ElevenLabs",
        providerId: "elevenlabs",
        model: "eleven_v3",
        languages: ["fr"],
        // Only an https sample is offered to the browser.
        previewUrl: null,
      },
      {
        id: ELEVENLABS_BUILTIN_VOICE_ID,
        label: "Sarah",
        provider: "ElevenLabs",
        providerId: "elevenlabs",
        model: "eleven_v3",
        languages: ["en-US", "es-MX"],
        previewUrl: "https://storage.example/sarah.mp3",
        description: "american · young · female · entertainment tv",
      },
    ]);
  });

  it("reports a refused key and a failed listing, never with the key in the message", async () => {
    for (const [status, problem] of [
      [401, "refused"],
      [403, "refused"],
      [500, "unavailable"],
    ] as const) {
      const failure = await listElevenLabsVoices(KEY, fakeFetch([], status).impl).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(ElevenLabsVoicesError);
      expect((failure as ElevenLabsVoicesError).problem).toBe(problem);
      expect(String(failure)).not.toContain(KEY);
    }
    const offline = (async () => {
      throw new Error(`socket closed for ${KEY}`);
    }) as unknown as typeof fetch;
    const failure = await listElevenLabsVoices(KEY, offline).catch((error: unknown) => error);
    expect((failure as ElevenLabsVoicesError).problem).toBe("unavailable");
    expect(String(failure)).not.toContain(KEY);
  });
});

describe("the default voice first", () => {
  it("names and plays the voice the default stands for, and lists that voice once", async () => {
    const voices = await listElevenLabsVoices(
      KEY,
      fakeFetch([{ voices: [sarah, { voice_id: "ZyxwvutsrqPONM", name: "Aaron" }] }]).impl,
    );
    const listed = withDefaultFirst(ELEVENLABS_DEFAULT_OPTION, ELEVENLABS_BUILTIN_VOICE_ID, voices);
    expect(listed.map((option) => option.id)).toEqual([ELEVENLABS_DEFAULT_VOICE, "ZyxwvutsrqPONM"]);
    expect(listed[0]).toMatchObject({
      id: ELEVENLABS_DEFAULT_VOICE,
      label: ELEVENLABS_DEFAULT_OPTION.label,
      voiceName: "Sarah",
      previewUrl: "https://storage.example/sarah.mp3",
      languages: ["en-US", "es-MX"],
    });
    // A default the library does not hold stays the bare entry, beside every voice.
    expect(withDefaultFirst(ELEVENLABS_DEFAULT_OPTION, "NotInTheLibrary1", voices)).toEqual([
      ELEVENLABS_DEFAULT_OPTION,
      ...voices,
    ]);
  });
});
