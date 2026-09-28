/**
 * An author's edit of a module document, decided without the filesystem: what it derives
 * from, when it is stale, what a saved document must be, and that a draft nobody edited keeps
 * its revision.
 */
import { describe, expect, it } from "vitest";
import { contentRevision, draftRevision } from "../src/activities/domain.js";
import {
  assessmentBasis,
  assessmentItems,
  configurationBasis,
  isStale,
  keepsEdit,
  MODULE_DOCUMENT_MAX_BYTES,
  validateAssessment,
  validateConfiguration,
} from "../src/activities/module-overrides.js";
import { HttpError } from "../src/http/errors.js";

const choice = (id: string | number, isCorrect: boolean) => ({ id, isCorrect });

function refusal(run: () => unknown): HttpError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error("expected a refusal");
}

describe("what an edit derives from", () => {
  it("is the manifest for the configuration and the specification for the assessment", () => {
    const manifest = { productCode: "p", refNum: 1, assets: {} };
    const draft = { spec: { id: "p" }, mediaPlan: { manifest } } as never;
    expect(configurationBasis(draft)).toBe(contentRevision({ ...manifest, refNum: 0 }));
    expect(assessmentBasis(draft)).toBe(contentRevision({ id: "p" }));
    expect(configurationBasis({ mediaPlan: undefined })).toBeNull();
    expect(assessmentBasis({ spec: null })).toBeNull();
  });

  it("does not change when only the ref's number changes", () => {
    const manifest = { productCode: "p", refNum: 1, assets: {} };
    const renumbered = { ...manifest, refNum: 7 };
    expect(configurationBasis({ mediaPlan: { manifest: renumbered } } as never)).toBe(
      configurationBasis({ mediaPlan: { manifest } } as never),
    );
    expect(
      configurationBasis({ mediaPlan: { manifest: { ...manifest, assets: { a: 1 } } } } as never),
    ).not.toBe(configurationBasis({ mediaPlan: { manifest } } as never));
  });

  it("is stale exactly when that has changed", () => {
    const override = { value: {}, basis: "a", editedAt: "now" };
    expect(isStale(override, "a")).toBe(false);
    expect(isStale(override, "b")).toBe(true);
    expect(isStale(override, null)).toBe(true);
    expect(isStale({ ...override, basis: null }, null)).toBe(false);
  });
});

describe("a configuration an author saves", () => {
  it("is a JSON object within the size limit", () => {
    expect(validateConfiguration({ p: { telemetry: false } })).toEqual({ p: { telemetry: false } });
    for (const value of [null, [], "text", 3])
      expect(refusal(() => validateConfiguration(value)).code).toBe("document_invalid");
    const huge = { text: "x".repeat(MODULE_DOCUMENT_MAX_BYTES) };
    const error = refusal(() => validateConfiguration(huge));
    expect(error.status).toBe(422);
    expect(error.message).toContain("bytes or smaller");
  });
});

describe("an assessment an author saves", () => {
  it("needs an items list", () => {
    expect(refusal(() => validateAssessment({ questions: [] })).message).toBe(
      "An assessment needs an items list.",
    );
    expect(validateAssessment({ items: [] })).toEqual({ items: [] });
  });

  it("reads choice items the way the rules check them, and passes other kinds through", () => {
    const value = {
      items: [
        { title: "a", configuration: { simpleChoice: [choice(1, true), choice(2, false)] } },
        { title: "b", configuration: { order: {} } },
        {
          title: "c",
          interactionKey: "multiple_response_choice",
          configuration: { multipleResponseChoice: [choice("x", true), choice("y", true)] },
        },
      ],
    };
    expect(assessmentItems(value)).toEqual([
      {
        id: "a",
        interaction: "SIMPLE_CHOICE",
        choices: [
          { id: "1", isCorrect: true },
          { id: "2", isCorrect: false },
        ],
      },
      {
        id: "c",
        interaction: "MULTIPLE_RESPONSE_CHOICE",
        choices: [
          { id: "x", isCorrect: true },
          { id: "y", isCorrect: true },
        ],
      },
    ]);
    expect(validateAssessment(value)).toBe(value);
  });

  it("refuses a single choice with two correct answers, naming the item by its place", () => {
    const error = refusal(() =>
      validateAssessment({
        items: [
          { title: "free", configuration: { textEntry: {} } },
          { title: "q", configuration: { simpleChoice: [choice("a", true), choice("b", true)] } },
        ],
      }),
    );
    expect(error.status).toBe(422);
    expect(error.code).toBe("document_invalid");
    expect(error.message).toBe(
      "Item 2 is a single choice, so it needs exactly one correct choice.",
    );
  });

  it("refuses repeated titles and too few choices", () => {
    const error = refusal(() =>
      validateAssessment({
        items: [
          { title: "q", configuration: { simpleChoice: [choice("a", true), choice("b", false)] } },
          { title: "q", configuration: { simpleChoice: [choice("a", true)] } },
        ],
      }),
    );
    expect(error.message).toBe('Item 2 repeats the id "q". Item 2 needs at least two choices.');
  });

  it("lets through a problem the document being edited already had", () => {
    const baseline = {
      items: [
        { title: "q", configuration: { simpleChoice: [choice("a", true), choice("b", true)] } },
        { title: "r", configuration: { simpleChoice: [choice("a", true), choice("b", false)] } },
      ],
    };
    // A word changed inside the item that already broke a rule, and the items moved.
    const edited = {
      items: [
        { title: "r", configuration: { simpleChoice: [choice("a", true), choice("b", false)] } },
        {
          title: "q",
          prompt: "changed",
          configuration: { simpleChoice: [choice("a", true), choice("b", true)] },
        },
      ],
    };
    expect(validateAssessment(edited, baseline)).toBe(edited);
    // A problem the edit introduces is still refused.
    const broken = {
      items: [
        edited.items[1],
        { title: "r", configuration: { simpleChoice: [choice("a", true), choice("b", true)] } },
      ],
    };
    expect(refusal(() => validateAssessment(broken, baseline)).message).toBe(
      "Item 2 is a single choice, so it needs exactly one correct choice.",
    );
  });

  it("names at most five problems and counts the rest", () => {
    const items = Array.from({ length: 7 }, (_, n) => ({
      title: `q${n}`,
      configuration: { simpleChoice: [choice("a", true)] },
    }));
    const message = refusal(() => validateAssessment({ items })).message;
    expect(message).toContain("Item 5 needs at least two choices.");
    expect(message).not.toContain("Item 6");
    expect(message.endsWith("And 2 more problems.")).toBe(true);
  });
});

describe("an assembled document", () => {
  it("keeps an edit when it only adds to it", () => {
    const edit = { p: { en: { word: "cat" }, rounds: 3 } };
    expect(keepsEdit(edit, edit)).toBe(true);
    expect(keepsEdit({ p: { en: { word: "cat", extra: 1 }, rounds: 3, more: true } }, edit)).toBe(
      true,
    );
    expect(keepsEdit({ p: { en: { word: "dog" }, rounds: 3 } }, edit)).toBe(false);
    expect(keepsEdit({ p: { rounds: 3 } }, edit)).toBe(false);
    expect(keepsEdit({ items: [1, 2, 3] }, { items: [1, 2] })).toBe(false);
    expect(keepsEdit({}, { constructor: 1 })).toBe(false);
  });
});

describe("the draft revision", () => {
  it("is unchanged for a draft without edits, and changes with one", () => {
    const draft = { description: "d", spec: { id: "p" } };
    expect(draftRevision(draft)).toBe(contentRevision({ description: "d", spec: { id: "p" } }));
    const edited = {
      ...draft,
      moduleDocuments: { configuration: { value: {}, basis: null, editedAt: "now" } },
    };
    expect(draftRevision(edited)).not.toBe(draftRevision(draft));
  });
});
