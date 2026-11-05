import { describe, expect, it } from "vitest";
import { userText } from "@prismshadow/penguin-core";
import { isHumanInput } from "../src/runtime/session-manager.js";

describe("isHumanInput", () => {
  it("is true for a person's message, with or without an explicit sender", () => {
    expect(isHumanInput([userText("hello")])).toBe(true);
    expect(isHumanInput([userText("hello", "user")])).toBe(true);
  });

  it("is false for anything the harness injected", () => {
    expect(isHumanInput([userText("[org_trigger]…", "server")])).toBe(false);
    expect(isHumanInput([userText("context", "harness")])).toBe(false);
    expect(isHumanInput([userText("hello"), userText("context", "harness")])).toBe(false);
  });
});
