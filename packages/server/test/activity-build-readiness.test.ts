import { describe, expect, it } from "vitest";
import { buildReadiness, type ReadinessContext } from "../src/activities/build-readiness.js";
import { contentRevision, type ActivityDetail } from "../src/activities/domain.js";

const usage = [{ sceneId: "intro", sourceKey: "k", occurrence: 1, sceneOccurrenceCount: 1 }];
const spec = { id: "words", title: "Words", activityDescription: "d", scenes: [] };

function activity(overrides: Partial<ActivityDetail["draft"]> = {}): ActivityDetail {
  return {
    productCode: "words",
    refNum: 1,
    draft: {
      description: "Scene 1: Intro",
      status: "valid",
      spec,
      mediaPlan: {
        specRevision: contentRevision(spec),
        requirements: {},
        manifest: {
          productCode: "words",
          refNum: 1,
          assets: {
            "es-MX": [{ key: "hi", type: "audio", description: "", script: "Hola", usages: usage }],
            "en-US": [
              {
                key: "hi",
                type: "audio",
                description: "",
                script: "Hi",
                path: "hi.wav",
                usages: usage,
              },
              { key: "bye", type: "audio", description: "", script: "Bye", usages: usage },
              { key: "cat", type: "image", description: "Cat", path: "cat.png", usages: usage },
            ],
          },
        },
      },
      ...overrides,
    },
  } as unknown as ActivityDetail;
}

describe("build readiness", () => {
  it("counts speech per language, the default language first, and coverage against it", () => {
    expect(buildReadiness(activity(), { canonical: true, checkoutFound: true })).toEqual([
      { id: "script", level: "ok" },
      { id: "spec", level: "ok" },
      { id: "plan", level: "ok", state: "current" },
      { id: "speech", level: "warn", language: "en-US", bound: 1, total: 2 },
      { id: "speech", level: "warn", language: "es-MX", bound: 0, total: 1 },
      { id: "coverage", level: "warn", language: "es-MX", covered: 1, total: 2 },
      { id: "media", level: "ok", bound: 1, total: 1 },
      { id: "mediaKeys", level: "ok", keys: [] },
      { id: "canonical", level: "ok" },
      { id: "checkout", level: "ok", found: true },
    ]);
  });

  it("fails what assembly refuses: an invalid spec, a stale plan, another ref's module, no checkout", () => {
    const checks = buildReadiness(
      activity({ status: "draft", spec: { ...spec, title: "Changed" } }),
      { canonical: false, checkoutFound: false },
    );
    const level = (id: string) => checks.find((check) => check.id === id)!.level;
    expect(level("spec")).toBe("fail");
    expect(checks.find((check) => check.id === "plan")).toMatchObject({
      level: "fail",
      state: "stale",
    });
    expect(level("canonical")).toBe("fail");
    expect(level("checkout")).toBe("fail");
  });

  it("only warns about a missing plan, which assembles a module without media", () => {
    const checks = buildReadiness(activity({ mediaPlan: undefined }), {
      canonical: true,
      checkoutFound: true,
    });
    expect(checks.find((check) => check.id === "plan")).toEqual({
      id: "plan",
      level: "warn",
      state: "missing",
    });
    expect(checks.some((check) => check.id === "speech")).toBe(false);
  });

  describe("assessment", () => {
    const assessed = { ...spec, runtime: { engine: "html", usesAssessment: true } };
    const item = (title: string, correct: boolean[]) => ({
      title,
      interactionKey: "SIMPLE_CHOICE",
      configuration: {
        question: { text: "Which one?" },
        simpleChoice: correct.map((isCorrect, index) => ({ id: `c${index}`, isCorrect })),
      },
    });
    const check = (
      context: Partial<ReadinessContext>,
      draft: Partial<ActivityDetail["draft"]> = { spec: assessed },
    ) =>
      buildReadiness(activity(draft), { canonical: true, checkoutFound: true, ...context }).find(
        (entry) => entry.id === "assessment",
      );

    it("has no row when the activity is not assessed", () => {
      expect(check({ assessment: null }, { spec })).toBeUndefined();
    });

    it("fails when an assessed activity has no assessment", () => {
      expect(check({ assessment: null })).toEqual({
        id: "assessment",
        level: "fail",
        state: "missing",
        problems: 0,
      });
    });

    it("fails with a count when a single choice has two correct answers", () => {
      const assessment = {
        title: "words-1",
        items: [item("words-1-1", [true, true]), item("words-1-2", [true, false])],
      };
      expect(check({ assessment })).toEqual({
        id: "assessment",
        level: "fail",
        state: "problems",
        problems: 1,
      });
    });

    it("counts a title that does not name the file, and accepts the canonical ref's", () => {
      const items = [item("a", [true, false])];
      expect(check({ assessment: { title: "other-9", items } })).toMatchObject({ problems: 1 });
      expect(check({ assessment: { title: "words-4", items }, canonicalRefNum: 4 })).toEqual({
        id: "assessment",
        level: "ok",
        state: "valid",
        problems: 0,
      });
    });

    it("only warns about problems the module's own file already had", () => {
      const own = {
        title: "words-1-old",
        items: [item("words-1-1", [true, true]), item("words-1-2", [true, false])],
      };
      expect(check({ assessment: own, ownAssessment: own })).toEqual({
        id: "assessment",
        level: "warn",
        state: "problems",
        problems: 2,
      });
      // An edit that keeps them still only warns; one that adds a problem fails.
      const edit = { ...own, items: [...own.items, item("words-1-3", [false, false])] };
      expect(check({ assessment: { ...own }, ownAssessment: own })).toMatchObject({
        level: "warn",
      });
      expect(check({ assessment: edit, ownAssessment: own })).toEqual({
        id: "assessment",
        level: "fail",
        state: "problems",
        problems: 3,
      });
    });

    it("fails a title an edit breaks that the module's own file had right", () => {
      const own = { title: "words-1", items: [item("a", [true, false])] };
      expect(check({ assessment: { ...own, title: "renamed" }, ownAssessment: own })).toMatchObject(
        { level: "fail", problems: 1 },
      );
    });

    it("counts a document that is not an assessment as one problem", () => {
      expect(check({ assessment: { title: "words-1" } })).toMatchObject({
        level: "fail",
        problems: 1,
      });
    });
  });

  describe("media keys", () => {
    const scene = (id: string, media: Record<string, unknown>, audio?: unknown[]) => ({
      id,
      description: id,
      media,
      ...(audio ? { audio: { tracks: audio } } : {}),
    });
    const keys = (scenes: unknown[]) =>
      buildReadiness(activity({ spec: { ...spec, scenes } }), {
        canonical: true,
        checkoutFound: true,
      }).find((entry) => entry.id === "mediaKeys");

    it("warns when two scenes name the same key as a sound and as a picture", () => {
      expect(
        keys([
          scene("one", {}, [{ key: "welcome", description: "Hello", script: "Hello" }]),
          scene("two", { images: [{ key: "welcome", description: "Hello" }] }),
        ]),
      ).toEqual({ id: "mediaKeys", level: "warn", keys: ["welcome"] });
    });

    it("warns about a key described two ways, each key once and sorted", () => {
      expect(
        keys([
          scene("one", {
            images: [
              { key: "zebra", description: "A zebra" },
              { key: "cat", description: "A cat" },
            ],
          }),
          scene("two", { images: [{ key: "zebra", description: "A striped horse" }] }),
          scene("three", {
            images: [
              { key: "zebra", description: "A third" },
              { key: "apple", description: "Red" },
            ],
          }),
          scene("four", { animations: [{ key: "apple", description: "Red" }] }),
        ]),
      ).toEqual({ id: "mediaKeys", level: "warn", keys: ["apple", "zebra"] });
    });

    it("is fine with a key shared the same way across scenes", () => {
      expect(
        keys([
          scene("one", { images: [{ key: "cat", description: "A cat" }] }),
          scene("two", { images: [{ key: "cat", description: "A cat" }] }),
        ]),
      ).toEqual({ id: "mediaKeys", level: "ok", keys: [] });
    });

    it("compares descriptions as the media plan does, spaces included", () => {
      expect(
        keys([
          scene("one", { images: [{ key: "cat", description: "A cat" }] }),
          scene("two", { images: [{ key: "cat", description: "A cat " }] }),
        ]),
      ).toEqual({ id: "mediaKeys", level: "warn", keys: ["cat"] });
    });
  });

  it("warns for a decodable book's words without a recording or without sound timings", () => {
    const word = (key: string, extra: Record<string, unknown> = {}) => ({
      key,
      type: "audio",
      role: "bookWord",
      description: key,
      word: key,
      normalizedWord: key,
      phonemes: ["k", "æ", "t"],
      usages: usage,
      ...extra,
    });
    const timings = {
      phonemeTimings: [
        { phoneme: "k", startMs: 0, endMs: 100 },
        { phoneme: "æ", startMs: 100, endMs: 200 },
        { phoneme: "t", startMs: 200, endMs: 300 },
      ],
      wholeWordTiming: { startMs: 400, endMs: 600 },
    };
    const book = (words: Record<string, unknown>[]) => {
      const value = activity();
      (value as { activityType: string }).activityType = "book";
      value.draft.mediaPlan!.manifest.assets["en-US"]!.push(...(words as never[]));
      return value;
    };
    const wordsCheck = (value: ActivityDetail, bookMode?: "decodable" | "readAlong" | null) =>
      buildReadiness(value, { canonical: true, checkoutFound: true, bookMode }).filter(
        (check) => check.id === "words",
      );
    // One recorded and timed, one recorded by Gemini (no timings), one not recorded.
    const mixed = book([
      word("cat", { path: "media/cat.mp3", ...timings }),
      word("sat", { path: "media/sat.wav" }),
      word("ran"),
    ]);
    expect(wordsCheck(mixed, "decodable")).toEqual([
      { id: "words", level: "warn", language: "en-US", recorded: 2, total: 3, timed: 1 },
    ]);
    // Speech counts leave the words out.
    expect(
      buildReadiness(mixed, { canonical: true, checkoutFound: true }).find(
        (check) => check.id === "speech" && check.language === "en-US",
      ),
    ).toMatchObject({ bound: 1, total: 2 });
    expect(wordsCheck(book([word("cat", { path: "media/cat.mp3", ...timings })]), null)).toEqual([
      { id: "words", level: "ok", language: "en-US", recorded: 1, total: 1, timed: 1 },
    ]);
    // A decodable book that has not listed its words; a read-along book is never asked.
    expect(wordsCheck(book([]), "decodable")).toEqual([
      { id: "words", level: "warn", language: "en-US", recorded: 0, total: 0, timed: 0 },
    ]);
    expect(wordsCheck(mixed, "readAlong")).toEqual([]);
    expect(wordsCheck(activity(), "decodable")).toEqual([]);
  });
});
