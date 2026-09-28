import { describe, expect, it } from "vitest";
import { isReservedEnvKey, validateAgentEnvEntry } from "../src/env.js";
import { parseDefinition } from "../src/types.js";

describe("agent env rules", () => {
  it("reserves the sandbox pass-through names, NO_BROWSER and PENGUIN_*", () => {
    for (const key of [
      "PATH",
      "path",
      "UserProfile",
      "NO_BROWSER",
      "PENGUIN_CODING_AGENT_HOME",
      "PENGUIN_X",
    ]) {
      expect(isReservedEnvKey(key)).toBe(true);
    }
    for (const key of ["GEMINI_API_KEY", "COPILOT_GITHUB_TOKEN", "PATHS", "MY_PENGUIN"]) {
      expect(isReservedEnvKey(key)).toBe(false);
    }
  });

  it("names what is wrong with a key or value", () => {
    expect(validateAgentEnvEntry("GEMINI_API_KEY", "abc")).toBeNull();
    expect(validateAgentEnvEntry("GEMINI_API_KEY", undefined)).toBeNull();
    expect(validateAgentEnvEntry("1BAD", "x")).toMatch(/letter or underscore/);
    expect(validateAgentEnvEntry("HAS-DASH", "x")).toMatch(/letter or underscore/);
    expect(validateAgentEnvEntry("PATH", "x")).toMatch(/set by Penguin/);
    expect(validateAgentEnvEntry("K", "")).toMatch(/empty/);
    expect(validateAgentEnvEntry("K", "a\nb")).toMatch(/line break/);
    expect(validateAgentEnvEntry("K", "x".repeat(8193))).toMatch(/8192/);
    expect(validateAgentEnvEntry("K", "x".repeat(8192))).toBeNull();
  });

  it("carries the built-in marker through parseDefinition", () => {
    expect(parseDefinition({ id: "a", command: "c", builtin: "copilot" }).builtin).toBe("copilot");
    expect(parseDefinition({ id: "a", command: "c" })).not.toHaveProperty("builtin");
    expect(() => parseDefinition({ id: "a", command: "c", builtin: 3 })).toThrow(/builtin/);
  });
});
