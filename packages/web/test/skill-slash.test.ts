/**
 * Skill UI-language text and slash command assembly (pure functions shared by
 * chat-input and the skill library page):
 * - localizedText: uses the Chinese value when locale is zh and it's non-empty, otherwise
 *   falls back to English (an empty-string Chinese value counts as missing);
 * - localizedShortText: prefers the short description (language takes priority over
 *   length), falling back to the full description when missing;
 * - skillSlashItems: installed skills -> `/<skill_name>` command items, preferring the
 *   short description in the UI language;
 * - filterSkills: search filter for the skill dropdown (matches name and localized
 *   description, case-insensitive);
 * - skillsAutoMessage / quickInvokeText: auto-invoke text and quick-invoke prefill text
 *   (zh/en dictionaries).
 */
import { describe, expect, it } from "vitest";
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";
import {
  filterSkills,
  localizedShortText,
  localizedText,
  skillSlashItems,
} from "../src/features/chat/skill-use";
import { zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("localizedText（界面语言取文案）", () => {
  it("zh 优先中文字段", () => {
    expect(localizedText("zh", "Create agents", "创建 Agent")).toBe("创建 Agent");
  });

  it("zh 但中文缺省（undefined / 空串）回退英文", () => {
    expect(localizedText("zh", "Create agents")).toBe("Create agents");
    expect(localizedText("zh", "Create agents", "")).toBe("Create agents");
  });

  it("en 恒用英文（即使有中文字段）", () => {
    expect(localizedText("en", "Create agents", "创建 Agent")).toBe("Create agents");
  });
});

describe("localizedShortText（短描述优先，缺失回退完整描述）", () => {
  const full = {
    description: "Create agents from requirements",
    shortDescription: "Create agents",
    shortDescriptionZh: "创建 Agent",
  };

  it("双语短描述齐全：按界面语言取短描述", () => {
    expect(localizedShortText("zh", full)).toBe("创建 Agent");
    expect(localizedShortText("en", full)).toBe("Create agents");
  });

  it("zh 短中文缺失时回退短英文，再回退完整英文（完整描述仅英文）", () => {
    expect(localizedShortText("zh", { ...full, shortDescriptionZh: undefined })).toBe(
      "Create agents",
    );
    expect(
      localizedShortText("zh", {
        description: "Create agents from requirements",
      }),
    ).toBe("Create agents from requirements");
  });

  it("en：短描述缺失（含空串）回退完整描述", () => {
    expect(localizedShortText("en", { ...full, shortDescription: undefined })).toBe(
      "Create agents from requirements",
    );
    expect(localizedShortText("en", { ...full, shortDescription: "" })).toBe(
      "Create agents from requirements",
    );
  });
});

describe("skillSlashItems（slash 技能命令项组装）", () => {
  const skills: SkillMetadataItem[] = [
    {
      name: "agent-creation",
      description: "Create agents from requirements",
      version: 1,
      updated: "2026-07-01",
    },
    { name: "penguin-sdk", description: "Develop with the Penguin SDK", version: 2, updated: "" },
  ];

  it("每个技能一项：cmd 为 /<skill_name>，desc 按界面语言（无中文短描述回退英文）", () => {
    expect(skillSlashItems(skills, "zh")).toEqual([
      { name: "agent-creation", cmd: "/agent-creation", desc: "Create agents from requirements" },
      { name: "penguin-sdk", cmd: "/penguin-sdk", desc: "Develop with the Penguin SDK" },
    ]);
    expect(skillSlashItems(skills, "en")).toEqual([
      { name: "agent-creation", cmd: "/agent-creation", desc: "Create agents from requirements" },
      { name: "penguin-sdk", cmd: "/penguin-sdk", desc: "Develop with the Penguin SDK" },
    ]);
  });

  it("空列表给空数组", () => {
    expect(skillSlashItems([], "zh")).toEqual([]);
  });

  it("cmd 前缀匹配（slash 过滤口径）：/agent-opt 命中 /agent-optimization", () => {
    const items = skillSlashItems(
      [{ name: "agent-optimization", description: "Optimize agents", version: 1, updated: "" }],
      "en",
    );
    expect(items[0]!.cmd.startsWith("/agent-opt")).toBe(true);
  });

  it("desc 短描述优先（缺失回退完整描述）", () => {
    const withShort: SkillMetadataItem[] = [
      {
        name: "agent-creation",
        description: "Create agents from requirements",
        shortDescription: "Create agents",
        shortDescriptionZh: "创建 Agent",
        version: 1,
        updated: "",
      },
    ];
    expect(skillSlashItems(withShort, "zh")[0]!.desc).toBe("创建 Agent");
    expect(skillSlashItems(withShort, "en")[0]!.desc).toBe("Create agents");
  });
});

describe("quickInvokeText（技能库快捷调用的预填文本，zh/en 字典）", () => {
  it("与空正文自动调用文本同口径：zh「使用 X 技能」/ en「use the X skill」", () => {
    expect(zh.skills.quickInvokeText("agent-creation")).toBe("使用 agent-creation 技能");
    expect(en.skills.quickInvokeText("agent-creation")).toBe("use the agent-creation skill");
  });
});

describe("filterSkills（技能下拉的搜索过滤）", () => {
  const skills: SkillMetadataItem[] = [
    {
      name: "agent-creation",
      description: "Create agents from requirements",
      version: 1,
      updated: "2026-07-01",
    },
    { name: "penguin-sdk", description: "Develop with the Penguin SDK", version: 2, updated: "" },
  ];

  it("空查询（含纯空白）返回全量", () => {
    expect(filterSkills(skills, "zh", "")).toEqual(skills);
    expect(filterSkills(skills, "en", "   ")).toEqual(skills);
  });

  it("按 name 子串过滤（大小写不敏感）：sdk 只剩 penguin-sdk", () => {
    expect(filterSkills(skills, "en", "sdk").map((s) => s.name)).toEqual(["penguin-sdk"]);
    expect(filterSkills(skills, "en", "SDK").map((s) => s.name)).toEqual(["penguin-sdk"]);
  });

  it("按显示文案过滤：zh 命中中文短描述，en 恒用英文", () => {
    const withZh = [{ ...skills[0]!, shortDescriptionZh: "把需求变成 Agent" }, skills[1]!];
    expect(filterSkills(withZh, "zh", "需求").map((s) => s.name)).toEqual(["agent-creation"]);
    expect(filterSkills(withZh, "en", "需求")).toEqual([]);
    expect(filterSkills(skills, "en", "requirements").map((s) => s.name)).toEqual([
      "agent-creation",
    ]);
  });

  it("无匹配给空数组", () => {
    expect(filterSkills(skills, "zh", "nonexistent")).toEqual([]);
  });
});

describe("skillsAutoMessage（空正文发送的自动调用文本，zh/en 字典）", () => {
  it("zh：技能名以「、」相连，单复数同款", () => {
    expect(zh.chat.skillsAutoMessage(["agent-creation"])).toBe("使用 agent-creation 技能");
    expect(zh.chat.skillsAutoMessage(["a", "b"])).toBe("使用 a、b 技能");
  });

  it("en：单数 use the <name> skill、复数逗号相连 + skills", () => {
    expect(en.chat.skillsAutoMessage(["agent-creation"])).toBe("use the agent-creation skill");
    expect(en.chat.skillsAutoMessage(["a", "b"])).toBe("use the a, b skills");
  });
});
