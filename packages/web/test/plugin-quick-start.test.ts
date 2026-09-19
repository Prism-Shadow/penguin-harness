/**
 * The Plugins page's quick start for a library plugin: the demo its plugin.json declares, or —
 * for a third-party plugin that declares none — its first skill invoked by name; nothing for a
 * plugin with neither. A quick start only ever writes a draft, so the draft cache has to carry
 * goal mode for a demo that is a goal.
 */
import { describe, expect, it } from "vitest";
import { libraryQuickStart } from "../src/features/plugins/plugins-page";
import { draftFromUnknown } from "../src/features/chat/draft-cache";

const skill = (name: string) => ({ name, description: "", version: "2026.08.01.1" });

describe("libraryQuickStart", () => {
  it("uses the declared demo as is", () => {
    const quickStart = { prompt: "Do it", promptZh: "做吧", skills: ["a"], goal: true };
    expect(libraryQuickStart({ skills: [skill("a")], quickStart })).toBe(quickStart);
  });

  it("falls back to the first skill, and to nothing without one", () => {
    expect(libraryQuickStart({ skills: [skill("first"), skill("second")] })).toMatchObject({
      skills: ["first"],
    });
    expect(libraryQuickStart({ skills: [] })).toBeNull();
  });
});

describe("draftFromUnknown", () => {
  it("keeps goal mode only as a literal true", () => {
    expect(draftFromUnknown({ text: "x", goal: true })).toEqual({ text: "x", goal: true });
    expect(draftFromUnknown({ text: "x", goal: "yes" })).toEqual({ text: "x" });
  });
});
