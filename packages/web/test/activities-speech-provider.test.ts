import { describe, expect, it } from "vitest";
import type { MediaAsset, VoiceOption } from "@prismshadow/penguin-server/api";
import {
  activeWord,
  applyProvider,
  isElevenLabsVoiceId,
  providerOf,
  sharedProvider,
  setProvider,
  supportsSpeechLanguage,
  speechChoice,
  voicesFor,
  wordCatalogue,
} from "../src/features/activities/speech-provider";
import { soundCandidateLabel } from "../src/features/activities/sound-model";
import { ApiError } from "../src/api/client";
import { apiErrorText } from "../src/lib/api-error";

const gemini = (id: string): VoiceOption => ({
  id,
  label: id,
  provider: "Gemini",
  providerId: "gemini",
  model: "gemini-3.1-flash-tts-preview",
  languages: [],
  previewUrl: null,
});
const vaultDefault: VoiceOption = {
  id: "elevenlabs-default",
  label: "ElevenLabs default",
  provider: "ElevenLabs",
  providerId: "elevenlabs",
  model: "eleven_v3",
  languages: [],
  previewUrl: null,
};
const OPTIONS = [gemini("Kore"), gemini("Puck"), vaultDefault];
const TYPED = "AbCdEfGhIj0123456789";

function narration(extra: Partial<MediaAsset> = {}): MediaAsset {
  return { key: "n", type: "audio", description: "d", script: "Hi", usages: [], ...extra };
}

describe("speech provider model", () => {
  it.each(["es-MX", "ro-RO"])(
    "prevents individual and bulk Kokoro selection for %s",
    (language) => {
      const voices: VoiceOption[] = [
        ...OPTIONS,
        { ...gemini("af_heart"), providerId: "kokoro", languages: ["en-US"] },
      ];
      const asset = narration({ voice: "Kore" });
      expect(supportsSpeechLanguage(voices, "kokoro", language)).toBe(false);
      expect(supportsSpeechLanguage(voices, "gemini", language)).toBe(true);
      expect(supportsSpeechLanguage(voices, "kokoro", "en-US")).toBe(true);
      setProvider(asset, "kokoro", voices, language);
      expect(asset.speechProvider).toBeUndefined();
      expect(asset.voice).toBe("Kore");
      expect(applyProvider([asset], "kokoro", voices, language)).toBe(0);
      expect(asset.speechProvider).toBeUndefined();
      expect(applyProvider([asset], "kokoro", voices, "en-US")).toBe(1);
      expect(asset.speechProvider).toBe("kokoro");
      expect(asset.voice).toBeUndefined();
    },
  );
  it("chooses only Kokoro voices for the narration's language", () => {
    const voices: VoiceOption[] = [
      { ...gemini("af_heart"), providerId: "kokoro", languages: ["en-US"] },
      { ...gemini("bf_emma"), providerId: "kokoro", languages: ["en-GB"] },
    ];
    const asset = narration({ speechProvider: "kokoro", voice: "af_heart" });
    expect(speechChoice(asset, voices, "af_heart", "en-GB")).toEqual({
      provider: "kokoro",
      voice: "bf_emma",
    });
    expect(speechChoice(asset, voices, "af_heart", "fr-FR").voice).toBe("");
  });
  it("reads Gemini for a narration naming no provider", () => {
    expect(providerOf(narration())).toBe("gemini");
    expect(providerOf(narration({ speechProvider: "elevenlabs" }))).toBe("elevenlabs");
    expect(providerOf(undefined)).toBe("gemini");
  });

  it("lists a provider's voices, keeping typed ElevenLabs ids choosable", () => {
    expect(voicesFor(OPTIONS, "gemini").map((o) => o.id)).toEqual(["Kore", "Puck"]);
    // An older server's options name no provider and are Gemini's.
    expect(voicesFor([{ ...gemini("Kore"), providerId: undefined }], "gemini")).toHaveLength(1);
    const assets = [narration({ speechProvider: "elevenlabs", voice: TYPED })];
    expect(voicesFor(OPTIONS, "elevenlabs", assets).map((o) => o.id)).toEqual([
      "elevenlabs-default",
      TYPED,
    ]);
  });

  it("asks for the narration's voice, the fallback, or the provider's first", () => {
    expect(speechChoice(narration({ voice: "Puck" }), OPTIONS, "Kore")).toEqual({
      provider: "gemini",
      voice: "Puck",
    });
    expect(speechChoice(narration(), OPTIONS, "Kore")).toEqual({
      provider: "gemini",
      voice: "Kore",
    });
    // A Gemini fallback is not an ElevenLabs voice: the Vault default is used instead.
    expect(speechChoice(narration({ speechProvider: "elevenlabs" }), OPTIONS, "Kore")).toEqual({
      provider: "elevenlabs",
      voice: "elevenlabs-default",
    });
    expect(
      speechChoice(narration({ speechProvider: "elevenlabs", voice: TYPED }), OPTIONS, "Kore"),
    ).toEqual({ provider: "elevenlabs", voice: TYPED });
    // Without a Vault voice or a typed one, there is nothing to speak with yet.
    expect(
      speechChoice(narration({ speechProvider: "elevenlabs" }), [gemini("Kore")], "Kore"),
    ).toEqual({ provider: "elevenlabs", voice: "" });
  });

  it("sets one provider on every narration and drops voices it cannot speak with", () => {
    const assets = [
      narration({ key: "a", voice: "Kore" }),
      narration({ key: "b", speechProvider: "elevenlabs", voice: TYPED }),
      { ...narration({ key: "c" }), kind: "music" as const },
    ];
    expect(sharedProvider(assets)).toBe("mixed");
    expect(applyProvider(assets, "elevenlabs", OPTIONS, "en-US")).toBe(2);
    expect(assets[0]).toMatchObject({ speechProvider: "elevenlabs" });
    expect(assets[0]!.voice).toBeUndefined();
    expect(assets[1]).toMatchObject({ speechProvider: "elevenlabs", voice: TYPED });
    expect(assets[2]!.speechProvider).toBeUndefined();
    expect(sharedProvider(assets)).toBe("elevenlabs");
    expect(sharedProvider([])).toBeNull();
  });

  it("checks typed voice ids as the server does", () => {
    expect(isElevenLabsVoiceId(TYPED)).toBe(true);
    expect(isElevenLabsVoiceId("short")).toBe(false);
    expect(isElevenLabsVoiceId("has-a-dash-0123456789")).toBe(false);
  });

  it("finds the word being spoken, and none between words", () => {
    const timings = [
      { startMs: 0, endMs: 300 },
      { startMs: 350, endMs: 500 },
    ];
    expect(activeWord(timings, 0)).toBe(0);
    expect(activeWord(timings, 320)).toBe(-1);
    expect(activeWord(timings, 499)).toBe(1);
    expect(activeWord(timings, 500)).toBe(-1);
  });

  it("labels an ElevenLabs take with its provider, and a Gemini take by its voice", () => {
    const run = (audio: Record<string, unknown>) =>
      ({ audio }) as unknown as Parameters<typeof soundCandidateLabel>[0];
    expect(soundCandidateLabel(run({ voice: "Kore" }))).toBe("Kore");
    expect(soundCandidateLabel(run({ voice: TYPED, provider: "elevenlabs" }))).toBe(
      `ElevenLabs · ${TYPED}`,
    );
    expect(soundCandidateLabel(run({ voice: "elevenlabs-default", provider: "elevenlabs" }))).toBe(
      "ElevenLabs · Default voice",
    );
  });

  it("words the Vault's default ElevenLabs voice itself, not with the server's label", () => {
    const worded = wordCatalogue([gemini("Kore"), vaultDefault]);
    expect(worded.map((option) => option.label)).toEqual(["Kore", "ElevenLabs · Default voice"]);
  });

  it("names the key the narration's provider is missing, from the refusal's data", () => {
    const refusal = (detail?: Record<string, string>) =>
      new ApiError(400, "speech_credential_missing", "RAW", undefined, detail);
    expect(apiErrorText(refusal({ credential: "ELEVENLABS_API_KEY" }))).toBe(
      "Add ELEVENLABS_API_KEY to the selected Agent’s Vault before generating speech.",
    );
    // Without the key named, no particular key is claimed.
    expect(apiErrorText(refusal())).not.toContain("GEMINI_API_KEY");
  });
});
