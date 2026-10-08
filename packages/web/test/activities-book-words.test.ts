import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import {
  bookWordAssets,
  cleanSounds,
  isDecodable,
  latestPhonemesRun,
  parseProposal,
  proposalRows,
  sameSounds,
  soundsProblem,
  withoutBookWords,
  wordsWithoutSounds,
} from "../src/features/activities/book-words";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { buildStudioTree, type StudioNode } from "../src/features/activities/studio-tree";
import { workspaceSections } from "../src/features/activities/workspace-model";

type MediaAsset = AssetManifest["assets"][string][number];

const usage = (sceneId: string, sourceKey: string) => ({
  sceneId,
  sourceKey,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});
const narration: MediaAsset = {
  key: "narration-1",
  type: "audio",
  description: "Narration",
  script: "The cat sat.",
  path: "media/n.wav",
  usages: [usage("page-1", "narration-1")],
};
const word = (normalized: string, over: Partial<MediaAsset> = {}): MediaAsset => ({
  key: `book-word-${normalized}`,
  type: "audio",
  role: "bookWord",
  description: `Pronunciation of “${normalized}”.`,
  word: normalized,
  normalizedWord: normalized,
  usages: [usage("page-1", "narration-1")],
  ...over,
});
const group: MediaAsset[] = [
  narration,
  word("the", { phonemes: ["ð", "ə"], phonemeSource: "espeak" }),
  word("cat"),
  word("sat", { phonemes: ["s", "a", "t"], phonemeSource: "author", customized: true }),
];

const run = (over: Partial<ActivityRunSummary>): ActivityRunSummary =>
  ({
    runId: "run_1",
    kind: "phonemes",
    status: "succeeded",
    createdAt: "2026-09-25T10:00:00.000Z",
    inputRevision: "rev",
    hasCandidate: true,
    phonemes: { language: "en-US", words: ["cat"] },
    ...over,
  }) as ActivityRunSummary;

describe("book words model", () => {
  it("tells words from the scene's own audio, and lists the ones without sounds", () => {
    expect(bookWordAssets(group).map((asset) => asset.key)).toEqual([
      "book-word-the",
      "book-word-cat",
      "book-word-sat",
    ]);
    expect(withoutBookWords(group)).toEqual([narration]);
    expect(wordsWithoutSounds(group)).toEqual(["cat"]);
  });

  it("follows the product's reading mode", () => {
    expect(isDecodable(null)).toBe(false);
    expect(isDecodable({ bookMode: "decodable" })).toBe(true);
    expect(isDecodable({ bookMode: "readAlong" })).toBe(false);
    expect(isDecodable({ bookMode: null })).toBe(false);
    // Refreshed before, then reloaded: the words already there say it is decodable.
    expect(isDecodable({ bookMode: null }, true)).toBe(true);
    expect(isDecodable({ bookMode: "readAlong" }, true)).toBe(false);
  });

  it("finds the newest phonemes run of a language and reads its proposal", () => {
    const runs = [
      run({ runId: "run_old", createdAt: "2026-09-25T09:00:00.000Z" }),
      run({ runId: "run_new" }),
      run({ runId: "run_es", phonemes: { language: "es-US", words: ["gato"] } }),
      run({ runId: "run_audio", kind: "audio", phonemes: undefined }),
    ];
    expect(latestPhonemesRun(runs, "en-US")!.runId).toBe("run_new");
    expect(latestPhonemesRun(runs, "fr-FR")).toBeUndefined();

    const proposal = parseProposal(
      JSON.stringify({
        language: "en-US",
        phonemes: { cat: ["k", "æ", "t"], sat: ["s", "æ", "t"] },
      }),
    )!;
    // Only a word still without sounds would take the proposal; the author's stays theirs.
    expect(proposalRows(proposal, group)).toEqual([
      { word: "cat", normalizedWord: "cat", sounds: ["k", "æ", "t"], applies: true },
      { word: "sat", normalizedWord: "sat", sounds: ["s", "æ", "t"], applies: false },
    ]);
    expect(parseProposal("not json")).toBeNull();
    expect(parseProposal(JSON.stringify({ language: "en-US", phonemes: { cat: "k" } }))).toBeNull();
    expect(parseProposal(null)).toBeNull();
  });

  it("checks sounds as the server will", () => {
    expect(cleanSounds([" k ", "ˈæ", "", "t"])).toEqual(["k", "æ", "t"]);
    expect(soundsProblem(["", " "])).toBe("empty");
    expect(soundsProblem(Array.from({ length: 33 }, () => "a"))).toBe("tooMany");
    expect(soundsProblem(["abcdefghi"])).toBe("segment");
    expect(soundsProblem(["a b"])).toBe("segment");
    expect(soundsProblem(["k", "æ", "t"])).toBeNull();
    expect(sameSounds(["k"], ["k"])).toBe(true);
    expect(sameSounds(["k"], ["k", "t"])).toBe(false);
  });
});

describe("studio tree word pronunciations", () => {
  const find = (nodes: readonly StudioNode[], id: string): StudioNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const below = find(node.children, id);
      if (below) return below;
    }
    return undefined;
  };
  const tree = buildStudioTree(
    workspaceSections({ hasSpec: true, hasPlan: true, hasModule: true }),
    buildSceneTree({ scenes: [{ id: "page-1" }] }, group),
  );

  it("lists a scene's words in a group of their own, after its audios, named by the word", () => {
    const scene = find(tree, "scene:page-1")!;
    expect(scene.children.map((node) => node.id)).toEqual([
      "group:page-1:audio",
      "group:page-1:bookWord",
    ]);
    expect(find(tree, "group:page-1:bookWord")!.label).toEqual({ key: "group:bookWord" });
    expect(find(tree, "group:page-1:audio")!.children.map((node) => node.label)).toEqual([
      { text: "narration-1" },
    ]);
    expect(find(tree, "group:page-1:bookWord")!.children.map((node) => node.label)).toEqual([
      { text: "the" },
      { text: "cat" },
      { text: "sat" },
    ]);
    expect(find(tree, "asset:page-1:book-word-cat")!.target).toEqual({
      kind: "asset",
      selection: { sceneId: "page-1", key: "book-word-cat" },
    });
  });
});
