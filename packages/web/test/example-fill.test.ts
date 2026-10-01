/**
 * What clicking a draft-screen example puts in the composer (features/chat/example-fill.ts).
 * The click fills the composer and sends nothing, so pressing Send yields exactly the message
 * the card used to submit itself.
 *
 * - The text body becomes the plain prompt, verbatim, replacing whatever was there — never a
 *   `[use_skills]` block, which the send path builds and a user cannot sensibly edit.
 * - The example's skills join the selection when the Agent has them installed, without
 *   duplicates; an example that pins nothing leaves the selection as it was.
 */
import { describe, expect, it } from "vitest";
import { buildExampleFill } from "../src/features/chat/example-fill";
import { buildSkillsMessage } from "../src/features/chat/skill-use";

const PROMPT = "Build a cute penguin sledding game.";

const fill = (over: Partial<Parameters<typeof buildExampleFill>[0]> = {}) =>
  buildExampleFill({
    prompt: PROMPT,
    exampleSkills: [],
    installedSkills: [],
    selectedSkills: [],
    ...over,
  });

describe("buildExampleFill — what lands in the text body", () => {
  it("is exactly the example's prompt, newlines and all", () => {
    expect(fill().text).toBe(PROMPT);
    const multiline = "Line one.\n\n- a list item\n- another";
    expect(fill({ prompt: multiline }).text).toBe(multiline);
  });

  it("never writes the [use_skills] block into the textarea", () => {
    // The composer wraps the selection at send time; wrapping here would both double it up and
    // leave a marker block in a box the user is meant to edit.
    const f = fill({ exampleSkills: ["web-design"], installedSkills: ["web-design"] });
    expect(f.text).toBe(PROMPT);
    expect(f.text).not.toContain("use_skills");
    expect(f.text).not.toBe(buildSkillsMessage(["web-design"], PROMPT));
  });
});

describe("buildExampleFill — what lands in the skills dropdown", () => {
  it("preselects the example's skills", () => {
    expect(fill({ exampleSkills: ["web-design"], installedSkills: ["web-design"] }).skills).toEqual(
      ["web-design"],
    );
  });

  it("drops skills the selected Agent has not installed", () => {
    // Pinning a Skill that isn't there is what the old auto-submit filtered out too.
    const f = fill({
      exampleSkills: ["penguin-sdk", "web-design"],
      installedSkills: ["web-design"],
    });
    expect(f.skills).toEqual(["web-design"]);
  });

  it("joins the existing selection instead of replacing it, without duplicating", () => {
    const f = fill({
      exampleSkills: ["penguin-sdk", "web-design"],
      installedSkills: ["penguin-sdk", "web-design", "memory"],
      selectedSkills: ["memory", "web-design"],
    });
    expect(f.skills).toEqual(["memory", "web-design", "penguin-sdk"]);
  });

  it("leaves the selection untouched for an example that pins nothing", () => {
    const selectedSkills = ["memory"];
    expect(fill({ selectedSkills, installedSkills: selectedSkills }).skills).toEqual(["memory"]);
  });
});
