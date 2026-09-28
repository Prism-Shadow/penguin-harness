/**
 * A decodable book's word recordings: the drawn-out script each provider is given, the
 * projection of a recording's two timings onto the word's sounds, the scripts kept in line
 * with the sounds, the words a recording pass takes, and the words the reader receives.
 */
import { describe, expect, it } from "vitest";
import {
  VOWELS,
  compiledWords,
  drawnOutScript,
  geminiScript,
  projectPhonemeTimings,
  recordedWordTimings,
  syncWordScripts,
  unrecordedWithoutSounds,
  wordRecordingCounts,
  wordRecordingTargets,
  wordScript,
} from "../src/activities/pronunciation.js";
import { validateManifest, wafManifest, type MediaAsset } from "../src/activities/media.js";

const RUN = `run_${"a".repeat(32)}`;
const SHA = "b".repeat(64);

function word(normalized: string, extra: Partial<MediaAsset> = {}): MediaAsset {
  return {
    key: `book-word-${normalized}`,
    type: "audio",
    role: "bookWord",
    description: `Pronunciation of “${normalized}”.`,
    word: normalized,
    normalizedWord: normalized,
    usages: [],
    ...extra,
  };
}

describe("the script a word is recorded from", () => {
  it("draws out the first vowel for ElevenLabs, as Loom does", () => {
    expect(drawnOutScript("cat", ["k", "æ", "t"])).toBe(
      '[very slowly] [drawn out] "/kæːːːt/" [short pause] cat.',
    );
    // The first sound holding a vowel is the one held, even inside a longer symbol.
    expect(drawnOutScript("the", ["ð", "ə"])).toBe(
      '[very slowly] [drawn out] "/ðəːːː/" [short pause] the.',
    );
    expect(drawnOutScript("rain", ["ɹ", "eɪ", "n"])).toContain('"/ɹeɪːːːn/"');
    // No vowel at all: nothing is held.
    expect(drawnOutScript("hmm", ["h", "m"])).toContain('"/hm/"');
    expect(VOWELS.has("æ")).toBe(true);
    expect(() => drawnOutScript("", ["k"])).toThrow();
    expect(() => drawnOutScript("cat", [])).toThrow();
  });

  it("asks Gemini in plain words, since it reads no IPA", () => {
    expect(geminiScript("cat", ["k", "æ", "t"])).toBe(
      "Say the word 'cat' very slowly, stretching each sound: k æ t, then say it normally.",
    );
  });

  it("follows the word's provider, Gemini when it names none, and needs sounds", () => {
    const cat = word("cat", { phonemes: ["k", "æ", "t"] });
    expect(wordScript(cat)).toBe(geminiScript("cat", ["k", "æ", "t"]));
    expect(wordScript({ ...cat, speechProvider: "elevenlabs" })).toBe(
      drawnOutScript("cat", ["k", "æ", "t"]),
    );
    expect(wordScript(word("cat"))).toBeNull();
  });
});

describe("timing a drawn-out recording", () => {
  it("shares the slow span between the sounds and keeps the fluent span as the word", () => {
    expect(
      projectPhonemeTimings(
        ["k", "æ", "t"],
        [
          { word: "kæːːːt", startMs: 0, endMs: 1200 },
          { word: "cat", startMs: 1500, endMs: 1900 },
        ],
      ),
    ).toEqual({
      phonemeTimings: [
        { phoneme: "k", startMs: 0, endMs: 400 },
        { phoneme: "æ", startMs: 400, endMs: 800 },
        { phoneme: "t", startMs: 800, endMs: 1200 },
      ],
      wholeWordTiming: { startMs: 1500, endMs: 1900 },
    });
  });

  it("times nothing unless there are exactly two timings in order, for the word", () => {
    const slow = { startMs: 0, endMs: 1200 };
    const fluent = { word: "cat", startMs: 1500, endMs: 1900 };
    expect(projectPhonemeTimings(["k", "æ", "t"], [slow])).toBeNull();
    expect(projectPhonemeTimings(["k", "æ", "t"], [slow, fluent, fluent])).toBeNull();
    expect(projectPhonemeTimings(["k", "æ", "t"], undefined)).toBeNull();
    expect(projectPhonemeTimings([], [slow, fluent])).toBeNull();
    // The word said before the sounds finished, or not at all.
    expect(projectPhonemeTimings(["k"], [slow, { ...fluent, startMs: 1000 }])).toBeNull();
    expect(projectPhonemeTimings(["k"], [slow, { ...fluent, endMs: 1500 }])).toBeNull();
    expect(projectPhonemeTimings(["k", "æ", "t"], [slow, fluent], "cat")).not.toBeNull();
    expect(projectPhonemeTimings(["k", "æ", "t"], [slow, fluent], "dog")).toBeNull();
    // Too short a slow span to give each sound a millisecond.
    expect(projectPhonemeTimings(["k", "æ", "t"], [{ startMs: 0, endMs: 2 }, fluent])).toBeNull();
  });

  it("uses a recording's stored timings only while they are for the word's sounds", () => {
    const timed = word("cat", {
      phonemes: ["k", "æ", "t"],
      path: "media/cat.mp3",
      phonemeTimings: [
        { phoneme: "k", startMs: 0, endMs: 10 },
        { phoneme: "æ", startMs: 10, endMs: 20 },
        { phoneme: "t", startMs: 20, endMs: 30 },
      ],
      wholeWordTiming: { startMs: 40, endMs: 50 },
    });
    expect(recordedWordTimings(timed)?.wholeWordTiming).toEqual({ startMs: 40, endMs: 50 });
    expect(recordedWordTimings({ ...timed, phonemes: ["k", "a", "t"] })).toBeNull();
    expect(recordedWordTimings({ ...timed, path: undefined })).toBeNull();
    // A word imported from Loom stores only the two word timings; they are projected.
    const imported = word("cat", {
      phonemes: ["k", "æ", "t"],
      path: "media/cat.mp3",
      wordTimings: [
        { word: "kæt", startMs: 0, endMs: 300 },
        { word: "cat", startMs: 400, endMs: 600 },
      ],
    });
    expect(recordedWordTimings(imported)?.phonemeTimings.map((t) => t.endMs)).toEqual([
      100, 200, 300,
    ]);
  });
});

describe("keeping word scripts in line with their sounds", () => {
  it("writes each word's script unless the author wrote it", () => {
    const group = [
      word("cat", { phonemes: ["k", "æ", "t"], speechProvider: "elevenlabs" }),
      word("sat", { phonemes: ["s", "æ", "t"], customScript: true, script: "Sat, slowly." }),
      word("ran"),
      { key: "narration-1", type: "audio", description: "N", script: "The cat.", usages: [] },
    ] as MediaAsset[];
    syncWordScripts(group);
    expect(group[0]!.script).toBe(drawnOutScript("cat", ["k", "æ", "t"]));
    expect(group[1]!.script).toBe("Sat, slowly.");
    expect(group[2]!.script).toBeUndefined();
    expect(group[3]!.script).toBe("The cat.");
  });

  it("unbinds a generated clip whose script changed, and keeps an uploaded one", () => {
    const recorded = word("cat", {
      phonemes: ["k", "æ", "t"],
      script: geminiScript("cat", ["k", "æ", "t"]),
      path: `media/generated/${RUN}.wav`,
      generatedAudio: { runId: RUN, sha256: SHA },
      phonemeTimings: [{ phoneme: "k", startMs: 0, endMs: 10 }],
    });
    const uploaded = word("sat", {
      phonemes: ["s", "æ", "t"],
      script: geminiScript("sat", ["s", "æ", "t"]),
      path: "media/uploads/sat.wav",
    });
    const previous = structuredClone([recorded, uploaded]);
    const group = structuredClone([recorded, uploaded]);
    group[0]!.phonemes = ["k", "a", "t"];
    group[1]!.phonemes = ["s", "a", "t"];
    syncWordScripts(group, previous);
    expect(group[0]).not.toHaveProperty("path");
    expect(group[0]).not.toHaveProperty("generatedAudio");
    expect(group[0]).not.toHaveProperty("phonemeTimings");
    expect(group[1]!.path).toBe("media/uploads/sat.wav");
    // A recording not generated here keeps the script it was made from.
    expect(group[1]!.script).toBe(geminiScript("sat", ["s", "æ", "t"]));
    // Unchanged script: the recording stays.
    const same = structuredClone([recorded]);
    syncWordScripts(same, [recorded]);
    expect(same[0]!.path).toBe(recorded.path);
    expect(same[0]!.phonemeTimings).toEqual(recorded.phonemeTimings);
  });

  it("keeps an imported word's script, and drops timings measured on another clip", () => {
    const drawn = drawnOutScript("cat", ["k", "æ", "t"]);
    const imported = word("cat", {
      phonemes: ["k", "æ", "t"],
      script: drawn,
      path: "media/cat.mp3",
      wordTimings: [
        { word: "kæːːːt", startMs: 0, endMs: 300 },
        { word: "cat", startMs: 400, endMs: 600 },
      ],
    });
    const group = [structuredClone(imported)];
    syncWordScripts(group, []);
    expect(group[0]!.script).toBe(drawn);
    expect(group[0]!.wordTimings).toEqual(imported.wordTimings);
    const recorded = word("cat", {
      phonemes: ["k", "æ", "t"],
      script: drawn,
      speechProvider: "elevenlabs",
      path: `media/generated/${RUN}.wav`,
      generatedAudio: { runId: RUN, sha256: SHA },
      phonemeTimings: [
        { phoneme: "k", startMs: 0, endMs: 400 },
        { phoneme: "æ", startMs: 400, endMs: 800 },
        { phoneme: "t", startMs: 800, endMs: 1200 },
      ],
      wholeWordTiming: { startMs: 1500, endMs: 1900 },
    });
    const uploaded = structuredClone(recorded);
    uploaded.path = "media/uploads/cat.wav";
    delete uploaded.generatedAudio;
    const next = [uploaded];
    syncWordScripts(next, [recorded]);
    expect(next[0]!.path).toBe("media/uploads/cat.wav");
    expect(next[0]).not.toHaveProperty("phonemeTimings");
    expect(next[0]).not.toHaveProperty("wholeWordTiming");
    expect(recordedWordTimings(next[0])).toBeNull();
  });

  it("records only words with sounds, a script and no recording", () => {
    const manifest = {
      productCode: "p",
      refNum: 1,
      assets: {
        "en-US": [
          word("cat", { phonemes: ["k", "æ", "t"], script: "x" }),
          word("sat", { phonemes: ["s", "æ", "t"], script: "x", path: "media/sat.wav" }),
          word("ran"),
          { key: "n", type: "audio", description: "N", script: "Hi", usages: [] },
        ] as MediaAsset[],
      },
    };
    expect(wordRecordingTargets(manifest)).toEqual([
      { language: "en-US", assetKey: "book-word-cat" },
    ]);
    expect(unrecordedWithoutSounds(manifest)).toEqual([
      { language: "en-US", assetKey: "book-word-ran" },
    ]);
    expect(wordRecordingCounts(manifest.assets["en-US"])).toEqual({
      total: 3,
      recorded: 1,
      timed: 0,
    });
  });
});

describe("the words a story page gives the reader", () => {
  it("lists every shown word with its key, sounds and timings in seconds", () => {
    const group = [
      word("the", { phonemes: ["ð", "ə"] }),
      word("cat", {
        phonemes: ["k", "æ", "t"],
        path: "media/cat.mp3",
        phonemeTimings: [
          { phoneme: "k", startMs: 0, endMs: 400 },
          { phoneme: "æ", startMs: 400, endMs: 800 },
          { phoneme: "t", startMs: 800, endMs: 1200 },
        ],
        wholeWordTiming: { startMs: 1500, endMs: 1900 },
      }),
    ];
    expect(compiledWords("The cat [pause] sat.", group)).toEqual([
      {
        text: "The",
        normalizedWord: "the",
        audioKey: "book-word-the",
        phonemes: ["ð", "ə"],
        phonemeTimings: [],
        wholeWordTiming: null,
      },
      {
        text: "cat",
        normalizedWord: "cat",
        audioKey: "book-word-cat",
        phonemes: ["k", "æ", "t"],
        phonemeTimings: [
          { phoneme: "k", start: 0, end: 0.4 },
          { phoneme: "æ", start: 0.4, end: 0.8 },
          { phoneme: "t", start: 0.8, end: 1.2 },
        ],
        wholeWordTiming: { start: 1.5, end: 1.9 },
      },
      {
        text: "sat",
        normalizedWord: "sat",
        audioKey: null,
        phonemes: [],
        phonemeTimings: [],
        wholeWordTiming: null,
      },
    ]);
  });
});

describe("the manifest's word timing fields", () => {
  const address = { productCode: "p", refNum: 1 };
  const manifest = (asset: Record<string, unknown>) => ({
    ...address,
    assets: { "en-US": [asset] },
  });

  it("keeps a word's timings and authored script, and leaves them out of the WAF manifest", () => {
    const asset = {
      ...word("cat", { phonemes: ["k", "æ", "t"] }),
      customScript: true,
      phonemeTimings: [{ phoneme: "k", startMs: 0, endMs: 400 }],
      wholeWordTiming: { startMs: 500, endMs: 900 },
    };
    const parsed = validateManifest(manifest(asset), address);
    expect(parsed.assets["en-US"]![0]).toMatchObject({
      customScript: true,
      phonemeTimings: [{ phoneme: "k", startMs: 0, endMs: 400 }],
      wholeWordTiming: { startMs: 500, endMs: 900 },
    });
    const exported = wafManifest(parsed).assets["en-US"]![0]!;
    expect(exported).not.toHaveProperty("customScript");
    expect(exported).not.toHaveProperty("phonemeTimings");
    expect(exported).not.toHaveProperty("wholeWordTiming");
  });

  it("refuses them on anything but a word, and timings that run backwards", () => {
    const narration = { key: "n", type: "audio", description: "N", usages: [] };
    expect(() => validateManifest(manifest({ ...narration, customScript: true }), address)).toThrow(
      /script/,
    );
    expect(() =>
      validateManifest(
        manifest({ ...narration, wholeWordTiming: { startMs: 0, endMs: 1 } }),
        address,
      ),
    ).toThrow(/whole-word/);
    expect(() =>
      validateManifest(
        manifest({ ...word("cat"), phonemeTimings: [{ phoneme: "k", startMs: 5, endMs: 5 }] }),
        address,
      ),
    ).toThrow(/sound timings/);
    expect(() =>
      validateManifest(
        manifest({ ...word("cat"), phonemeTimings: [{ phoneme: "ˈk", startMs: 0, endMs: 5 }] }),
        address,
      ),
    ).toThrow(/sound timings/);
  });
});
