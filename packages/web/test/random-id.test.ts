/**
 * randomHex (lib/random-id.ts) and the two ids it mints: parked drafts (draft-sessions.ts) and
 * user shortcuts (user-shortcuts.ts). Both have to work in an insecure context — a Web App served
 * over plain HTTP from any address but localhost — where `crypto.randomUUID` does not exist and
 * the previous generator threw on the "+" button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { draftKey, saveDraft } from "../src/features/chat/draft-cache";
import type { DraftStorage } from "../src/features/chat/draft-cache";
import { parkActiveDraft } from "../src/features/chat/draft-sessions";
import { newShortcutId } from "../src/features/chat/user-shortcuts";
import { randomHex } from "../src/lib/random-id";

describe("randomHex", () => {
  it("returns exactly the requested number of lowercase hex characters", () => {
    for (const length of [1, 8, 12, 13, 32]) {
      expect(randomHex(length)).toMatch(new RegExp(`^[0-9a-f]{${length}}$`));
    }
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomHex(8)));
    expect(ids.size).toBe(200);
  });
});

/**
 * The regression, driven through the two functions that actually threw. Stubbing the global and
 * then asserting on randomHex alone would prove nothing: randomHex never names randomUUID, so
 * such a test passes just as happily with randomUUID put back into either call site.
 */
describe("an insecure context, where crypto carries getRandomValues and no randomUUID", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubInsecureCrypto(): void {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
  }

  /** In-memory storage: vitest runs in a Node environment, so there is no localStorage. */
  function memStorage(): DraftStorage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
    };
  }

  it("parks a typed draft rather than throwing on the '+' click", () => {
    const s = memStorage();
    stubInsecureCrypto();
    saveDraft(draftKey("u-insecure", "proj"), { text: "half-written prompt" }, s);
    expect(parkActiveDraft("u-insecure", "proj", s)).toMatch(/^draft-[0-9a-f]{8}$/);
  });

  it("mints a shortcut id rather than throwing on save", () => {
    stubInsecureCrypto();
    expect(newShortcutId()).toMatch(/^sc-[0-9a-f]{12}$/);
  });
});
