/**
 * The CLI's language and its two dictionaries.
 *
 * - PENGUIN_LANG picks zh only when it says exactly zh; anything else, or nothing, is en.
 * - The in-session model switch is taught the same way in both languages.
 * - In both languages a message carries what it is given, and an optional part only when it is
 *   given; each reason the built-in browser is unavailable gets a hint of its own.
 * - The header puts the build, Agent, Workspace, Model and Server on their own lines.
 * - An API key is masked to its last four characters, or wholly when it is short.
 */
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
  it("the in-session model switch reads the same in both languages", () => {
    const en = getMessages("en");
    const zh = getMessages("zh");
    for (const m of [en, zh]) {
      // Every surface that teaches the command names it with its argument pair and says a
      // switch compacts first.
      for (const text of [m.chatHints(), m.switchModelCurrent("a (p)"), m.resumeNoOverride()]) {
        expect(text).toContain("/switch-model <provider> <model_id>");
      }
      expect(m.chat.resume).toContain("/switch-model");
      expect(m.switchModelUsage()).toContain("/switch-model <provider> <model_id>");
      // Interpolations carry their arguments.
      const done = m.switchModelDone("a (p)", "b (q)");
      expect(done).toContain("a (p) → b (q)");
      expect(m.switchModelSame("b (q)")).toContain("b (q)");
      const notConfigured = m.switchModelNotConfigured("b (q)", "LIST-CMD", "ADD-CMD");
      for (const part of ["b (q)", "LIST-CMD", "ADD-CMD"]) expect(notConfigured).toContain(part);
      expect(m.switchModelUnavailable("b (q)", "no key")).toContain("no key");
      expect(m.switchModelUnavailable("b (q)", "")).not.toMatch(/[:：]$/);
      expect(m.switchModelBusy().length).toBeGreaterThan(0);
      expect(m.switchModelHandedOver("/t/s_001.jsonl")).toContain("/t/s_001.jsonl");
    }
    // Two languages, not one copied twice.
    expect(zh.switchModelDone("a", "b")).not.toBe(en.switchModelDone("a", "b"));
    expect(zh.switchModelBusy()).not.toBe(en.switchModelBusy());
    expect(zh.switchModelHandedOver()).not.toBe(en.switchModelHandedOver());
  });

  it.each(["en", "zh"] as const)(
    "%s: a message carries what it is given, and an optional part only when it is given",
    (lang) => {
      const m = getMessages(lang);
      const at = "2026-08-27T09:00:00.000Z";
      const on = m.schedule.enabled();
      // [the message with its optional part, the same message without it, what only the first carries]
      const optional: Array<[string, string, string]> = [
        [m.schedule.written("daily", on, at), m.schedule.written("daily", on, undefined), at],
        [
          m.org.calendarWritten("dev1", "standup", on, at),
          m.org.calendarWritten("dev1", "standup", on, undefined),
          at,
        ],
        [m.org.created("acme", "session-x"), m.org.created("acme", undefined), "session-x"],
        [m.org.hired("dev1", "Developer", "ceo"), m.org.hired("dev1", "Developer", null), "ceo"],
        [
          m.org.ticketHead("2026-09-02-site", "review", false, "waiting"),
          m.org.ticketHead("2026-09-02-site", "review", false, undefined),
          "waiting",
        ],
        [
          m.browser.sourceNotFound("safari", ["chrome"]),
          m.browser.sourceNotFound("safari", []),
          "chrome",
        ],
        [m.client.httpError(500, "boom", "detail"), m.client.httpError(500, "boom", ""), "detail"],
        [m.modelAdded("m1", "d1"), m.modelAdded("m1", undefined), "d1"],
        [m.modelUpdated("m1", "d1"), m.modelUpdated("m1", undefined), "d1"],
      ];
      for (const [given, left, part] of optional) {
        expect(given).toContain(part);
        expect(left).not.toContain(part);
      }
      const tab = m.browser.tabHead(12, "Orders", "https://a.example/", false);
      for (const part of ["12", "Orders", "https://a.example/"]) expect(tab).toContain(part);
    },
  );

  it.each(["en", "zh"] as const)(
    "%s: each reason the built-in browser is unavailable gets a hint of its own",
    (lang) => {
      const m = getMessages(lang);
      const reasons = [
        undefined,
        "shell_unsupported",
        "no_window",
        "not_desktop",
        "extension_not_paired",
        "extension_disconnected",
        "extension_disabled",
      ];
      const hints = new Set(reasons.map((reason) => m.browser.unavailableHint(reason)));
      expect(hints.size).toBe(reasons.length);
    },
  );

  it("header shows the build and Agent / Workspace / Model / Server on their own lines", () => {
    for (const lang of ["en", "zh"] as const) {
      const lines = getMessages(lang)
        .header("run", "v1.2.3-4-gabc1234", "ag", "/ws", "mod", "http://localhost:7368 (/dev)")
        .split("\n");
      expect(lines).toHaveLength(5);
      expect(lines[0]).toContain("run");
      // The build's own identity, verbatim: a source build names its commit.
      expect(lines[0]).toContain(" v1.2.3-4-gabc1234");
      expect(lines[1]).toContain("ag");
      expect(lines[2]).toContain("/ws");
      expect(lines[3]).toContain("mod");
      expect(lines[4]).toContain("http://localhost:7368 (/dev)");
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
