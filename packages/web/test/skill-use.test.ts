/**
 * skill-use.ts unit tests: building and reverse-parsing the `<use_skills>`
 * block (global convention format) —
 * round-trip consistency, an empty skill list omits the block, and only a
 * block at the start of the message is recognized.
 */
import { describe, expect, it } from "vitest";
import { buildSkillsMessage, parseSkillsMessage } from "../src/features/chat/skill-use";

describe("buildSkillsMessage（<use_skills> 块 + 正文）", () => {
  it("单技能：块（首行标签、次行 skills:、闭合标签）+ 空行 + 正文", () => {
    expect(buildSkillsMessage(["penguin-sdk"], "帮我写个 demo")).toBe(
      "<use_skills>\nskills: penguin-sdk\n</use_skills>\n\n帮我写个 demo",
    );
  });

  it("多技能：skills: 行逗号 + 空格分隔", () => {
    expect(buildSkillsMessage(["agent-creation", "penguin-cli"], "x")).toBe(
      "<use_skills>\nskills: agent-creation, penguin-cli\n</use_skills>\n\nx",
    );
  });

  it("空名单不包块：原样返回正文", () => {
    expect(buildSkillsMessage([], "hello")).toBe("hello");
    expect(buildSkillsMessage([], "")).toBe("");
  });

  it("无正文时只有块，无尾随空行", () => {
    expect(buildSkillsMessage(["solo"], "")).toBe("<use_skills>\nskills: solo\n</use_skills>");
  });
});

describe("parseSkillsMessage（逆向解析，驱动「使用技能」横幅）", () => {
  it("与 build 往返一致（多技能、多行正文）", () => {
    const text = buildSkillsMessage(["agent-creation", "penguin-cli"], "use them\nline2");
    expect(parseSkillsMessage(text)).toEqual({
      skills: ["agent-creation", "penguin-cli"],
      rest: "use them\nline2",
    });
  });

  it("正文含 < 字符（含尖括号标签样式的文本）不受影响", () => {
    const body = "compare a < b and keep <tag> markers\n<use_skills> 字样也只是正文";
    expect(parseSkillsMessage(buildSkillsMessage(["x-skill"], body))).toEqual({
      skills: ["x-skill"],
      rest: body,
    });
  });

  it("只含块无正文：rest 为空串", () => {
    expect(parseSkillsMessage("<use_skills>\nskills: solo\n</use_skills>")).toEqual({
      skills: ["solo"],
      rest: "",
    });
  });

  it("块不在消息开头（前置正文/空白）不解析；普通消息不解析", () => {
    const block = buildSkillsMessage(["a"], "b");
    expect(parseSkillsMessage(`hi\n${block}`)).toBeNull();
    expect(parseSkillsMessage(` ${block}`)).toBeNull();
    expect(parseSkillsMessage("plain text mentioning <use_skills> only")).toBeNull();
  });

  it("skills: 行为空白视为非来源块", () => {
    expect(parseSkillsMessage("<use_skills>\nskills:  \n</use_skills>\n\nbody")).toBeNull();
    expect(parseSkillsMessage("<use_skills>\nskills: , ,\n</use_skills>")).toBeNull();
  });
});
