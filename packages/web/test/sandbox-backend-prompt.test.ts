/**
 * When the Sandbox card offers to install a backend (lib/sandbox-backend-prompt.ts).
 *
 * - Given a machine that reports no backend for its OS and names a default, the default is
 *   offered; given one with a backend installed, no default, or no report, nothing is.
 * - Given "Don't ask again" ticked for a machine, that machine is not asked again in this
 *   browser, and every other machine still is.
 * - Given storage that throws or holds garbage, the prompt is offered (never silently
 *   dismissed) and nothing throws.
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
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const MISSING = { backend: { installed: false, recommended: "@penguinharness/sandbox-bwrap" } };

describe("the default-backend prompt", () => {
  it("offers the OS's default only when no backend for the OS is installed", () => {
    const storage = memoryStorage();
    expect(backendToOffer(MISSING, "m1", storage)).toBe("@penguinharness/sandbox-bwrap");
    expect(
      backendToOffer(
        { backend: { installed: true, recommended: "@penguinharness/sandbox-bwrap" } },
        "m1",
        storage,
      ),
    ).toBeNull();
    expect(backendToOffer({ backend: { installed: false } }, "m1", storage)).toBeNull();
    expect(backendToOffer({}, "m1", storage)).toBeNull();
  });

  it("remembers don't-ask-again per machine, in this browser's storage only", () => {
    const storage = memoryStorage();
    dismissBackendPrompt("m1", storage);
    dismissBackendPrompt("m1", storage);
    expect(backendPromptDismissed("m1", storage)).toBe(true);
    expect(backendToOffer(MISSING, "m1", storage)).toBeNull();
    expect(backendToOffer(MISSING, "m2", storage)).toBe("@penguinharness/sandbox-bwrap");
    expect(JSON.parse(storage.data.get(BACKEND_PROMPT_DISMISSED_KEY)!)).toEqual(["m1"]);
  });

  it("asks again when storage is unavailable, throws or holds garbage", () => {
    const throwing: PromptStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => dismissBackendPrompt("m1", throwing)).not.toThrow();
    expect(backendToOffer(MISSING, "m1", throwing)).toBe("@penguinharness/sandbox-bwrap");
    expect(backendToOffer(MISSING, "m1", null)).toBe("@penguinharness/sandbox-bwrap");
    const garbage = memoryStorage();
    garbage.setItem(BACKEND_PROMPT_DISMISSED_KEY, "{not json");
    expect(backendPromptDismissed("m1", garbage)).toBe(false);
    dismissBackendPrompt("m1", garbage);
    expect(backendPromptDismissed("m1", garbage)).toBe(true);
  });
});
