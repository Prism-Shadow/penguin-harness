/**
 * agent-settings-page.tsx resolveTabKey unit tests: the settings page's `?tab=` deep link
 * narrows an untrusted query value against the live TABS keys — a known key passes through,
 * anything else (absent, empty, unknown, wrong casing) falls back to the default — pinned so
 * the validation stays dynamic and newly added tabs deep-link without a hardcoded key list.
 */
import { describe, expect, it } from "vitest";
import { resolveTabKey } from "../src/features/agents/agent-settings-page";

const TABS = [{ key: "overview" }, { key: "tools" }, { key: "vault" }] as const;

describe("resolveTabKey", () => {
  it("passes a known tab key through", () => {
    expect(resolveTabKey("tools", TABS, "overview")).toBe("tools");
    expect(resolveTabKey("vault", TABS, "overview")).toBe("vault");
  });

  it("falls back for absent, empty, unknown, or wrong-cased values", () => {
    expect(resolveTabKey(null, TABS, "overview")).toBe("overview");
    expect(resolveTabKey("", TABS, "overview")).toBe("overview");
    expect(resolveTabKey("bogus", TABS, "overview")).toBe("overview");
    expect(resolveTabKey("Tools", TABS, "overview")).toBe("overview");
  });

  it("validates against the supplied keys, not a hardcoded list", () => {
    expect(resolveTabKey("skills", [...TABS, { key: "skills" }], "overview")).toBe("skills");
  });
});
