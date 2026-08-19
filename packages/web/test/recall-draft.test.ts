/**
 * mergeRecalledDraft: how a recalled queued message (#287) merges back into the composer.
 *
 * Two rules live here. The recalled text goes in front of whatever is typed (it was composed
 * first), joined by a newline only when both sides carry text. And a staged goal chip is
 * released exactly when file attachments come back: a goal draft cannot carry files (engaging
 * the chip clears them, the server refuses them), and the recalled files' scratchpad copies
 * are already deleted server-side — keeping the chip would park their only remaining copy
 * behind a Send that can never enable.
 */
import { describe, expect, it } from "vitest";
import { mergeRecalledDraft } from "../src/features/chat/recall-draft";

const merge = (over: Partial<Parameters<typeof mergeRecalledDraft>[0]> = {}) =>
  mergeRecalledDraft({
    recalledText: "recalled",
    currentText: "",
    recalledFiles: 0,
    goalOn: false,
    ...over,
  });

describe("mergeRecalledDraft — text placement", () => {
  it("recalled text lands in front of the current draft, newline-joined", () => {
    expect(merge({ currentText: "already typed" }).text).toBe("recalled\nalready typed");
  });

  it("either side alone comes through without a stray newline", () => {
    expect(merge().text).toBe("recalled");
    // An attachments-only recall (empty text) leaves the typed draft untouched.
    expect(merge({ recalledText: "", currentText: "already typed" }).text).toBe("already typed");
  });

  it("a whitespace-only draft counts as empty", () => {
    expect(merge({ currentText: "  \n " }).text).toBe("recalled");
    expect(merge({ recalledText: "", currentText: "  " }).text).toBe("");
  });
});

describe("mergeRecalledDraft — staged goal chip", () => {
  it("releases the chip only when files come back while it is staged", () => {
    expect(merge({ goalOn: true, recalledFiles: 1 }).dropGoal).toBe(true);
    expect(merge({ goalOn: true, recalledFiles: 0 }).dropGoal).toBe(false);
    expect(merge({ goalOn: false, recalledFiles: 1 }).dropGoal).toBe(false);
  });
});
