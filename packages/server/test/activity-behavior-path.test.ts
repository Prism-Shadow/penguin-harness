import { describe, expect, it } from "vitest";
import {
  behaviorPath,
  implementationSkills,
  missingSkills,
  usesAssessment,
} from "../src/activities/behavior-path.js";

describe("which path a module is on", () => {
  it("is the state machine for a module with an index", () => {
    expect(behaviorPath({ hasSequenceJs: false, hasIndexTs: true })).toBe("machine");
  });

  it("is the sequence path for a module with only sequence.js", () => {
    // 299 of the 303 implemented modules in the real checkout look like this.
    expect(behaviorPath({ hasSequenceJs: true, hasIndexTs: false })).toBe("sequence");
  });

  it("treats a module part-way through migration as the state machine", () => {
    // Both files present means the code has already moved; handing the agent the old
    // contract would be handing it the wrong one.
    expect(behaviorPath({ hasSequenceJs: true, hasIndexTs: true })).toBe("machine");
  });

  it("is the state machine for a fresh module with neither file yet", () => {
    expect(behaviorPath({ hasSequenceJs: false, hasIndexTs: false })).toBe("machine");
  });

  it("lets an explicit scaffold override force the old path", () => {
    expect(behaviorPath({ hasSequenceJs: false, hasIndexTs: true, overridesSequence: true })).toBe(
      "sequence",
    );
  });
});

describe("the skills an implementation run reads", () => {
  it("opens with the framework overview, which makes the rest legible", () => {
    expect(implementationSkills("machine")[0]).toBe("project-documentation");
    expect(implementationSkills("sequence")[0]).toBe("project-documentation");
  });

  it("puts the behaviour skill second, as Loom does", () => {
    expect(implementationSkills("sequence")[1]).toBe("waf-sequence-from-prose");
    expect(implementationSkills("machine")[1]).toBe("waf-state-machine");
  });

  it("gives the sequence path its own pattern skills and not the machine's", () => {
    const skills = implementationSkills("sequence");
    expect(skills).toContain("waf-sequence-implementation-patterns");
    expect(skills).not.toContain("xstate-v5");
  });

  it("gives the sequence path the layout catalogue, after the guardrails it defers to", () => {
    const skills = implementationSkills("sequence");
    expect(skills.indexOf("waf-layout-patterns")).toBeGreaterThan(
      skills.indexOf("waf-style-guardrails"),
    );
    expect(implementationSkills("machine")).not.toContain("waf-layout-patterns");
  });

  it("gives the machine path XState and not the sequence patterns", () => {
    const skills = implementationSkills("machine");
    expect(skills).toContain("xstate-v5");
    expect(skills).not.toContain("waf-sequence-implementation-patterns");
  });

  it("carries the shared pattern skills on both paths", () => {
    for (const path of ["sequence", "machine"] as const) {
      const skills = implementationSkills(path);
      for (const shared of [
        "waf-activity-states",
        "waf-element-ids",
        "waf-asset-usage-patterns",
        "waf-style-guardrails",
        "waf-audio-patterns",
        "waf-video-patterns",
      ])
        expect(skills, `${path}/${shared}`).toContain(shared);
    }
  });

  it("swaps the behaviour skill for the assessment one when the activity is assessed", () => {
    expect(implementationSkills("sequence", { usesAssessment: true })[1]).toBe(
      "waf-assessment-patterns",
    );
    expect(implementationSkills("machine", { usesAssessment: true })[1]).toBe(
      "waf-assessment-patterns",
    );
  });

  it("keeps the state machine contract for an assessed machine activity", () => {
    // It is in the machine path's shared list, so swapping the behaviour skill loses
    // nothing.
    expect(implementationSkills("machine", { usesAssessment: true })).toContain(
      "waf-state-machine",
    );
  });

  it("drops the prose skill for an assessed sequence activity", () => {
    expect(implementationSkills("sequence", { usesAssessment: true })).not.toContain(
      "waf-sequence-from-prose",
    );
  });

  it("appends extras and never repeats a skill", () => {
    const skills = implementationSkills("machine", {
      extra: ["waf-book-generation", "project-documentation"],
    });
    expect(skills).toContain("waf-book-generation");
    expect(skills.filter((name) => name === "project-documentation")).toHaveLength(1);
    expect(new Set(skills).size).toBe(skills.length);
  });

  it("never repeats the state machine skill, which is both behaviour and shared", () => {
    const skills = implementationSkills("machine");
    expect(skills.filter((name) => name === "waf-state-machine")).toHaveLength(1);
  });
});

describe("reading the assessment flag", () => {
  it("is set only by an explicit true", () => {
    expect(usesAssessment({ runtime: { usesAssessment: true } })).toBe(true);
    expect(usesAssessment({ runtime: { usesAssessment: false } })).toBe(false);
    expect(usesAssessment({ runtime: { usesAssessment: "yes" } })).toBe(false);
  });

  it("survives a missing or malformed runtime block", () => {
    expect(usesAssessment({})).toBe(false);
    expect(usesAssessment(null)).toBe(false);
    expect(usesAssessment({ runtime: [] })).toBe(false);
    expect(usesAssessment({ runtime: "html" })).toBe(false);
  });
});

describe("skills that are not there", () => {
  it("names what is missing rather than proceeding without it", () => {
    // A run without the state-machine contract writes code against an API the agent had
    // to guess at, and the failure looks like a broken activity, not a missing skill.
    expect(missingSkills(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
  });

  it("says nothing when everything wanted is available", () => {
    expect(missingSkills(["a"], ["a", "b"])).toEqual([]);
  });

  it("reports the whole machine path against an empty library", () => {
    const wanted = implementationSkills("machine");
    expect(missingSkills(wanted, [])).toEqual(wanted);
  });
});
