/**
 * Company mode's once-only beta notice (features/company/company-beta.tsx): the first switch
 * into the mode in a browser raises it, later ones do not.
 *
 * - The notice is owed in a browser that has never shown it, and no longer once it is marked.
 * - It stays owed while the flag holds anything but the mark.
 * - A storage that throws, or no storage at all, owes nothing, so the notice cannot repeat on
 *   every switch; marking it then does not throw.
 */
import { describe, expect, it } from "vitest";
import {
  BETA_NOTICE_KEY,
  markBetaNoticeShown,
  shouldShowBetaNotice,
} from "../src/features/company/company-beta";
import { blockedStorage, memoryStorage } from "./helpers/storage";

describe("shouldShowBetaNotice", () => {
  it("is owed on a browser that has never seen it, and not after it is marked", () => {
    const storage = memoryStorage();
    expect(shouldShowBetaNotice(storage)).toBe(true);
    markBetaNoticeShown(storage);
    expect(storage.map.get(BETA_NOTICE_KEY)).toBe("1");
    expect(shouldShowBetaNotice(storage)).toBe(false);
  });

  it("stays owed while the flag holds anything but the mark", () => {
    for (const flag of ["", "true", "0"]) {
      expect(shouldShowBetaNotice(memoryStorage({ [BETA_NOTICE_KEY]: flag }))).toBe(true);
    }
  });

  it("answers no when storage throws, so the notice cannot repeat on every switch", () => {
    expect(shouldShowBetaNotice(blockedStorage())).toBe(false);
    expect(() => markBetaNoticeShown(blockedStorage())).not.toThrow();
  });

  it("answers no when there is no storage at all (Node, no localStorage)", () => {
    expect(shouldShowBetaNotice()).toBe(false);
    expect(() => markBetaNoticeShown()).not.toThrow();
  });
});
