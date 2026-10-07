import { describe, expect, it } from "vitest";
import {
  AUDIO_KINDS,
  AUDIO_PROVIDERS,
  audioCapability,
  canAlign,
  describeAudioCapability,
  providerFor,
} from "../src/activities/audio-providers.js";

const eleven = { credentials: ["ELEVENLABS_API_KEY"] };
const gemini = { credentials: ["GEMINI_API_KEY"] };
const both = { credentials: ["ELEVENLABS_API_KEY", "GEMINI_API_KEY"] };
const none = { credentials: [] };

describe("what this build carries", () => {
  it("covers all four kinds between its providers", () => {
    const covered = new Set(AUDIO_PROVIDERS.flatMap((provider) => provider.kinds));
    for (const kind of AUDIO_KINDS) expect(covered.has(kind), kind).toBe(true);
  });

  it("carries native adapters for all of Loom's local audio providers", () => {
    for (const provider of ["audiogen", "audioldm"])
      expect(
        providerFor("effect", {
          credentials: [],
          chosen: { effect: provider },
          local: { audiogen: true, audioldm: true },
        }),
      ).toMatchObject({ provider: { id: provider } });
  });
});

describe("choosing a provider", () => {
  it("picks one that is configured", () => {
    const choice = providerFor("speech", eleven);
    expect("provider" in choice && choice.provider.id).toBe("elevenlabs");
  });

  it("honours an explicit choice", () => {
    const choice = providerFor("speech", { ...both, chosen: { speech: "gemini" } });
    expect("provider" in choice && choice.provider.id).toBe("gemini");
  });

  it("refuses an explicit choice whose credential is absent, rather than substituting", () => {
    // Quietly using a different voice produces an activity nobody can explain.
    const choice = providerFor("speech", { ...eleven, chosen: { speech: "gemini" } });
    expect("problem" in choice && choice.problem).toContain("needs GEMINI_API_KEY");
  });

  it("refuses a provider that does not produce that kind", () => {
    const choice = providerFor("music", { ...gemini, chosen: { music: "gemini" } });
    expect("problem" in choice && choice.problem).toContain("does not produce music");
  });

  it("names the missing local runtime without substituting a hosted provider", () => {
    const choice = providerFor("effect", { ...eleven, chosen: { effect: "audiogen" } });
    expect("problem" in choice && choice.problem).toContain(
      "@huggingface/transformers local runtime",
    );
  });

  it("refuses a provider nobody has heard of", () => {
    const choice = providerFor("speech", { ...eleven, chosen: { speech: "nonsense" } });
    expect("problem" in choice && choice.problem).toContain('no provider called "nonsense"');
  });

  it("names the credential to add when nothing is configured", () => {
    const choice = providerFor("speech", none);
    expect("problem" in choice && choice.problem).toContain("ELEVENLABS_API_KEY or GEMINI_API_KEY");
  });

  it("names only the credential that could serve that kind", () => {
    const choice = providerFor("music", none);
    expect("problem" in choice && choice.problem).toContain("ELEVENLABS_API_KEY");
    expect("problem" in choice && choice.problem).not.toContain("GEMINI_API_KEY");
  });
});

describe("what a deployment can do", () => {
  it("reports local speech and music without credentials, but not effects or alignment", () => {
    expect(
      audioCapability({ credentials: [], local: { kokoro: true, musicgen: true } }).available,
    ).toEqual(["speech", "music"]);
    expect(
      providerFor("speech", {
        credentials: [],
        local: { kokoro: true },
        chosen: { speech: "gemini" },
      }),
    ).toHaveProperty("problem");
  });
  it("reports everything available when one provider covers it all", () => {
    expect(audioCapability(eleven)).toEqual({
      available: ["speech", "music", "effect", "alignment"],
      problems: [],
    });
  });

  it("reports the gaps when a provider covers only speech", () => {
    const { available, problems } = audioCapability(gemini);
    expect(available).toEqual(["speech"]);
    expect(problems).toHaveLength(3);
    expect(problems.join(" ")).toContain("music");
    expect(problems.join(" ")).toContain("alignment");
  });

  it("reports nothing available with no credentials at all", () => {
    expect(audioCapability(none).available).toEqual([]);
  });
});

describe("whether narration can be aligned", () => {
  it("is a separate question from whether it can be spoken", () => {
    // A deployment can speak without aligning, and a book activity has to be told before
    // it ships a read-along that does not read along.
    expect(canAlign(gemini)).toBe(false);
    expect(audioCapability(gemini).available).toContain("speech");
  });

  it("is available when the aligning provider is configured", () => {
    expect(canAlign(eleven)).toBe(true);
  });
});

describe("the one-line summary", () => {
  it("says so plainly when everything works", () => {
    expect(describeAudioCapability(eleven)).toBe(
      "Speech, music, effects and word timings are all available.",
    );
  });

  it("lists what works and then every gap", () => {
    const message = describeAudioCapability(gemini);
    expect(message).toContain("Available: speech.");
    expect(message).toContain("music:");
  });

  it("says no audio at all rather than listing an empty set", () => {
    expect(describeAudioCapability(none)).toContain("No audio can be produced.");
  });
});
