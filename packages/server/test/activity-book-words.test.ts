/**
 * A decodable book's word pronunciations, planned from the story: Loom's normalization and
 * keys, the words and their per-scene usages, the merge that keeps an author's words, and the
 * manifest, re-plan and import rules around them.
 */
import { describe, expect, it } from "vitest";
import {
  bookWordsOf,
  cleanPhonemes,
  desiredWords,
  fillPhonemes,
  mergeWordAssets,
  normalizeWord,
  wordAssetKey,
  wordsMissingPhonemes,
} from "../src/activities/book-words.js";
import {
  contentRevision,
  type ActivityDetail,
  type ActivityDraft,
} from "../src/activities/domain.js";
import { speechTargets } from "../src/activities/pipeline-run.js";
import {
  planMedia,
  validateManifest,
  wafManifest,
  type MediaAsset,
} from "../src/activities/media.js";
import { catBookSpec } from "./activity-fixtures.js";

const address = { productCode: "cat-book", refNum: 1 };

function detail(
  spec: Record<string, unknown>,
  previous?: ActivityDraft["mediaPlan"],
): ActivityDetail {
  const draft: ActivityDraft = {
    draftId: "draft-1",
    activityId: "activity-1",
    baseVersionId: null,
    contentRevision: "",
    status: "valid",
    description: "",
    spec,
    updatedAt: "",
    ...(previous ? { mediaPlan: previous } : {}),
  };
  return {
    id: "activity-1",
    collectionId: "collection-1",
    ...address,
    productId: null,
    displayName: null,
    stable: false,
    title: "Cat book",
    activityType: "book",
    archived: false,
    tags: [],
    createdAt: "",
    updatedAt: "",
    draft,
  };
}

const usage = (sceneId: string, sourceKey: string, occurrence = 1, count = 1) => ({
  sceneId,
  sourceKey,
  occurrence,
  sceneOccurrenceCount: count,
});

describe("book words", () => {
  it("normalizes words as Loom does", () => {
    expect(normalizeWord("The")).toBe("the");
    expect(normalizeWord("cat,")).toBe("cat");
    expect(normalizeWord("“Don’t!”")).toBe("don't");
    expect(normalizeWord("'tis'")).toBe("tis");
    expect(normalizeWord("...")).toBe("");
    expect(normalizeWord("Straße")).toBe("strasse");
  });

  it("splits a story into words as Loom does (golden)", () => {
    const words = (script: string) => bookWordsOf(script).map(normalizeWord);
    expect(words("Don’t run, cat’s hat.")).toEqual(["don't", "run", "cat's", "hat"]);
    expect(words("The cat—it ran.")).toEqual(["the", "cat", "it", "ran"]);
    expect(words("Wait...then go")).toEqual(["wait", "then", "go"]);
    expect(words("well-known")).toEqual(["well", "known"]);
    expect(words("Straße ẞ")).toEqual(["strasse", "ss"]);
    expect(words("Find [pause] it")).toEqual(["find", "it"]);
  });

  it("keys a word with Loom's slug and hash (golden)", () => {
    expect(wordAssetKey("the")).toBe("book-word-the-b9776d7ddf");
    expect(wordAssetKey("cat")).toBe("book-word-cat-77af778b51");
    expect(wordAssetKey("sat")).toBe("book-word-sat-339efeab70");
    expect(wordAssetKey("ran")).toBe("book-word-ran-c8fc6bf296");
    expect(wordAssetKey("don't")).toBe("book-word-don-t-df7682099c");
    // A key the manifest could not hold takes its accents off; the hash stays the word's.
    expect(wordAssetKey("niño")).toMatch(/^book-word-nino-[a-f0-9]{10}$/);
    expect(wordAssetKey("niño")).not.toBe(wordAssetKey("nino"));
  });

  it("lists every word the story pages say, with per-scene usages", () => {
    const words = desiredWords(catBookSpec(), [], "en-US", "en-US");
    expect(words.map((word) => word.normalizedWord)).toEqual(["the", "cat", "sat", "ran"]);
    expect(words[0]).toEqual({
      word: "The",
      normalizedWord: "the",
      usages: [usage("scene-2-story", "narration-1"), usage("scene-3-story", "narration-2")],
    });
    expect(words[2]!.usages).toEqual([usage("scene-2-story", "narration-1")]);
    expect(words[3]!.usages).toEqual([usage("scene-3-story", "narration-2")]);

    const repeated = desiredWords(catBookSpec(["The cat saw the cat."]), [], "en-US", "en-US");
    expect(repeated.find((word) => word.normalizedWord === "cat")!.usages).toEqual([
      usage("scene-2-story", "narration-1", 1, 2),
      usage("scene-2-story", "narration-1", 2, 2),
    ]);
  });

  it("reads another language's own narration, and takes the narration's voice", () => {
    const group = [
      {
        key: "narration-1",
        type: "audio",
        description: "Narration",
        script: "El gato.",
        voice: "Kore",
        usages: [],
      },
    ] as MediaAsset[];
    const words = desiredWords(catBookSpec(), group, "es-US", "en-US");
    expect(words.map((word) => [word.normalizedWord, word.voice])).toEqual([
      ["el", "Kore"],
      ["gato", "Kore"],
    ]);
  });

  it("adds new words, keeps every field of known ones and drops unused ones unless customized", () => {
    const narration: MediaAsset = {
      key: "narration-1",
      type: "audio",
      description: "Narration",
      script: "The cat sat.",
      usages: [],
    };
    const first = mergeWordAssets([narration], desiredWords(catBookSpec(), [], "en-US", "en-US"));
    expect(first[0]).toBe(narration);
    const cat = first.find((asset) => asset.normalizedWord === "cat")!;
    expect(cat).toMatchObject({
      key: "book-word-cat-77af778b51",
      type: "audio",
      role: "bookWord",
      word: "cat",
      description: "Pronunciation of “cat”.",
    });
    cat.phonemes = ["k", "æ", "t"];
    cat.phonemeSource = "espeak";
    const sat = first.find((asset) => asset.normalizedWord === "sat")!;
    Object.assign(sat, { phonemes: ["s", "a", "t"], phonemeSource: "author", customized: true });

    const next = mergeWordAssets(
      first,
      desiredWords(catBookSpec(["A cat ran."]), [], "en-US", "en-US"),
    );
    const words = next.filter((asset) => asset.role === "bookWord");
    expect(words.map((asset) => asset.normalizedWord)).toEqual(["a", "cat", "ran", "sat"]);
    expect(words.find((asset) => asset.normalizedWord === "cat")).toMatchObject({
      phonemes: ["k", "æ", "t"],
      phonemeSource: "espeak",
      usages: [usage("scene-2-story", "narration-1")],
    });
    // The author's word stays, in no scene; "the" was nobody's and goes.
    expect(words.find((asset) => asset.normalizedWord === "sat")).toMatchObject({
      customized: true,
      usages: [],
    });
    expect(wordsMissingPhonemes(next)).toEqual(["a", "ran"]);
    expect(
      fillPhonemes(
        next,
        new Map([
          ["a", ["ə"]],
          ["sat", ["x"]],
        ]),
        "model",
      ),
    ).toBe(1);
    expect(next.find((asset) => asset.normalizedWord === "a")).toMatchObject({
      phonemes: ["ə"],
      phonemeSource: "model",
    });
    expect(next.find((asset) => asset.normalizedWord === "sat")!.phonemes).toEqual(["s", "a", "t"]);
  });

  it("cleans sounds and refuses what is not sounds", () => {
    expect(cleanPhonemes(["k", "ˈæ", " t "])).toEqual(["k", "æ", "t"]);
    expect(cleanPhonemes([])).toBeNull();
    expect(cleanPhonemes(["a b"])).toBeNull();
    expect(cleanPhonemes(["abcdefghi"])).toBeNull();
    expect(cleanPhonemes(Array.from({ length: 33 }, () => "a"))).toBeNull();
    expect(cleanPhonemes("k æ t")).toBeNull();
  });
});

describe("book word manifest fields", () => {
  const word = {
    key: "book-word-cat-77af778b51",
    type: "audio",
    role: "bookWord",
    description: "Pronunciation of “cat”.",
    word: "cat",
    normalizedWord: "cat",
    phonemes: ["k", "æ", "t"],
    phonemeSource: "espeak",
    customized: false,
    usages: [usage("scene-2-story", "narration-1")],
  };
  const manifest = (asset: Record<string, unknown>) => ({
    ...address,
    assets: { "en-US": [asset] },
  });

  it("keeps a word pronunciation's fields", () => {
    expect(validateManifest(manifest(word), address).assets["en-US"]![0]).toEqual(word);
    // Provenance stays with Penguin; the module's manifest has Loom's fields only.
    expect(
      wafManifest(validateManifest(manifest(word), address)).assets["en-US"]![0],
    ).not.toHaveProperty("phonemeSource");
  });

  it.each([
    ["a role on an image", { ...word, type: "image" }],
    ["a role other than bookWord", { ...word, role: "bookIntro" }],
    ["a role without its word", (({ word: _word, ...rest }) => rest)(word)],
    ["a word without the role", (({ role: _role, ...rest }) => rest)(word)],
    ["a word too long", { ...word, word: "w".repeat(65) }],
    ["stressed sounds", { ...word, phonemes: ["k", "ˈæ", "t"] }],
    ["too many sounds", { ...word, phonemes: Array.from({ length: 33 }, () => "a") }],
    ["an unknown source", { ...word, phonemeSource: "guess" }],
    ["customized that is not a flag", { ...word, customized: "yes" }],
  ])("refuses %s", (_label, asset) => {
    expect(() => validateManifest(manifest(asset), address)).toThrow();
  });

  it("keeps word pronunciations when the media plan is rebuilt", () => {
    const spec = catBookSpec();
    const first = planMedia(detail(spec));
    const words = mergeWordAssets(
      first.manifest.assets["en-US"]!,
      desiredWords(spec, [], "en-US", "en-US"),
    );
    words.find((asset) => asset.normalizedWord === "cat")!.customized = true;
    const withWords = { ...first, manifest: { ...first.manifest, assets: { "en-US": words } } };

    const again = planMedia(detail(spec, withWords));
    expect(
      again.manifest.assets["en-US"]!.filter((asset) => asset.role === "bookWord").length,
    ).toBe(4);

    // One story page left: its words keep their usages there, the other page's go, and a
    // word left in no scene goes unless the author customized it.
    const shorter = catBookSpec(["The cat sat."]);
    const replanned = planMedia(detail(shorter, withWords)).manifest.assets["en-US"]!;
    expect(
      replanned
        .filter((asset) => asset.role === "bookWord")
        .map((asset) => [asset.normalizedWord, asset.usages.length]),
    ).toEqual([
      ["the", 1],
      ["cat", 1],
      ["sat", 1],
    ]);
    expect(contentRevision(shorter)).not.toBe(contentRevision(spec));
  });
});

describe("word pronunciations and narration", () => {
  it("leaves a scripted word out of the speech stage", () => {
    const manifest = validateManifest(
      {
        ...address,
        assets: {
          "en-US": [
            {
              key: "narration-1",
              type: "audio",
              description: "Narration",
              script: "The cat.",
              usages: [],
            },
            {
              key: "book-word-cat-77af778b51",
              type: "audio",
              role: "bookWord",
              description: "Pronunciation of “cat”.",
              word: "cat",
              normalizedWord: "cat",
              script: "[very slowly] cat.",
              usages: [],
            },
          ],
        },
      },
      address,
    );
    expect(speechTargets(manifest)).toEqual([{ language: "en-US", assetKey: "narration-1" }]);
  });
});
