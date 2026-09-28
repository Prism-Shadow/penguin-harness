import { describe, expect, it } from "vitest";
import {
  addChoice,
  addItem,
  assessmentRunState,
  blockers,
  canRemoveChoice,
  itemTitle,
  itemsChanged,
  readItems,
  removeChoice,
  removeItem,
  setCorrect,
  updateItem,
  writeItems,
  type AssessmentDraftItem,
} from "../src/features/activities/assessment-items";
import { workspaceSections } from "../src/features/activities/workspace-model";

const document = {
  title: "p-1",
  configuration: { maxItems: 2, nextItemsSize: 1 },
  behavior: "LINEAR",
  owner: "kept",
  items: [
    {
      title: "p-1-1",
      interactionKey: "SIMPLE_CHOICE",
      extra: { keep: true },
      configuration: {
        shuffle: true,
        question: { text: "Which is cat?", audio: "q1.mp3" },
        simpleChoice: [
          { id: "a", isCorrect: true, score: 1, value: { text: "cat", image: "cat.png" } },
          { id: "b", isCorrect: false, score: 0, value: { text: "cot" } },
        ],
      },
    },
    {
      title: "p-1-2",
      configuration: {
        question: { text: "Pick animals" },
        multipleResponseChoice: [
          { id: 1, isCorrect: true, value: { text: "dog" } },
          { id: 2, isCorrect: false, value: { text: "log" } },
          { id: 3, isCorrect: true, value: { text: "hog" } },
        ],
      },
    },
  ],
};

const items = () => readItems(document)!;

describe("reading items", () => {
  it("reads both choice kinds, by key or by where the choices live", () => {
    expect(items()).toEqual([
      {
        title: "p-1-1",
        interaction: "SIMPLE_CHOICE",
        question: "Which is cat?",
        shuffle: true,
        choices: [
          { id: "a", text: "cat", isCorrect: true },
          { id: "b", text: "cot", isCorrect: false },
        ],
        origin: 0,
      },
      {
        title: "p-1-2",
        interaction: "MULTIPLE_RESPONSE_CHOICE",
        question: "Pick animals",
        shuffle: false,
        choices: [
          { id: "1", text: "dog", isCorrect: true },
          { id: "2", text: "log", isCorrect: false },
          { id: "3", text: "hog", isCorrect: true },
        ],
        origin: 1,
      },
    ]);
  });

  it("leaves a document it cannot show whole to the JSON editor", () => {
    expect(readItems(null)).toBeNull();
    expect(readItems({ items: "no" })).toBeNull();
    expect(readItems({ items: [{ interactionKey: "ORDER", configuration: {} }] })).toBeNull();
    expect(readItems({ items: [{ configuration: { order: [] } }] })).toBeNull();
  });
});

describe("editing items", () => {
  it("marking a single-choice option correct unmarks the others; a multiple choice keeps them", () => {
    const [single, multiple] = items();
    expect(setCorrect(single!, "b", true).choices.map((c) => c.isCorrect)).toEqual([false, true]);
    expect(setCorrect(multiple!, "2", true).choices.map((c) => c.isCorrect)).toEqual([
      true,
      true,
      true,
    ]);
    expect(setCorrect(multiple!, "1", false).choices.map((c) => c.isCorrect)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("refuses to remove a choice below two, and adds choices with fresh ids", () => {
    const single = items()[0]!;
    expect(canRemoveChoice(single)).toBe(false);
    expect(removeChoice(single, "a")).toBe(single);
    const grown = addChoice(addChoice({ ...single, choices: [...single.choices] }));
    expect(grown.choices.map((c) => c.id)).toEqual(["a", "b", "choice-1", "choice-2"]);
    expect(canRemoveChoice(grown)).toBe(true);
    expect(removeChoice(grown, "b").choices.map((c) => c.id)).toEqual([
      "a",
      "choice-1",
      "choice-2",
    ]);
  });

  it("adds a single-choice item with its first choice correct, and removes items", () => {
    const added = addItem(items());
    expect(added[2]).toEqual({
      title: "",
      interaction: "SIMPLE_CHOICE",
      question: "",
      shuffle: false,
      choices: [
        { id: "choice-1", text: "", isCorrect: true },
        { id: "choice-2", text: "", isCorrect: false },
      ],
    });
    expect(removeItem(added, 0).map((item) => item.title)).toEqual(["p-1-2", ""]);
    expect(itemsChanged(added, items())).toBe(true);
    expect(itemsChanged(items(), items())).toBe(false);
  });
});

describe("blockers", () => {
  const item = (patch: Partial<AssessmentDraftItem>): AssessmentDraftItem => ({
    ...items()[0]!,
    ...patch,
  });

  it("names each problem with its item, and none for good items", () => {
    expect(blockers(items())).toEqual([]);
    expect(blockers([])).toEqual([{ code: "noItems" }]);
    expect(
      blockers([
        items()[0]!,
        item({ question: " " }),
        item({ choices: [{ id: "a", text: "x", isCorrect: true }] }),
        item({
          choices: [
            { id: "a", text: "", isCorrect: true },
            { id: "a", text: "y", isCorrect: false },
          ],
        }),
        item({
          choices: [
            { id: "a", text: "x", isCorrect: true },
            { id: "b", text: "y", isCorrect: true },
          ],
        }),
        item({
          interaction: "MULTIPLE_RESPONSE_CHOICE",
          choices: [
            { id: "a", text: "x", isCorrect: false },
            { id: "b", text: "y", isCorrect: false },
          ],
        }),
      ]),
    ).toEqual([
      { code: "emptyQuestion", item: 1 },
      { code: "fewChoices", item: 2 },
      { code: "emptyChoice", item: 3 },
      { code: "duplicateChoiceId", item: 3 },
      { code: "correctCount", item: 4 },
      { code: "correctCount", item: 5 },
    ]);
  });
});

describe("writing items", () => {
  it("keeps every field the editor does not show, and follows the document's naming", () => {
    let edited = updateItem(items(), 0, (item) => ({
      ...setCorrect(item, "b", true),
      question: "Which is cot?",
      shuffle: false,
    }));
    edited = addItem(edited);
    edited = updateItem(edited, 2, (item) => ({
      ...item,
      question: "New?",
      choices: item.choices.map((choice, index) => ({ ...choice, text: `c${index}` })),
    }));
    const written = writeItems(edited, document);
    expect(written).toMatchObject({
      title: "p-1",
      owner: "kept",
      behavior: "LINEAR",
      configuration: { maxItems: 3, nextItemsSize: 1 },
    });
    const [first, , third] = written.items as Record<string, any>[];
    expect(first).toEqual({
      title: "p-1-1",
      interactionKey: "SIMPLE_CHOICE",
      extra: { keep: true },
      configuration: {
        shuffle: false,
        question: { text: "Which is cot?", audio: "q1.mp3" },
        simpleChoice: [
          { id: "a", isCorrect: false, score: 0, value: { text: "cat", image: "cat.png" } },
          { id: "b", isCorrect: true, score: 1, value: { text: "cot" } },
        ],
      },
    });
    expect(third).toMatchObject({
      title: "p-1-3",
      interactionKey: "SIMPLE_CHOICE",
      configuration: {
        question: { text: "New?" },
        simpleChoice: [
          { id: "choice-1", isCorrect: true, score: 1, value: { text: "c0" } },
          { id: "choice-2", isCorrect: false, score: 0, value: { text: "c1" } },
        ],
      },
    });
    // Read back, it is what was edited.
    expect(readItems(written)!.map((item) => item.question)).toEqual([
      "Which is cot?",
      "Pick animals",
      "New?",
    ]);
  });

  it("titles every item by its position, so removing one and adding one renumbers", () => {
    const edited = addItem(removeItem(items(), 0)).map((item) => ({
      ...item,
      question: item.question || "New?",
    }));
    const written = writeItems(edited, document);
    expect((written.items as Record<string, unknown>[]).map((item) => item.title)).toEqual([
      "p-1-1",
      "p-1-2",
    ]);
    expect(itemTitle(document, 2)).toBe("p-1-3");
    expect(itemTitle({}, 0)).toBe("item-1");
  });

  it("leaves a maxItems the document did not keep in step alone", () => {
    const written = writeItems(removeItem(items(), 1), {
      ...document,
      configuration: { maxItems: 10 },
    });
    expect(written.configuration).toEqual({ maxItems: 10 });
    expect(writeItems(items(), { items: document.items }).configuration).toBeUndefined();
  });
});

describe("the latest assessment run", () => {
  const run = (patch: Record<string, unknown>) => ({
    runId: "r1",
    kind: "assessment",
    status: "succeeded",
    inputRevision: "rev",
    hasCandidate: true,
    error: null,
    ...patch,
  });

  it("offers a candidate made from this revision until it is kept aside", () => {
    expect(assessmentRunState([run({})], "rev", new Set())).toMatchObject({ state: "candidate" });
    expect(assessmentRunState([run({})], "other", new Set())).toBeNull();
    expect(assessmentRunState([run({})], "rev", new Set(["r1"]))).toBeNull();
    expect(
      assessmentRunState([run({ status: "running", inputRevision: "old" })], "rev", new Set()),
    ).toMatchObject({ state: "running" });
    expect(
      assessmentRunState([run({ status: "failed", error: "boom" })], "rev", new Set()),
    ).toMatchObject({ state: "failed", run: { error: "boom" } });
    // Only the newest assessment run counts; other kinds are not it.
    expect(
      assessmentRunState(
        [run({ kind: "spec", runId: "s" }), run({ runId: "r2", status: "cancelled" }), run({})],
        "rev",
        new Set(),
      ),
    ).toBeNull();
  });
});

describe("the Assessment Data section", () => {
  it("opens before a module exists when the specification asks an assessment", () => {
    const state = { hasSpec: true, hasPlan: false, hasModule: false };
    const find = (usesAssessment: boolean) =>
      workspaceSections({ ...state, usesAssessment }).find((entry) => entry.key === "assessment");
    expect(find(false)?.enabled).toBe(false);
    expect(find(true)?.enabled).toBe(true);
  });
});
