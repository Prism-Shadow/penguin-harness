/**
 * Right reading level: sentences and words that may be too hard for the grade band. Pure,
 * and warning-only.
 */
import { describe, expect, it } from "vitest";
import type { AssetManifest } from "../src/activities/media.js";
import {
  GRADE_BAND_MAX,
  SIGHT_WORDS,
  activityLanguage,
  fleschKincaidGrade,
  gradeBandMax,
  limitsFor,
  narrationPassages,
  readabilityFindings,
  readabilityReport,
  sentencesOf,
  syllables,
  targetWords,
  wordsOf,
} from "../src/activities/quality-readability.js";

const checkedAt = "2026-09-25T10:00:00.000Z";
/** Twenty-five words, one sentence, only sight words. */
const LONG_SENTENCE =
  "the big red dog and the little blue cat can run and jump and play all day in the green park with you and me";

describe("grade bands", () => {
  it("knows the named bands and reads a number out of any other", () => {
    expect(GRADE_BAND_MAX["k-2"]).toBe(2);
    expect(gradeBandMax("Pre-K")).toBe(0);
    expect(gradeBandMax(" 3-5 ")).toBe(5);
    expect(gradeBandMax("grade 4")).toBe(4);
    expect(gradeBandMax("kindergarten")).toBeNull();
    expect(gradeBandMax(null)).toBeNull();
  });

  it("loosens its limits as grades go up", () => {
    expect(limitsFor(0)).toEqual({ sentenceWords: 6, wordLetters: 6, wordSyllables: 2 });
    expect(limitsFor(2)).toEqual({ sentenceWords: 10, wordLetters: 8, wordSyllables: 3 });
    expect(limitsFor(12)).toEqual({ sentenceWords: 20, wordLetters: 14, wordSyllables: 4 });
  });
});

describe("words, sentences and syllables", () => {
  it("splits text", () => {
    expect(wordsOf("Don't stop -- 'Tap' the cat!")).toEqual(["don't", "stop", "tap", "the", "cat"]);
    expect(sentencesOf("One. Two!  Three?")).toEqual(["One", "Two", "Three"]);
  });

  it("counts syllables by vowel groups, less a silent e", () => {
    expect(syllables("cat")).toBe(1);
    expect(syllables("make")).toBe(1);
    expect(syllables("table")).toBe(2);
    expect(syllables("elephant")).toBe(3);
    expect(syllables("rhythm")).toBe(1);
  });

  it("grades text by Flesch-Kincaid", () => {
    expect(fleschKincaidGrade("")).toBe(0);
    expect(fleschKincaidGrade("The cat sat. The dog ran.")).toBeLessThan(1);
    expect(
      fleschKincaidGrade(
        "Photosynthesis transforms electromagnetic radiation into chemical potential energy.",
      ),
    ).toBeGreaterThan(12);
  });

  it("knows the sight words", () => {
    expect(SIGHT_WORDS.has("the")).toBe(true);
    expect(SIGHT_WORDS.has("because")).toBe(true);
    expect(SIGHT_WORDS.has("photosynthesis")).toBe(false);
  });

  it("does not take an apostrophe inside a word for a quote", () => {
    expect([...targetWords(["The learner can't miss 'elephant'."])]).toEqual(["elephant"]);
    expect([...targetWords(["The child's answer names 'elephant'."])]).toEqual(["elephant"]);
    expect([...targetWords(["Says ‘umbrella stand’ and the kids' word"])]).toEqual([
      "umbrella",
      "stand",
    ]);
  });

  it("takes the words an activity teaches from its quoted acceptance criteria", () => {
    expect([...targetWords(['The learner taps "elephant".', "Says “umbrella stand”", 3])]).toEqual([
      "elephant",
      "umbrella",
      "stand",
    ]);
  });
});

describe("readability findings", () => {
  it("warns about a 25-word sentence for k-2", () => {
    const findings = readabilityFindings(LONG_SENTENCE, { gradeMax: gradeBandMax("k-2")! });
    expect(findings).toEqual([
      expect.objectContaining({
        code: "sentence_long",
        severity: "note",
        blocking: false,
        count: 25,
        limit: 10,
      }),
    ]);
  });

  it("warns once about a long word that is neither a sight word nor taught", () => {
    const findings = readabilityFindings(
      [
        { text: "Find the elephant. The elephant is big.", scene: "intro" },
        { text: "Tap the umbrella.", scene: "end" },
      ],
      { gradeMax: 0, targetWords: new Set(["umbrella"]) },
    );
    expect(findings.map((finding) => [finding.code, finding.detail, finding.scene])).toEqual([
      ["word_long", "elephant", "intro"],
      ["word_syllables", "elephant", "intro"],
    ]);
    expect(findings.every((finding) => !finding.blocking)).toBe(true);
  });

  it("never fails: warnings only, or passed", () => {
    const spec = { audience: { gradeBand: "k-2" } };
    const warned = readabilityReport({
      spec,
      language: "en-US",
      passages: [{ text: LONG_SENTENCE, scene: "intro" }],
      checkedAt,
    });
    expect(warned).toMatchObject({
      check: "readability",
      status: "passed_with_warnings",
      gradeBand: "k-2",
      checkedAt,
    });
    expect(typeof warned.readingGrade).toBe("number");
    expect(
      readabilityReport({
        spec,
        language: "en-US",
        passages: [{ text: "I can see the cat.", scene: null }],
        checkedAt,
      }).status,
    ).toBe("passed");
  });

  it("skips without a grade band, in another language, or with nothing to read", () => {
    const passages = [{ text: LONG_SENTENCE, scene: null }];
    expect(readabilityReport({ spec: {}, language: "en-US", passages, checkedAt })).toMatchObject({
      status: "skipped",
      skippedReason: "no_grade_band",
      findings: [],
    });
    expect(
      readabilityReport({
        spec: { audience: { gradeBand: "reception" } },
        language: "en-US",
        passages,
        checkedAt,
      }).skippedReason,
    ).toBe("unknown_grade_band");
    expect(
      readabilityReport({
        spec: { audience: { gradeBand: "k-2" } },
        language: "es-MX",
        passages,
        checkedAt,
      }).skippedReason,
    ).toBe("not_english");
    expect(
      readabilityReport({
        spec: { audience: { gradeBand: "k-2" } },
        language: "en-US",
        passages: [{ text: "  ", scene: null }],
        checkedAt,
      }).skippedReason,
    ).toBe("no_text");
  });
});

describe("what the activity says", () => {
  const manifest = (assets: AssetManifest["assets"]): AssetManifest =>
    ({ productCode: "words", refNum: 1, assets }) as AssetManifest;
  const narration = (key: string, script: string, sceneId: string) => ({
    key,
    type: "audio" as const,
    description: key,
    script,
    usages: [{ sceneId, sourceKey: key, occurrence: 1, sceneOccurrenceCount: 1 }],
  });

  it("reads the default language's narration scripts, not music or sound effects", () => {
    const plan = manifest({
      "en-US": [
        narration("hello", "Hello there.", "intro"),
        { ...narration("song", "La la la.", "intro"), kind: "music" },
      ],
      "es-MX": [narration("hello", "Hola.", "intro")],
    } as unknown as AssetManifest["assets"]);
    expect(activityLanguage(plan)).toBe("en-US");
    expect(narrationPassages(null, plan, "en-US")).toEqual([
      { text: "Hello there.", scene: "intro" },
    ]);
  });

  it("falls back to the specification's scripts before there is a media plan", () => {
    const spec = {
      scenes: [
        { id: "intro", audio: { tracks: [{ key: "a", script: "Tap the cat." }, { key: "b" }] } },
        { id: "end" },
      ],
    };
    expect(activityLanguage(null)).toBe("en-US");
    expect(narrationPassages(spec, null, "en-US")).toEqual([
      { text: "Tap the cat.", scene: "intro" },
    ]);
  });

  it("names a manifest's own language when it lacks the default", () => {
    expect(activityLanguage(manifest({ "es-MX": [] }))).toBe("es-MX");
  });
});
