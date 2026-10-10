/**
 * randomHex (lib/random-id.ts) and the two ids it mints: parked drafts (draft-sessions.ts) and
 * user shortcuts (user-shortcuts.ts).
 *
 * - randomHex returns exactly the requested number of lowercase hex characters, and does not
 *   repeat.
 * - In an insecure context (plain HTTP from any address but localhost, where crypto has no
 *   randomUUID), parking a draft and saving a shortcut still mint their ids instead of throwing.
 */
import { describe, expect, it, vi } from "vitest";
import { draftKey, saveDraft } from "../src/features/chat/draft-cache";
import { parkActiveDraft } from "../src/features/chat/draft-sessions";
import { newShortcutId } from "../src/features/chat/user-shortcuts";
import { randomHex } from "../src/lib/random-id";
import { memoryStorage } from "./helpers/storage";

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
  function stubInsecureCrypto(): void {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
  }

  it("parks a typed draft rather than throwing on the '+' click", () => {
    const s = memoryStorage();
    stubInsecureCrypto();
    saveDraft(draftKey("u-insecure", "proj"), { text: "half-written prompt" }, s);
    expect(parkActiveDraft("u-insecure", "proj", s)).toMatch(/^draft-[0-9a-f]{8}$/);
  });

  it("mints a shortcut id rather than throwing on save", () => {
    stubInsecureCrypto();
    expect(newShortcutId()).toMatch(/^sc-[0-9a-f]{12}$/);
  });
});
