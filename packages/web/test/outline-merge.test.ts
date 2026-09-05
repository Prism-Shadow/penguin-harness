/**
 * mergeOutline (outline-model.ts): the whole conversation's turns from the server index
 * laid under the loaded entries — loaded turns win (live previews, anchors), the index
 * fills in the rest with cursors, and no index at all is today's loaded-only rail.
 */
import { describe, expect, it } from "vitest";
import { mergeOutline } from "../src/features/chat/outline-model";

const index = [
  { turn: 1, cursor: "1:1", question: "[use_skills]\nfirst", answer: "one" },
  { turn: 2, cursor: "1:6", question: "second", answer: "two" },
  { turn: 3, cursor: "2:3", question: "third", answer: "three" },
  { turn: 4, cursor: "2:8", question: "fourth", answer: "" },
];

describe("mergeOutline", () => {
  it("lays loaded entries over the index: loaded turns keep their anchors and live previews, the rest carry cursors", () => {
    const loaded = [
      { anchorId: 7, question: "third", answer: "three, then more" },
      { anchorId: 9, question: "fourth", answer: "four" },
    ];
    const merged = mergeOutline(index, loaded, 2);
    expect(merged.map((t) => [t.turn, t.anchorId, t.cursor, t.answer])).toEqual([
      [1, null, "1:1", "one"],
      [2, null, "1:6", "two"],
      [3, 7, "2:3", "three, then more"],
      [4, 9, "2:8", "four"],
    ]);
  });

  it("strips the index's raw questions with the caller's parser; loaded questions are already stripped", () => {
    const merged = mergeOutline(index.slice(0, 1), [], 0, (raw) =>
      raw.replace(/^\[use_skills\]\n/, ""),
    );
    expect(merged[0]!.question).toBe("first");
  });

  it("a turn newer than the index (a Task that just ended) comes from the loaded entries alone, without a cursor", () => {
    const merged = mergeOutline(index, [{ anchorId: 11, question: "fifth", answer: "" }], 4);
    expect(merged.map((t) => t.turn)).toEqual([1, 2, 3, 4, 5]);
    expect(merged[4]).toEqual({
      turn: 5,
      anchorId: 11,
      cursor: null,
      question: "fifth",
      answer: "",
    });
  });

  it("no index: the loaded entries numbered from the offset, exactly as before", () => {
    const merged = mergeOutline([], [{ anchorId: 3, question: "q", answer: "a" }], 6);
    expect(merged).toEqual([{ turn: 7, anchorId: 3, cursor: null, question: "q", answer: "a" }]);
  });
});
