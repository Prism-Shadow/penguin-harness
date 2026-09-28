/**
 * The generated assessment made into the file every ref shares: titles, scores and the
 * configuration derived, only the two choice interactions kept, and the hints read with bounds.
 */
import { describe, expect, it } from "vitest";
import {
  HINTS_MAX,
  HINT_TEXT_MAX,
  normalizeAssessment,
  parseHints,
  writtenItems,
} from "../src/activities/assessment-document.js";
import { coverageProblem } from "../src/activities/assessment-hints.js";

const choice = (id: unknown, text: string, isCorrect: boolean) => ({
  id,
  isCorrect,
  value: { text },
});

const written = {
  items: [
    {
      interactionKey: "SIMPLE_CHOICE",
      configuration: {
        question: { text: "  Which word is cat?  " },
        simpleChoice: [choice(1, " cat ", true), choice("b", "cot", false)],
      },
    },
    {
      interactionKey: "MULTIPLE_RESPONSE_CHOICE",
      configuration: {
        shuffled: true,
        question: { text: "Pick the animals", audio: "q2" },
        multipleResponseChoice: [
          choice("a", "dog", true),
          choice("b", "log", false),
          choice("c", "hog", true),
        ],
      },
    },
  ],
};

describe("normalizeAssessment", () => {
  it("derives titles, scores and the configuration, and keeps only what the file holds", () => {
    const data = normalizeAssessment({ ...written, title: "whatever", extra: 1 }, "p", 3);
    expect(data).toEqual({
      title: "p-3",
      configuration: { maxItems: 2, nextItemsSize: 1 },
      behavior: "LINEAR",
      items: [
        {
          title: "p-3-1",
          interactionKey: "SIMPLE_CHOICE",
          configuration: {
            shuffle: false,
            question: { text: "Which word is cat?" },
            simpleChoice: [
              { id: "1", isCorrect: true, score: 1, value: { text: "cat" } },
              { id: "b", isCorrect: false, score: 0, value: { text: "cot" } },
            ],
          },
        },
        {
          title: "p-3-2",
          interactionKey: "MULTIPLE_RESPONSE_CHOICE",
          configuration: {
            shuffle: true,
            question: { text: "Pick the animals", audio: "q2" },
            multipleResponseChoice: [
              { id: "a", isCorrect: true, score: 1, value: { text: "dog" } },
              { id: "b", isCorrect: false, score: 0, value: { text: "log" } },
              { id: "c", isCorrect: true, score: 1, value: { text: "hog" } },
            ],
          },
        },
      ],
    });
  });

  it("refuses what is not a choice assessment, naming the item", () => {
    expect(() => normalizeAssessment([], "p", 1)).toThrow(/JSON object/);
    expect(() => normalizeAssessment({ items: [] }, "p", 1)).toThrow(/must have an item/);
    const item = (patch: Record<string, unknown>) => ({
      items: [{ ...written.items[0], ...patch }],
    });
    expect(() => normalizeAssessment(item({ interactionKey: "ORDER" }), "p", 1)).toThrow(
      /Assessment item 1 has the interaction "ORDER"/,
    );
    expect(() =>
      normalizeAssessment(
        item({ configuration: { question: { text: " " }, simpleChoice: [] } }),
        "p",
        1,
      ),
    ).toThrow(/question with text/);
    expect(() =>
      normalizeAssessment(
        item({
          configuration: {
            question: { text: "Q" },
            simpleChoice: [choice("a", "x", true), choice("b", "y", true)],
          },
        }),
        "p",
        1,
      ),
    ).toThrow(/exactly one correct choice/);
    expect(() =>
      normalizeAssessment(
        item({
          configuration: { question: { text: "Q" }, simpleChoice: [choice("a", "x", true)] },
        }),
        "p",
        1,
      ),
    ).toThrow(/at least two simpleChoice choices/);
    expect(() =>
      normalizeAssessment(
        item({
          configuration: {
            question: { text: "Q" },
            simpleChoice: [choice("a", "x", true), choice("a", "y", false)],
          },
        }),
        "p",
        1,
      ),
    ).toThrow(/repeats a choice id/);
    expect(() =>
      normalizeAssessment(
        item({
          configuration: {
            question: { text: "Q" },
            simpleChoice: [choice("a", "x", true), choice(" ", "y", false)],
          },
        }),
        "p",
        1,
      ),
    ).toThrow(/choice 2 must have a non-empty id/);
    expect(() =>
      normalizeAssessment(
        item({
          configuration: {
            question: { text: "Q" },
            simpleChoice: [
              choice("a", "x", true),
              { id: "b", isCorrect: "no", value: { text: "y" } },
            ],
          },
        }),
        "p",
        1,
      ),
    ).toThrow(/choice 2 must say isCorrect/);
  });

  it("refuses environment keys anywhere in the file", () => {
    expect(() => normalizeAssessment({ ...written, qa_id: 5 }, "p", 1)).toThrow(
      /environment key <root>\.qa_id/,
    );
    expect(() =>
      normalizeAssessment({ items: [{ ...written.items[0], prod_item: 1 }] }, "p", 1),
    ).toThrow(/prod_item/);
  });
});

describe("writtenItems", () => {
  it("reads each item's choices by their text, for the coverage check", () => {
    const data = normalizeAssessment(written, "p", 1);
    expect(writtenItems(data)).toEqual([
      {
        choices: [
          { text: "cat", isCorrect: true },
          { text: "cot", isCorrect: false },
        ],
      },
      {
        choices: [
          { text: "dog", isCorrect: true },
          { text: "log", isCorrect: false },
          { text: "hog", isCorrect: true },
        ],
      },
    ]);
    expect(
      coverageProblem(writtenItems(data), [{ choices: ["Cat.", "cot"], correct: "cat" }]),
    ).toBeNull();
  });
});

describe("parseHints", () => {
  it("reads a list or { items }, drops non-questions and repeats", () => {
    const hint = { sceneId: "s1", source: "selection", choices: ["a", "b"], correct: "a" };
    expect(parseHints({ items: [hint, hint, { choices: ["only"] }, "junk", null] })).toEqual([
      { sceneId: "s1", source: "selection", choices: ["a", "b"], correct: "a" },
    ]);
    expect(parseHints([{ choices: [" x ", "", null, "y"] }])).toEqual([
      { source: "selection", choices: ["x", "y"] },
    ]);
    expect(() => parseHints({})).toThrow(/items list/);
  });

  it("refuses more hints, or longer strings, than it keeps", () => {
    const many = Array.from({ length: HINTS_MAX + 1 }, () => ({ choices: ["a", "b"] }));
    expect(() => parseHints(many)).toThrow(/at most 200/);
    expect(parseHints(many.slice(1))).toHaveLength(1);
    expect(() => parseHints([{ choices: ["a".repeat(HINT_TEXT_MAX + 1), "b"] }])).toThrow(
      /500 characters/,
    );
  });
});
