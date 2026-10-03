/**
 * When the Sandbox card offers to install backends: every default together, only where none for
 * the OS is installed; "Don't ask again" holds per machine; broken storage never hides the prompt.
 */
import { describe, expect, it } from "vitest";
import {
  BACKEND_PROMPT_DISMISSED_KEY,
  backendPromptDismissed,
  backendToOffer,
  dismissBackendPrompt,
} from "../src/lib/sandbox-backend-prompt";
import type { PromptStorage } from "../src/lib/sandbox-backend-prompt";

function memoryStorage(): PromptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const LINUX = ["@penguinharness/sandbox-bwrap", "@penguinharness/sandbox-dsh"];
const MISSING = { backend: { installed: false, recommended: LINUX } };

describe("the default-backend prompt", () => {
  it.each([
    [MISSING, LINUX],
    [{ backend: { installed: true, recommended: LINUX } }, null],
    [{ backend: { installed: false } }, null],
    [{ backend: { installed: false, recommended: [] } }, null],
    [{}, null],
  ])("offers %j: %j", (report, offer) => {
    expect(backendToOffer(report, "m1", memoryStorage())).toEqual(offer);
  });

  it("remembers don't-ask-again per machine, in this browser's storage only", () => {
    const storage = memoryStorage();
    dismissBackendPrompt("m1", storage);
    dismissBackendPrompt("m1", storage);
    expect(backendToOffer(MISSING, "m1", storage)).toBeNull();
    expect(backendToOffer(MISSING, "m2", storage)).toEqual(LINUX);
    expect(JSON.parse(storage.data.get(BACKEND_PROMPT_DISMISSED_KEY)!)).toEqual(["m1"]);
  });

  it("asks again when storage is unavailable, throws or holds garbage", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    const throwing: PromptStorage = { getItem: blocked, setItem: blocked };
    expect(() => dismissBackendPrompt("m1", throwing)).not.toThrow();
    expect(backendToOffer(MISSING, "m1", throwing)).toEqual(LINUX);
    expect(backendToOffer(MISSING, "m1", null)).toEqual(LINUX);
    const garbage = memoryStorage();
    garbage.setItem(BACKEND_PROMPT_DISMISSED_KEY, "{not json");
    expect(backendPromptDismissed("m1", garbage)).toBe(false);
    dismissBackendPrompt("m1", garbage);
    expect(backendPromptDismissed("m1", garbage)).toBe(true);
  });
});
