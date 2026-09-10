/**
 * org-examples.ts: the three example missions offered under the create-organization
 * dialog's mission field. The registry holds ids only and the chips are rendered from them,
 * so an id with no entry in one of the dictionaries would render a blank chip rather than
 * fail to compile — which is what this covers.
 */
import { describe, expect, it } from "vitest";
import { ORG_EXAMPLES } from "../src/features/company/org-examples";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("organization mission examples", () => {
  it("lists the three in their rendered order, each id once", () => {
    const ids = ORG_EXAMPLES.map((example) => example.id);
    expect(ids).toEqual(["research", "agentTuning", "cloudReseller"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every example a name and a mission in both dictionaries", () => {
    for (const dict of [zh, en]) {
      for (const { id } of ORG_EXAMPLES) {
        const copy = dict.company.missionExamples[id];
        expect(copy.name).not.toBe("");
        // The mission is what a click fills; the name is only the chip's one-line label, so
        // a "mission" no longer than its own name is a copy mistake.
        expect(copy.mission.length).toBeGreaterThan(copy.name.length);
      }
    }
  });

  it("keeps the names distinct, so three chips never read as one", () => {
    for (const dict of [zh, en]) {
      const names = ORG_EXAMPLES.map(({ id }) => dict.company.missionExamples[id].name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
