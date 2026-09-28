import { describe, expect, it } from "vitest";
import {
  HIGHLIGHT_MESSAGE,
  PICKED_MESSAGE,
  PICK_MODE_MESSAGE,
  STATE_MESSAGE,
  highlightMessage,
  pickModeMessage,
  readPlayerPick,
  readPlayerReport,
} from "../src/features/activities/player-bridge";

const frame = { name: "player" };
const detail = { index: 3, phase: "active", sceneId: "scene-4", state: "awaitTap" };

describe("player bridge", () => {
  it("reads a state report from the player's own frame", () => {
    const report = readPlayerReport(
      {
        type: STATE_MESSAGE,
        detail,
        interactables: [
          { id: "rock_P", inputType: "CLICK", description: "Rock P", params: { x: 1 } },
          { id: "chest", inputType: "DRAG" },
        ],
      },
      frame,
      frame,
    );
    expect(report).toEqual({
      state: detail,
      interactables: [
        { id: "rock_P", inputType: "CLICK", description: "Rock P" },
        { id: "chest", inputType: "DRAG" },
      ],
    });
  });

  it("ignores any other window, and a frame that is not there", () => {
    const message = { type: STATE_MESSAGE, detail, interactables: [] };
    expect(readPlayerReport(message, { name: "other" }, frame)).toBeNull();
    expect(readPlayerReport(message, frame, null)).toBeNull();
    expect(readPlayerReport(message, null, null)).toBeNull();
  });

  it("ignores other message types and malformed state", () => {
    expect(readPlayerReport({ type: "other", detail }, frame, frame)).toBeNull();
    expect(readPlayerReport("text", frame, frame)).toBeNull();
    expect(
      readPlayerReport({ type: STATE_MESSAGE, detail: { ...detail, index: 1.5 } }, frame, frame),
    ).toBeNull();
    expect(
      readPlayerReport({ type: STATE_MESSAGE, detail: { ...detail, state: 7 } }, frame, frame),
    ).toBeNull();
    expect(
      readPlayerReport(
        { type: STATE_MESSAGE, detail: { ...detail, sceneId: "x".repeat(201) } },
        frame,
        frame,
      ),
    ).toBeNull();
  });

  it("drops tap targets it cannot vouch for, and caps how many it keeps", () => {
    const report = readPlayerReport(
      {
        type: STATE_MESSAGE,
        detail,
        interactables: [
          { id: "ok", inputType: "CLICK" },
          { id: "", inputType: "CLICK" },
          { id: "odd", inputType: "HOVER" },
          { id: "long", inputType: "CLICK", description: "d".repeat(201) },
          null,
          ...Array.from({ length: 150 }, (_, index) => ({ id: `t${index}`, inputType: "CLICK" })),
        ],
      },
      frame,
      frame,
    );
    expect(report!.interactables[0]).toEqual({ id: "ok", inputType: "CLICK" });
    // An overlong description is dropped, not the target.
    expect(report!.interactables[1]).toEqual({ id: "long", inputType: "CLICK" });
    expect(report!.interactables.length).toBeLessThanOrEqual(100);
  });

  it("treats a missing tap target list as none", () => {
    expect(readPlayerReport({ type: STATE_MESSAGE, detail }, frame, frame)!.interactables).toEqual(
      [],
    );
  });

  it("asks the player to outline one target, or none", () => {
    expect(highlightMessage("rock_P")).toEqual({ type: HIGHLIGHT_MESSAGE, id: "rock_P" });
    expect(highlightMessage(null)).toEqual({ type: HIGHLIGHT_MESSAGE, id: null });
  });

  it("reads a pick from the player's own frame only", () => {
    const message = { type: PICKED_MESSAGE, id: "rock_P__label", interactableId: "rock_P" };
    expect(readPlayerPick(message, frame, frame)).toEqual({
      id: "rock_P__label",
      ids: ["rock_P__label"],
      interactableId: "rock_P",
    });
    // The page's list of ids out to the activity, with anything unusable dropped.
    expect(
      readPlayerPick(
        {
          type: PICKED_MESSAGE,
          id: "a",
          ids: ["a", 7, "b", "x".repeat(201)],
          interactableId: null,
        },
        frame,
        frame,
      ),
    ).toEqual({ id: "a", ids: ["a", "b"], interactableId: null });
    expect(readPlayerPick(message, { name: "other" }, frame)).toBeNull();
    expect(readPlayerPick({ ...message, type: STATE_MESSAGE }, frame, frame)).toBeNull();
  });

  it("keeps a pick with one usable id, and drops one with none", () => {
    expect(readPlayerPick({ type: PICKED_MESSAGE, id: "cat" }, frame, frame)).toEqual({
      id: "cat",
      ids: ["cat"],
      interactableId: null,
    });
    expect(
      readPlayerPick(
        { type: PICKED_MESSAGE, id: "x".repeat(201), interactableId: 3 },
        frame,
        frame,
      ),
    ).toBeNull();
    expect(readPlayerPick({ type: PICKED_MESSAGE, id: "" }, frame, frame)).toBeNull();
  });

  it("switches picking on and off", () => {
    expect(pickModeMessage(true)).toEqual({ type: PICK_MODE_MESSAGE, on: true });
    expect(pickModeMessage(false)).toEqual({ type: PICK_MODE_MESSAGE, on: false });
  });
});
