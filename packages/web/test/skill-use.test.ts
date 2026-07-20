/**
 * skill-use.ts unit tests: building and reverse-parsing the `<use_skills>`
 * block (global convention format) —
 * round-trip consistency, an empty skill list omits the block, and only a
 * block at the start of the message is recognized.
 */
import { describe, expect, it } from "vitest";
import { buildSkillsMessage, parseSkillsMessage } from "../src/features/chat/skill-use";

describe("buildSkillsMessage (<use_skills> block + body)", () => {
  it("single skill: block (tag line, skills: line, closing tag) + blank line + body", () => {
    expect(buildSkillsMessage(["penguin-sdk"], "write me a demo")).toBe(
      "<use_skills>\nskills: penguin-sdk\n</use_skills>\n\nwrite me a demo",
    );
  });

  it("multiple skills: the skills: line is comma + space separated", () => {
    expect(buildSkillsMessage(["agent-creation", "penguin-cli"], "x")).toBe(
      "<use_skills>\nskills: agent-creation, penguin-cli\n</use_skills>\n\nx",
    );
  });

  it("an empty list adds no block: the body returns unchanged", () => {
    expect(buildSkillsMessage([], "hello")).toBe("hello");
    expect(buildSkillsMessage([], "")).toBe("");
  });

  it("block only without a body, no trailing blank line", () => {
    expect(buildSkillsMessage(["solo"], "")).toBe("<use_skills>\nskills: solo\n</use_skills>");
  });
});

describe("parseSkillsMessage (reverse parsing, driving the use-skills banner)", () => {
  it("round-trips with build (multiple skills, multi-line body)", () => {
    const text = buildSkillsMessage(["agent-creation", "penguin-cli"], "use them\nline2");
    expect(parseSkillsMessage(text)).toEqual({
      skills: ["agent-creation", "penguin-cli"],
      rest: "use them\nline2",
    });
  });

  it("a body containing < characters (including tag-like text) is unaffected", () => {
    const body =
      "compare a < b and keep <tag> markers\n<use_skills> appearing here is still just body text";
    expect(parseSkillsMessage(buildSkillsMessage(["x-skill"], body))).toEqual({
      skills: ["x-skill"],
      rest: body,
    });
  });

  it("block only, no body: rest is an empty string", () => {
    expect(parseSkillsMessage("<use_skills>\nskills: solo\n</use_skills>")).toEqual({
      skills: ["solo"],
      rest: "",
    });
  });

  it("a block not at the start of the message (preceding body/whitespace) does not parse; plain messages do not parse", () => {
    const block = buildSkillsMessage(["a"], "b");
    expect(parseSkillsMessage(`hi\n${block}`)).toBeNull();
    expect(parseSkillsMessage(` ${block}`)).toBeNull();
    expect(parseSkillsMessage("plain text mentioning <use_skills> only")).toBeNull();
  });

  it("a blank skills: line means it is not a skills block", () => {
    expect(parseSkillsMessage("<use_skills>\nskills:  \n</use_skills>\n\nbody")).toBeNull();
    expect(parseSkillsMessage("<use_skills>\nskills: , ,\n</use_skills>")).toBeNull();
  });
});
