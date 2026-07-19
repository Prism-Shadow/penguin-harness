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
  });

  it("header order is agent → workspace → model", () => {
    const h = getMessages("en").header("run", "ag", "/ws", "mod");
    expect(h.indexOf("agent=ag")).toBeLessThan(h.indexOf("workspace=/ws"));
    expect(h.indexOf("workspace=/ws")).toBeLessThan(h.indexOf("model=mod"));
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
