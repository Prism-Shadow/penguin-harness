import { describe, expect, it } from "vitest";
import {
  alignmentProblems,
  normalizeAlignment,
  supportsHighlighting,
  timingManifestFields,
  visibleWords,
  type WordTiming,
} from "../src/activities/word-timings.js";

const timing = (word: string, startMs: number, endMs: number): WordTiming => ({
  word,
  startMs,
  endMs,
});

describe("the words a script speaks", () => {
  it("splits on whitespace and drops punctuation, which is not spoken", () => {
    expect(visibleWords("The cat, sat! On the mat?")).toEqual([
      "The",
      "cat",
      "sat",
      "On",
      "the",
      "mat",
    ]);
  });

  it("keeps apostrophes and hyphens, which are inside words", () => {
    expect(visibleWords("don't re-read")).toEqual(["don't", "re-read"]);
  });

  it("keeps digits", () => {
    expect(visibleWords("count to 10")).toEqual(["count", "to", "10"]);
  });

  it("collapses runs of whitespace and newlines", () => {
    expect(visibleWords("a\n\n  b\tc")).toEqual(["a", "b", "c"]);
  });

  it("finds nothing in punctuation alone", () => {
    expect(visibleWords("... !!!")).toEqual([]);
    expect(visibleWords("")).toEqual([]);
  });
});

describe("checking an alignment", () => {
  const script = "The cat sat";
  const good = [timing("The", 0, 200), timing("cat", 200, 400), timing("sat", 400, 700)];

  it("accepts a complete, ordered alignment", () => {
    expect(alignmentProblems(script, good)).toEqual([]);
  });

  it("refuses a script with nothing to align", () => {
    expect(alignmentProblems("...", good)).toEqual([
      "The narration script contains no spoken words to align.",
    ]);
  });

  it("counts the mismatch when there are too few or too many timings", () => {
    expect(alignmentProblems(script, good.slice(0, 2))[0]).toBe(
      "The alignment has 2 timings for 3 spoken words.",
    );
    expect(alignmentProblems(script, [...good, timing("extra", 700, 800)])[0]).toContain(
      "4 timings for 3 spoken words",
    );
  });

  it("uses the singular for one timing and one word", () => {
    expect(alignmentProblems("cat", [])[0]).toBe("The alignment has 0 timings for 1 spoken word.");
    expect(alignmentProblems("cat dog", [timing("cat", 0, 1)])[0]).toContain(
      "1 timing for 2 spoken words",
    );
  });

  it("refuses a timing that ends at or before it starts", () => {
    const problems = alignmentProblems(script, [
      timing("The", 100, 100),
      timing("cat", 200, 400),
      timing("sat", 400, 700),
    ]);
    expect(problems).toContain("Timing 1 ends at or before it starts.");
  });

  it("refuses timings that overlap, which would highlight two words at once", () => {
    const problems = alignmentProblems(script, [
      timing("The", 0, 300),
      timing("cat", 200, 400),
      timing("sat", 400, 700),
    ]);
    expect(problems.some((problem) => problem.includes("before the previous word ended"))).toBe(
      true,
    );
  });

  it("refuses a non-integer, negative or boolean millisecond value", () => {
    for (const bad of [1.5, -1, true, "0", null, undefined])
      expect(
        alignmentProblems("cat", [{ word: "cat", startMs: bad, endMs: 100 }]).join(" "),
        String(bad),
      ).toContain("no whole, non-negative startMs");
  });

  it("refuses an entry that is not an object", () => {
    expect(alignmentProblems("cat", ["nope"])).toContain("Timing 1 is not a timing entry.");
    expect(alignmentProblems("cat", [[0, 1]])).toContain("Timing 1 is not a timing entry.");
  });

  it("notices an alignment against a different script", () => {
    const problems = alignmentProblems(script, [
      timing("A", 0, 200),
      timing("dog", 200, 400),
      timing("ran", 400, 700),
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toBe('Timing 1 says "A" where the script says "The".');
  });

  it("ignores punctuation and case when comparing a word to the script", () => {
    expect(
      alignmentProblems("The cat.", [timing("the", 0, 200), timing("Cat,", 200, 400)]),
    ).toEqual([]);
  });

  it("collects every problem rather than stopping at the first", () => {
    const problems = alignmentProblems(script, [
      timing("The", 0, 200),
      timing("dog", 100, 50),
      timing("sat", 400, 700),
    ]);
    expect(problems.length).toBeGreaterThan(1);
  });
});

describe("storing an alignment", () => {
  it("returns the timings when they are sound", () => {
    const stored = normalizeAlignment("The cat", [timing("The", 0, 200), timing("cat", 200, 400)]);
    expect(stored).toEqual([
      { word: "The", startMs: 0, endMs: 200 },
      { word: "cat", startMs: 200, endMs: 400 },
    ]);
  });

  it("takes the script's word when a provider returned offsets without text", () => {
    const stored = normalizeAlignment("The cat", [
      { startMs: 0, endMs: 200 },
      { startMs: 200, endMs: 400 },
    ]);
    expect(stored?.map((entry) => entry.word)).toEqual(["The", "cat"]);
  });

  it("returns null rather than a partial alignment", () => {
    expect(normalizeAlignment("The cat", [timing("The", 0, 200)])).toBeNull();
  });
});

describe("what a manifest records", () => {
  it("records timings and duration when both are known", () => {
    expect(timingManifestFields([timing("a", 0, 100)], 100)).toEqual({
      wordTimings: [{ word: "a", startMs: 0, endMs: 100 }],
      durationMs: 100,
    });
  });

  it("adds nothing for a provider with no native timestamps", () => {
    // An empty wordTimings reads as "aligned, no words", and a reader would then report
    // highlighting as available and highlight nothing.
    expect(timingManifestFields([], 100)).toEqual({ durationMs: 100 });
    expect(timingManifestFields(null, null)).toEqual({});
    expect(timingManifestFields(undefined, undefined)).toEqual({});
  });

  it("refuses a duration that is not whole milliseconds", () => {
    expect(timingManifestFields(null, 1.5)).toEqual({});
    expect(timingManifestFields(null, -1)).toEqual({});
  });

  it("copies the timings rather than aliasing the caller's array", () => {
    const original = [timing("a", 0, 100)];
    const fields = timingManifestFields(original, 100);
    original.push(timing("b", 100, 200));
    expect(fields.wordTimings).toHaveLength(1);
  });
});

describe("whether a clip can highlight words", () => {
  it("can when it has timings", () => {
    expect(supportsHighlighting({ wordTimings: [timing("a", 0, 1)] })).toBe(true);
  });

  it("cannot when it has none, so a reader can say so instead of playing silently", () => {
    expect(supportsHighlighting({})).toBe(false);
    expect(supportsHighlighting({ wordTimings: [] })).toBe(false);
  });

  it("does not count bracketed audio tags as spoken words", () => {
    expect(visibleWords("Find the syllable [pause] NAP [Pause] and hold it.[short pause]")).toEqual(
      ["Find", "the", "syllable", "NAP", "and", "hold", "it"],
    );
  });
});
