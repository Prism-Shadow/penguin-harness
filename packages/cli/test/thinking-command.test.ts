import { describe, expect, it } from "vitest";
import {
  configuredThinkingLevel,
  parseThinkingCommand,
  parseThinkingLevel,
} from "../src/thinking-command.js";
import type { ThinkingConfigSource } from "../src/thinking-command.js";

describe("parseThinkingLevel", () => {
  it("accepts the four selectable tiers (trimmed, case-insensitive)", () => {
    expect(parseThinkingLevel("low")).toBe("low");
    expect(parseThinkingLevel("medium")).toBe("medium");
    expect(parseThinkingLevel("  HIGH ")).toBe("high");
    expect(parseThinkingLevel("xhigh")).toBe("xhigh");
  });

  it('rejects "none" (a valid stored value but never selectable, mirroring the web picker) and garbage', () => {
    expect(parseThinkingLevel("none")).toBeNull();
    expect(parseThinkingLevel("")).toBeNull();
    expect(parseThinkingLevel("max")).toBeNull();
    expect(parseThinkingLevel("x-high")).toBeNull();
  });
});

describe("parseThinkingCommand", () => {
  it("bare /thinking asks to show the current level", () => {
    expect(parseThinkingCommand("/thinking")).toEqual({ ok: true, level: null });
    expect(parseThinkingCommand("  /thinking  ")).toEqual({ ok: true, level: null });
  });

  it("/thinking <level> selects a tier", () => {
    expect(parseThinkingCommand("/thinking high")).toEqual({ ok: true, level: "high" });
    expect(parseThinkingCommand("/thinking  XHIGH ")).toEqual({ ok: true, level: "xhigh" });
  });

  it("reports the offending value for anything else", () => {
    expect(parseThinkingCommand("/thinking none")).toEqual({ ok: false, value: "none" });
    expect(parseThinkingCommand("/thinking turbo")).toEqual({ ok: false, value: "turbo" });
    // Trailing extra tokens are part of the offending value, not silently dropped.
    expect(parseThinkingCommand("/thinking high now")).toEqual({ ok: false, value: "high now" });
  });
});

describe("configuredThinkingLevel (display mirror of core's resolution chain)", () => {
  const source = (
    agentLevel: "none" | "low" | "medium" | "high" | "xhigh" | undefined,
    projectDefault: "low" | "medium" | "high" | "xhigh" | undefined,
  ): ThinkingConfigSource => ({
    state: { systemConfig: agentLevel ? { model: { thinking_level: agentLevel } } : {} },
    projectConfig: projectDefault ? { default_chat: { thinking_level: projectDefault } } : {},
  });

  it("the Agent's explicit level wins over the Project default", () => {
    expect(configuredThinkingLevel(source("high", "low"))).toBe("high");
  });

  it("falls back to the Project default, then the built-in medium", () => {
    expect(configuredThinkingLevel(source(undefined, "xhigh"))).toBe("xhigh");
    expect(configuredThinkingLevel(source(undefined, undefined))).toBe("medium");
  });

  it('a stored legacy "none" still displays as-is (never rewritten)', () => {
    expect(configuredThinkingLevel(source("none", "high"))).toBe("none");
  });
});
