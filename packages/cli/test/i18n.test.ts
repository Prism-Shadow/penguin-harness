import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMessages, maskApiKey, resolveLanguage } from "../src/i18n.js";

describe("resolveLanguage (env PENGUIN_LANG, default en)", () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.PENGUIN_LANG;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.PENGUIN_LANG;
    else process.env.PENGUIN_LANG = prev;
  });

  it("defaults to en when unset", () => {
    delete process.env.PENGUIN_LANG;
    expect(resolveLanguage()).toBe("en");
  });
  it("matches zh exactly (case-insensitive, trimmed)", () => {
    process.env.PENGUIN_LANG = "zh";
    expect(resolveLanguage()).toBe("zh");
    process.env.PENGUIN_LANG = "  ZH  ";
    expect(resolveLanguage()).toBe("zh");
  });
  it("falls back to en for non-exact zh prefixes and anything else", () => {
    process.env.PENGUIN_LANG = "zh-CN"; // no longer prefix-matched -> en
    expect(resolveLanguage()).toBe("en");
    process.env.PENGUIN_LANG = "fr";
    expect(resolveLanguage()).toBe("en");
    process.env.PENGUIN_LANG = "en";
    expect(resolveLanguage()).toBe("en");
  });
});

describe("getMessages", () => {
  it("provides zh and en runtime + help strings", () => {
    expect(getMessages("zh").modelAdded("m", "m")).toContain("已添加");
    expect(getMessages("en").modelAdded("m", "m")).toContain("Added");
    expect(getMessages("zh").modelUpdated("m", "m")).toContain("已更新");
    expect(getMessages("en").modelUpdated("m", "m")).toContain("Updated");
    // Command/option descriptions are also localized.
    expect(getMessages("zh").config.addDesc).toContain("模型");
    expect(getMessages("en").config.addDesc).toContain("model");
    expect(getMessages("en").run.desc).toContain("Task");
    // config lang copy.
    expect(getMessages("zh").config.langDesc).toContain("语言");
    expect(getMessages("en").config.langDesc).toContain("language");
    expect(getMessages("en").langSet("zh", "/x/.zshrc")).toContain("/x/.zshrc");
    expect(getMessages("zh").langInvalid("fr")).toContain("fr");
    // Thinking-level control and tool-output collapsing (issue #305).
    expect(getMessages("en").thinkingCurrentDefault("medium")).toContain("medium");
    expect(getMessages("zh").thinkingCurrentDefault("medium")).toContain("medium");
    // The override form names both levels, so the distinction is readable in either locale.
    for (const lang of ["en", "zh"] as const) {
      const shown = getMessages(lang).thinkingCurrentOverride("high", "low");
      expect(shown).toContain("high");
      expect(shown).toContain("low");
      expect(shown).not.toBe(getMessages(lang).thinkingCurrentDefault("high"));
    }
    expect(getMessages("en").thinkingSet("high")).toContain("high");
    expect(getMessages("zh").thinkingSet("high")).toContain("high");
    expect(getMessages("en").thinkingInvalid("none")).toContain('"none"');
    expect(getMessages("zh").thinkingInvalid("none")).toContain('"none"');
    expect(getMessages("en").toolOutputElided(42)).toContain("42");
    expect(getMessages("zh").toolOutputElided(42)).toContain("42");
    // The hints line teaches the two new commands in both languages.
    expect(getMessages("en").chatHints()).toContain("/thinking");
    expect(getMessages("en").chatHints()).toContain("/verbose");
    expect(getMessages("zh").chatHints()).toContain("/thinking");
    expect(getMessages("zh").chatHints()).toContain("/verbose");
  });

  it("server-backed command families exist in both languages (spot checks)", () => {
    for (const lang of ["en", "zh"] as const) {
      const m = getMessages(lang);
      // Every listing command names its subject in its description.
      expect(m.ls.desc.length).toBeGreaterThan(0);
      expect(m.input.desc.length).toBeGreaterThan(0);
      expect(m.logs.desc.length).toBeGreaterThan(0);
      expect(m.agent.lsDesc.length).toBeGreaterThan(0);
      expect(m.project.lsDesc.length).toBeGreaterThan(0);
      expect(m.cost.desc.length).toBeGreaterThan(0);
      expect(m.schedule.lsDesc.length).toBeGreaterThan(0);
      // Interpolating messages carry their arguments in both languages.
      expect(m.ls.empty("proj-x")).toContain("proj-x");
      expect(m.agent.created("helper", "proj-x")).toContain("helper");
      expect(m.client.autoStarted("http://localhost:1", "/log")).toContain("http://localhost:1");
      expect(m.client.remoteNeedsToken("https://r")).toContain("PENGUIN_API_TOKEN");
      expect(m.client.noToken("http://l", "/root/api-token")).toContain("/root/api-token");
      expect(m.client.httpError(500, "boom", "detail")).toContain("500");
      expect(m.client.sessionAmbiguous("ab", ["s1", "s2"])).toContain("s1");
      expect(m.client.sessionNotFound("zz", "proj-x")).toContain("zz");
      expect(m.logs.tailInvalid("x")).toContain("x");
      expect(m.cost.byInvalid("bogus")).toContain("bogus");
      expect(m.run.sessionNoOverride()).toContain("--session");
    }
    // The dictionaries are genuinely two languages, not one copied twice.
    expect(getMessages("zh").ls.desc).not.toBe(getMessages("en").ls.desc);
    expect(getMessages("zh").client.noServer()).not.toBe(getMessages("en").client.noServer());
  });

  it("header shows the version and Agent / Workspace / Model on their own lines", () => {
    for (const lang of ["en", "zh"] as const) {
      const lines = getMessages(lang).header("run", "1.2.3", "ag", "/ws", "mod").split("\n");
      expect(lines).toHaveLength(4);
      expect(lines[0]).toContain("run");
      expect(lines[0]).toContain("v1.2.3");
      expect(lines[1]).toContain("ag");
      expect(lines[2]).toContain("/ws");
      expect(lines[3]).toContain("mod");
    }
  });
});

describe("maskApiKey", () => {
  it("masks all but the last 4 chars", () => {
    expect(maskApiKey("sk-1234567890")).toBe("****7890");
  });
  it("fully masks short keys (≤12 chars would leak most of the secret)", () => {
    expect(maskApiKey("sk-test-1234")).toBe("***");
    expect(maskApiKey("short")).toBe("***");
  });
  it("returns - when absent", () => {
    expect(maskApiKey(undefined)).toBe("-");
  });
});
