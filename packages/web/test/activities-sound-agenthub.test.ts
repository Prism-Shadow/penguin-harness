import { describe, expect, it } from "vitest";
import type { SoundProviderStatus } from "@prismshadow/penguin-server/api";
import {
  canGenerateSound,
  chosenModel,
  chosenProvider,
  providerOptions,
} from "../src/features/activities/sound-model";

const hub = (over: Partial<SoundProviderStatus> = {}): SoundProviderStatus => ({
  id: "agenthub",
  kinds: ["music", "sfx"],
  credential: "",
  models: {},
  available: false,
  problem: "no_model",
  modelChoices: [],
  ...over,
});

const eleven: SoundProviderStatus = {
  id: "elevenlabs",
  kinds: ["music", "sfx"],
  credential: "ELEVENLABS_API_KEY",
  models: { music: "music_v1", sfx: "sound-generation" },
  available: true,
};

describe("the model hub in the Provider picker", () => {
  it("is listed, disabled, with the reason while it offers no sound model", () => {
    const [, model] = providerOptions([eleven, hub()], "sfx");
    expect(model).toEqual({
      id: "agenthub",
      label: "Model",
      problem: "No music or sound model is available through the model hub in this version.",
      models: [],
    });
    // The usable provider is chosen; the hub is not offered for Generate.
    expect(chosenProvider(providerOptions([hub(), eleven], "sfx"), null)?.id).toBe("elevenlabs");
    expect(canGenerateSound("rain", model!, true)).toBe(false);
  });

  it("offers the models that make this kind, naming the key a model lacks", () => {
    const status = hub({
      available: true,
      problem: undefined,
      credential: "GEMINI_API_KEY",
      modelChoices: [
        { id: "tune-a", kinds: ["music"], credential: "GEMINI_API_KEY", available: true },
        { id: "tune-b", kinds: ["music", "sfx"], credential: "OTHER_KEY", available: false },
        { id: "fx-c", kinds: ["sfx"], credential: "GEMINI_API_KEY", available: true },
      ],
    });
    const [music] = providerOptions([status], "music");
    expect(music!.problem).toBeNull();
    expect(music!.models).toEqual([
      { id: "tune-a", problem: null },
      { id: "tune-b", problem: "Add OTHER_KEY to the selected agent's Vault." },
    ]);
    // A model that cannot run is never chosen, even when asked for.
    expect(chosenModel(music!, "tune-b")?.id).toBe("tune-a");
    expect(chosenModel(music!, null)?.id).toBe("tune-a");
    const [effect] = providerOptions([status], "sfx");
    expect(effect!.models.map((model) => model.id)).toEqual(["tune-b", "fx-c"]);
    expect(chosenModel(effect!, "fx-c")?.id).toBe("fx-c");
  });

  it("names the missing key when no model for the kind can run", () => {
    const status = hub({
      problem: "credential_missing",
      credential: "OTHER_KEY",
      modelChoices: [{ id: "tune-b", kinds: ["music"], credential: "OTHER_KEY", available: false }],
    });
    const [music] = providerOptions([status], "music");
    expect(music!.problem).toBe("Add OTHER_KEY to the selected agent's Vault.");
    expect(chosenModel(music!, null)).toBeNull();
    // A kind no model makes is worded as no model, not as a missing key.
    expect(providerOptions([status], "sfx")[0]!.problem).toContain("No music or sound model");
  });

  it("has no model choice for a provider with fixed models", () => {
    const [option] = providerOptions([eleven], "music");
    expect(option!.models).toEqual([]);
    expect(chosenModel(option!, null)).toBeNull();
  });
});
