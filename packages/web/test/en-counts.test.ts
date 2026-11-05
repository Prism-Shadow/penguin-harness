/**
 * English counts that can be one read in the singular (lib/strings-en.ts).
 *
 * - A user-defined model group exists only through its rows and often holds a single model, so
 *   deleting it or speed-testing it names "1 model", not "1 models".
 * - A memory export can carry a single memory, and the import dialog then says "1 memory", in the
 *   file line and in the overwrite and delete warnings.
 */
import { describe, expect, it } from "vitest";
import { en } from "../src/lib/strings-en";

describe("English counts of one", () => {
  it("the model group dialogs name one model in the singular", () => {
    expect(en.models.deleteGroupConfirm("Lab", 1)).toBe(
      "Delete the group “Lab”? Its 1 model and its API key configuration will be removed.",
    );
    expect(en.models.deleteGroupConfirm("Lab", 3)).toBe(
      "Delete the group “Lab”? Its 3 models and their API key configuration will be removed.",
    );
    expect(en.models.groupDeleted(1)).toBe("Group deleted (1 model)");
    expect(en.models.groupDeleted(3)).toBe("Group deleted (3 models)");
    expect(en.models.speedTestConfirm(1)).toContain(
      "one real request to the model in this group to",
    );
    expect(en.models.speedTestConfirm(3)).toContain(
      "one real request to each of the 3 models in this group, one at a time, to",
    );
  });

  it("the memory import dialog names one memory in the singular", () => {
    expect(en.memory.importFile("notes.json", 1)).toBe("notes.json — 1 memory");
    expect(en.memory.importFile("notes.json", 4)).toBe("notes.json — 4 memories");
    expect(en.memory.importWillOverwrite(["style"])).toBe("1 memory will be overwritten: style");
    expect(en.memory.importWillOverwrite(["a", "b"])).toBe("2 memories will be overwritten: a, b");
    expect(en.memory.importWillRemove(["style"])).toBe("1 memory will be deleted: style");
    expect(en.memory.importWillRemove(["a", "b"])).toBe("2 memories will be deleted: a, b");
  });
});
