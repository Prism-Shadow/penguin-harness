/**
 * The import dialog's decisions (features/builtin-browser/import-options.ts): profiles grouped
 * under their browser, the "only these sites" field as the request sends it, the macOS
 * Keychain note, and the request the chosen options make.
 */
import { describe, expect, it } from "vitest";
import type { BuiltinBrowserImportSource } from "@prismshadow/penguin-server/api";
import {
  groupSources,
  importRequest,
  keychainPromptLikely,
  parseDomainFilter,
  sourceImportable,
} from "../src/features/builtin-browser/import-options";

function source(
  id: string,
  over: Partial<BuiltinBrowserImportSource> = {},
): BuiltinBrowserImportSource {
  const [browser = "chrome", profile = "Default"] = id.split(":");
  return {
    id,
    browser: browser as BuiltinBrowserImportSource["browser"],
    browserName: browser === "firefox" ? "Firefox" : "Google Chrome",
    profile,
    profileName: profile,
    hasCookies: true,
    hasHistory: true,
    ...over,
  };
}

describe("groupSources", () => {
  it("groups profiles under their browser, in the order the server listed them", () => {
    const groups = groupSources([
      source("chrome:Default"),
      source("firefox:abc.default-release"),
      source("chrome:Profile 1"),
    ]);
    expect(groups.map((g) => g.browserName)).toEqual(["Google Chrome", "Firefox"]);
    expect(groups[0]?.sources.map((s) => s.profile)).toEqual(["Default", "Profile 1"]);
  });

  it("offers a profile only when it holds something to import", () => {
    expect(sourceImportable(source("chrome:Default", { hasCookies: false }))).toBe(true);
    expect(sourceImportable(source("chrome:Empty", { hasCookies: false, hasHistory: false }))).toBe(
      false,
    );
  });
});

describe("parseDomainFilter", () => {
  it("imports every site when the field is empty", () => {
    expect(parseDomainFilter("")).toBeUndefined();
    expect(parseDomainFilter(" ,  , ")).toBeUndefined();
  });

  it("splits on commas, semicolons and spaces, full-width ones included", () => {
    expect(parseDomainFilter("amazon.com, github.com;example.org  news.ycombinator.com")).toEqual([
      "amazon.com",
      "github.com",
      "example.org",
      "news.ycombinator.com",
    ]);
    expect(parseDomainFilter("taobao.com，jd.com；tmall.com")).toEqual([
      "taobao.com",
      "jd.com",
      "tmall.com",
    ]);
  });

  it("keeps only the host of a pasted address, without www., and once", () => {
    expect(
      parseDomainFilter(
        "https://www.Amazon.com/your-orders?x=1, WWW.amazon.com, .github.com:443, *.example.org.",
      ),
    ).toEqual(["amazon.com", "github.com", "example.org"]);
  });
});

describe("keychainPromptLikely", () => {
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
  const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

  it("warns on macOS for every Chromium-family browser, and never for Firefox", () => {
    expect(keychainPromptLikely(mac, "chrome")).toBe(true);
    expect(keychainPromptLikely(mac, "arc")).toBe(true);
    expect(keychainPromptLikely(mac, "firefox")).toBe(false);
    expect(keychainPromptLikely(windows, "chrome")).toBe(false);
  });
});

describe("importRequest", () => {
  const chrome = source("chrome:Default");

  it("asks for what is chosen, with the site filter on the cookies", () => {
    expect(
      importRequest(chrome, { cookies: true, history: true, domains: "www.amazon.com" }),
    ).toEqual({
      sourceId: "chrome:Default",
      cookies: true,
      history: true,
      domains: ["amazon.com"],
    });
    expect(importRequest(chrome, { cookies: true, history: false, domains: "" })).toEqual({
      sourceId: "chrome:Default",
      cookies: true,
      history: false,
    });
  });

  it("drops the site filter when no cookies are imported", () => {
    expect(importRequest(chrome, { cookies: false, history: true, domains: "amazon.com" })).toEqual(
      { sourceId: "chrome:Default", cookies: false, history: true },
    );
  });

  it("does not ask for data the profile does not have", () => {
    const noHistory = source("chrome:Work", { hasHistory: false });
    expect(importRequest(noHistory, { cookies: true, history: true, domains: "" })).toEqual({
      sourceId: "chrome:Work",
      cookies: true,
      history: false,
    });
  });

  it("makes no request with no source, or nothing chosen", () => {
    expect(importRequest(null, { cookies: true, history: true, domains: "" })).toBeNull();
    expect(importRequest(chrome, { cookies: false, history: false, domains: "" })).toBeNull();
  });
});
