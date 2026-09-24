import { describe, expect, it } from "vitest";
import {
  inInstructionFilter,
  instructionType,
  instructionTypes,
} from "../src/features/activities/instruction-type";

describe("instructionType", () => {
  it("calls a hint in the key scaffolding", () => {
    expect(instructionType({ key: "scene1_hint", description: "", script: "Look again" })).toBe(
      "scaffolding",
    );
  });

  it("leaves background music in the description as other", () => {
    expect(instructionType({ key: "intro", description: "Background music", script: "" })).toBe(
      "other",
    );
  });

  it("finds a main instruction's verb in the script", () => {
    expect(instructionType({ key: "ask", description: "", script: "Tap the red rock" })).toBe(
      "main",
    );
    expect(instructionType({ key: "ask", script: "Press and hold the button" })).toBe("main");
    expect(instructionType({ key: "pick_one", description: "Select the date" })).toBe("main");
  });

  it("lets scaffolding in the key or description win over a main verb in the script", () => {
    expect(instructionType({ key: "try_again", script: "Tap the rock" })).toBe("scaffolding");
    expect(instructionType({ key: "ask", description: "Not quite", script: "Tap it" })).toBe(
      "scaffolding",
    );
  });

  it("lets an excluded word in the key or description win over a main verb", () => {
    expect(instructionType({ key: "celebration", script: "Tap to continue" })).toBe("other");
  });

  it("finds scaffolding in the script only after looking for a main verb", () => {
    expect(instructionType({ key: "line_4", script: "Not quite, have another look" })).toBe(
      "scaffolding",
    );
    expect(instructionType({ key: "line_4", script: "Wrong! Tap the other one" })).toBe("main");
  });

  it("normalizes separators and case before matching", () => {
    expect(instructionType({ key: "try-again" })).toBe("scaffolding");
    expect(instructionType({ key: "Try_Again" })).toBe("scaffolding");
    expect(instructionType({ key: "keep.trying" })).toBe("scaffolding");
    expect(instructionType({ key: "re/prompt" })).toBe("scaffolding");
    expect(instructionType({ key: "press__and--hold" })).toBe("main");
  });

  it("matches keywords as substrings, as Loom does", () => {
    expect(instructionType({ key: "tape_measure" })).toBe("main");
    expect(instructionType({ key: "selection" })).toBe("main");
  });

  it("files every excluded kind of sound under other", () => {
    for (const word of ["sfx_pop", "jingle", "ambient_loop", "outro", "applause"])
      expect(instructionType({ key: word, script: "Hooray" })).toBe("other");
  });

  it("calls music and sound effects other whatever their words", () => {
    expect(instructionType({ key: "tap_hint", script: "Tap", kind: "sfx" })).toBe("other");
    expect(instructionType({ key: "theme", kind: "music" })).toBe("other");
  });

  it("treats a script of empty as no script", () => {
    expect(instructionType({ key: "line", script: " EMPTY " })).toBe("other");
    expect(instructionType({ key: "line", script: "empty" })).toBe("other");
    expect(instructionType({ key: "hint" })).toBe("scaffolding");
  });

  it("leaves a line with no keyword as other", () => {
    expect(instructionType({ key: "welcome", description: "welcome line", script: "Hello" })).toBe(
      "other",
    );
  });
});

describe("inInstructionFilter", () => {
  it("keeps everything under all and only the matching type otherwise", () => {
    expect(inInstructionFilter("other", "all")).toBe(true);
    expect(inInstructionFilter("main", "main")).toBe(true);
    expect(inInstructionFilter("scaffolding", "main")).toBe(false);
    expect(inInstructionFilter("other", "scaffolding")).toBe(false);
    expect(inInstructionFilter("scaffolding", "scaffolding")).toBe(true);
  });
});

describe("instructionTypes", () => {
  it("sorts a translation by the default language's script, so a line keeps its type", () => {
    const sources = new Map([
      ["ask", "Tap the red rock"],
      ["line_4", "Not quite"],
    ]);
    const types = instructionTypes(
      [
        { key: "ask", script: "Toca la roca roja" },
        { key: "line_4", script: "" },
        { key: "welcome", script: "Hola" },
      ],
      sources,
    );
    expect(types.get("ask")).toBe("main");
    expect(types.get("line_4")).toBe("scaffolding");
    expect(types.get("welcome")).toBe("other");
  });

  it("sorts the default language by its own script", () => {
    const types = instructionTypes([{ key: "ask", script: "Toca la roca roja" }]);
    expect(types.get("ask")).toBe("other");
  });
});
