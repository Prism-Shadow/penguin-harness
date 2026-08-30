import { describe, expect, it } from "vitest";
import {
  configuredThinkingLevel,
  parseThinkingCommand,
  parseThinkingLevel,
} from "../src/thinking-command.js";
import type { ThinkingConfigSource } from "../src/thinking-command.js";
import { getMessages } from "../src/i18n.js";
import { DEFAULT_CHAT_THINKING_LEVELS } from "@prismshadow/penguin-core";

describe("parseThinkingLevel", () => {
  it("accepts every selectable tier (trimmed, case-insensitive)", () => {
    expect(parseThinkingLevel("low")).toBe("low");
    expect(parseThinkingLevel("medium")).toBe("medium");
    expect(parseThinkingLevel("  HIGH ")).toBe("high");
    expect(parseThinkingLevel("xhigh")).toBe("xhigh");
    // "max" joined the ladder with AgentHub 0.4.4; the flag and /thinking accept it because
    // both validate against core's DEFAULT_CHAT_THINKING_LEVELS, and the printed sets say so.
    expect(parseThinkingLevel("MAX")).toBe("max");
  });

  it('rejects "none" (a valid stored value but never selectable, mirroring the web picker) and garbage', () => {
    expect(parseThinkingLevel("none")).toBeNull();
    expect(parseThinkingLevel("")).toBeNull();
    expect(parseThinkingLevel("x-high")).toBeNull();
  });
});

describe("the advertised tier set matches the accepted one", () => {
  it("every tier the messages name is actually accepted, in both locales", () => {
    // #322 spelled the ladder out in free text rather than deriving it, so widening the
    // ladder in core silently desynced the printed set from the accepted one. Pin it.
    for (const messages of [getMessages("en"), getMessages("zh")]) {
      const printed = [
        messages.common.thinking,
        messages.thinkingCurrent("low"),
        messages.thinkingInvalid("bogus"),
      ].join(" ");
      for (const level of DEFAULT_CHAT_THINKING_LEVELS) {
        expect(printed).toContain(level);
      }
    }
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
    agentLevel: "none" | "low" | "medium" | "high" | "xhigh" | "max" | undefined,
    projectDefault: "low" | "medium" | "high" | "xhigh" | "max" | undefined,
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
