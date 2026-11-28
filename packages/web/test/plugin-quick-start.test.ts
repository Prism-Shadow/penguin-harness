/**
 * The Plugins page's quick start for a library plugin: the demo its card declares
 * (`quickStart`), or — for a third-party plugin that declares none — its first skill
 * invoked by name; nothing for a plugin with neither. A quick start only ever writes a draft, so
 * the draft cache has to carry goal mode for a demo that is a goal.
 */
import { describe, expect, it } from "vitest";
import { libraryQuickStart, onboardingWorkbench } from "../src/features/plugins/plugin-card";
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

describe("onboardingWorkbench", () => {
  it("never matches by workbench name substring when card.onboarding is undeclared", () => {
    expect(
      onboardingWorkbench({
        workbenches: [{ name: "pet-onboarding", version: "0.0.1" }],
      }),
    ).toBeNull();
  });

  it("picks only the exact workbench named by card.onboarding even when multiple names contain onboarding", () => {
    expect(
      onboardingWorkbench({
        workbenches: [
          { name: "alpha-onboarding", version: "0.0.1" },
          { name: "beta-onboarding", version: "0.0.1" },
        ],
        onboarding: "beta-onboarding",
      }),
    ).toBe("beta-onboarding");
  });

  it("returns null when card.onboarding names a workbench the package does not ship", () => {
    expect(
      onboardingWorkbench({
        workbenches: [{ name: "pet-onboarding", version: "0.0.1" }],
        onboarding: "other",
      }),
    ).toBeNull();
  });
});
