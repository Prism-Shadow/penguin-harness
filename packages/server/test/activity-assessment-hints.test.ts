import { describe, expect, it } from "vitest";
import {
  coverageProblem,
  describeHint,
  itemSatisfiesHint,
  normalizeChoiceText,
  uncoveredHints,
  type AssessmentHint,
  type WrittenItem,
} from "../src/activities/assessment-hints.js";

const item = (...choices: [string, boolean?][]): WrittenItem => ({
  choices: choices.map(([text, isCorrect]) => ({ text, ...(isCorrect ? { isCorrect } : {}) })),
});

const hint = (choices: string[], correct?: string, sceneId = "s1"): AssessmentHint => ({
  sceneId,
  choices,
  ...(correct ? { correct } : {}),
});

describe("comparing choice text", () => {
  it("ignores case, punctuation and extra spacing", () => {
    // The two agent passes are separate calls, so one writes "The cat." where the other
    // enumerated "the cat".
    expect(normalizeChoiceText("The cat.")).toBe(normalizeChoiceText("the cat"));
    expect(normalizeChoiceText("  A  DOG!  ")).toBe("a dog");
  });

  it("keeps digits, which are often the answer", () => {
    expect(normalizeChoiceText("Number 7")).toBe("number 7");
  });

  it("compares letters in any script, without their accents", () => {
    expect(normalizeChoiceText("Sí.")).toBe(normalizeChoiceText("si"));
    expect(normalizeChoiceText("猫!")).toBe("猫");
    expect(normalizeChoiceText("猫")).not.toBe(normalizeChoiceText("狗"));
  });

  it("keeps a choice with no letters or digits as its trimmed text", () => {
    // A comparison activity's choices are symbols; they must not all become the same "".
    expect(normalizeChoiceText(" > ")).toBe(">");
    expect(normalizeChoiceText("<")).not.toBe(normalizeChoiceText("="));
    expect(normalizeChoiceText("   ")).toBe("");
  });
});

describe("whether one item satisfies one hint", () => {
  it("matches when the choices are the same", () => {
    expect(itemSatisfiesHint(item(["cat"], ["dog"]), hint(["cat", "dog"]))).toBe(true);
  });

  it("matches symbol and non-Latin choices, and their correct answer", () => {
    expect(itemSatisfiesHint(item([">", true], ["<"], ["="]), hint([">", "<", "="], ">"))).toBe(
      true,
    );
    expect(itemSatisfiesHint(item([">"], ["<", true], ["="]), hint([">", "<", "="], ">"))).toBe(
      false,
    );
    expect(itemSatisfiesHint(item(["猫", true], ["狗"]), hint(["猫", "狗"], "猫"))).toBe(true);
    expect(itemSatisfiesHint(item(["猫", true], ["鸟"]), hint(["猫", "狗"], "猫"))).toBe(false);
  });

  it("matches despite punctuation and case differences", () => {
    expect(itemSatisfiesHint(item(["The Cat."], ["a dog!"]), hint(["the cat", "A DOG"]))).toBe(
      true,
    );
  });

  it("allows the written item to add a distractor the scene did not name", () => {
    // The second pass may add choices; it may not drop one the scene did name.
    expect(itemSatisfiesHint(item(["cat"], ["dog"], ["bird"]), hint(["cat", "dog"]))).toBe(true);
  });

  it("refuses when a choice the scene named is missing", () => {
    expect(itemSatisfiesHint(item(["cat"], ["bird"]), hint(["cat", "dog"]))).toBe(false);
  });

  it("requires the named correct answer to be marked correct", () => {
    expect(itemSatisfiesHint(item(["cat", true], ["dog"]), hint(["cat", "dog"], "cat"))).toBe(true);
    expect(itemSatisfiesHint(item(["cat"], ["dog", true]), hint(["cat", "dog"], "cat"))).toBe(
      false,
    );
  });

  it("is satisfied by the choices alone when the scene named no correct answer", () => {
    expect(itemSatisfiesHint(item(["cat"], ["dog"]), hint(["cat", "dog"]))).toBe(true);
  });

  it("refuses an item with no choices, and a hint with none", () => {
    expect(itemSatisfiesHint(item(), hint(["cat"]))).toBe(false);
    expect(itemSatisfiesHint(item(["cat"]), hint([]))).toBe(false);
    expect(itemSatisfiesHint(item(["cat"]), hint(["!!!"]))).toBe(false);
  });
});

describe("coverage across an assessment", () => {
  it("passes when every enumerated question is written", () => {
    const items = [item(["cat"], ["dog"]), item(["red"], ["blue"])];
    expect(uncoveredHints(items, [hint(["cat", "dog"]), hint(["red", "blue"])])).toEqual([]);
  });

  it("names a question the second pass dropped", () => {
    const items = [item(["cat"], ["dog"])];
    const missing = uncoveredHints(items, [hint(["cat", "dog"]), hint(["red", "blue"])]);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.choices).toEqual(["red", "blue"]);
  });

  it("searches in order, so one item cannot satisfy two hints", () => {
    // An assessment that collapsed three similar questions into one is caught, rather
    // than passing because the single item matches all three.
    const items = [item(["cat"], ["dog"])];
    const missing = uncoveredHints(items, [hint(["cat", "dog"]), hint(["cat", "dog"])]);
    expect(missing).toHaveLength(1);
  });

  it("covers repeated questions when the assessment writes them both", () => {
    const items = [item(["cat"], ["dog"]), item(["cat"], ["dog"])];
    expect(uncoveredHints(items, [hint(["cat", "dog"]), hint(["cat", "dog"])])).toEqual([]);
  });

  it("requires the assessment to keep the scenes' order", () => {
    // Ordered search means a reversed assessment does not cover reversed hints.
    const items = [item(["red"], ["blue"]), item(["cat"], ["dog"])];
    const missing = uncoveredHints(items, [hint(["cat", "dog"]), hint(["red", "blue"])]);
    expect(missing).toHaveLength(1);
    expect(missing[0]!.choices).toEqual(["red", "blue"]);
  });

  it("passes trivially when nothing was enumerated", () => {
    expect(uncoveredHints([], [])).toEqual([]);
    expect(uncoveredHints([item(["cat"])], [])).toEqual([]);
  });

  it("reports every enumerated question against an empty assessment", () => {
    expect(uncoveredHints([], [hint(["a", "b"]), hint(["c", "d"])])).toHaveLength(2);
  });
});

describe("what an author is told", () => {
  it("names the scene, the source and the correct answer", () => {
    expect(
      describeHint({
        sceneId: "intro",
        source: "selection",
        choices: ["cat", "dog"],
        correct: "cat",
      }),
    ).toBe("intro selection cat (cat, dog)");
  });

  it("says what it does not know rather than leaving a gap", () => {
    expect(describeHint({ choices: ["cat"] })).toBe(
      "<unknown scene> selection <unknown correct choice> (cat)",
    );
  });

  it("returns null when coverage is complete", () => {
    expect(coverageProblem([item(["cat"], ["dog"])], [hint(["cat", "dog"])])).toBeNull();
  });

  it("names every missing question, not the first", () => {
    // An agent told one at a time is re-checked each time, and each check is a paid pass
    // over the whole assessment.
    const problem = coverageProblem(
      [],
      [hint(["a", "b"], "a", "one"), hint(["c", "d"], "c", "two")],
    );
    expect(problem).toContain("missing 2 expected items");
    expect(problem).toContain("one");
    expect(problem).toContain("two");
  });

  it("uses the singular for one missing question", () => {
    expect(coverageProblem([], [hint(["a", "b"])])).toContain("missing 1 expected item:");
  });
});
