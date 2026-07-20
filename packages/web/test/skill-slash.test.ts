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

describe("localizedText (copy selection by UI language)", () => {
  it("zh prefers the Chinese field", () => {
    expect(localizedText("zh", "Create agents", "创建 Agent")).toBe("创建 Agent");
  });

  it("zh with the Chinese value missing (undefined / empty string) falls back to English", () => {
    expect(localizedText("zh", "Create agents")).toBe("Create agents");
    expect(localizedText("zh", "Create agents", "")).toBe("Create agents");
  });

  it("en always uses English (even with a Chinese field present)", () => {
    expect(localizedText("en", "Create agents", "创建 Agent")).toBe("Create agents");
  });
});

describe("localizedShortText (short description first, falling back to the full description)", () => {
  const full = {
    description: "Create agents from requirements",
    shortDescription: "Create agents",
    shortDescriptionZh: "创建 Agent",
  };

  it("both short descriptions present: picks the short description by UI language", () => {
    expect(localizedShortText("zh", full)).toBe("创建 Agent");
    expect(localizedShortText("en", full)).toBe("Create agents");
  });

  it("zh falls back to the short English when the short Chinese is missing, then to the full English (the full description is English-only)", () => {
    expect(localizedShortText("zh", { ...full, shortDescriptionZh: undefined })).toBe(
      "Create agents",
    );
    expect(
      localizedShortText("zh", {
        description: "Create agents from requirements",
      }),
    ).toBe("Create agents from requirements");
  });

  it("en: a missing short description (including empty string) falls back to the full description", () => {
    expect(localizedShortText("en", { ...full, shortDescription: undefined })).toBe(
      "Create agents from requirements",
    );
    expect(localizedShortText("en", { ...full, shortDescription: "" })).toBe(
      "Create agents from requirements",
    );
  });
});

describe("skillSlashItems (slash skill command item assembly)", () => {
  const skills: SkillMetadataItem[] = [
    {
      name: "agent-creation",
      description: "Create agents from requirements",
      version: 1,
      updated: "2026-07-01",
    },
    { name: "penguin-sdk", description: "Develop with the Penguin SDK", version: 2, updated: "" },
  ];

  it("one item per skill: cmd is /<skill_name>, desc follows the UI language (falling back to English without a Chinese short description)", () => {
    expect(skillSlashItems(skills, "zh")).toEqual([
      { name: "agent-creation", cmd: "/agent-creation", desc: "Create agents from requirements" },
      { name: "penguin-sdk", cmd: "/penguin-sdk", desc: "Develop with the Penguin SDK" },
    ]);
    expect(skillSlashItems(skills, "en")).toEqual([
      { name: "agent-creation", cmd: "/agent-creation", desc: "Create agents from requirements" },
      { name: "penguin-sdk", cmd: "/penguin-sdk", desc: "Develop with the Penguin SDK" },
    ]);
  });

  it("an empty list yields an empty array", () => {
    expect(skillSlashItems([], "zh")).toEqual([]);
  });

  it("cmd prefix matching (slash filter convention): /agent-opt hits /agent-optimization", () => {
    const items = skillSlashItems(
      [{ name: "agent-optimization", description: "Optimize agents", version: 1, updated: "" }],
      "en",
    );
    expect(items[0]!.cmd.startsWith("/agent-opt")).toBe(true);
  });

  it("desc prefers the short description (falling back to the full one when missing)", () => {
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

describe("quickInvokeText (prefill text for skill-library quick invoke, zh/en dictionaries)", () => {
  it('same convention as the empty-body auto-invoke text: zh "使用 X 技能" / en "use the X skill"', () => {
    expect(zh.skills.quickInvokeText("agent-creation")).toBe("使用 agent-creation 技能");
    expect(en.skills.quickInvokeText("agent-creation")).toBe("use the agent-creation skill");
  });
});

describe("filterSkills (search filter for the skill dropdown)", () => {
  const skills: SkillMetadataItem[] = [
    {
      name: "agent-creation",
      description: "Create agents from requirements",
      version: 1,
      updated: "2026-07-01",
    },
    { name: "penguin-sdk", description: "Develop with the Penguin SDK", version: 2, updated: "" },
  ];

  it("an empty query (including pure whitespace) returns everything", () => {
    expect(filterSkills(skills, "zh", "")).toEqual(skills);
    expect(filterSkills(skills, "en", "   ")).toEqual(skills);
  });

  it("filters by name substring (case-insensitive): sdk leaves only penguin-sdk", () => {
    expect(filterSkills(skills, "en", "sdk").map((s) => s.name)).toEqual(["penguin-sdk"]);
    expect(filterSkills(skills, "en", "SDK").map((s) => s.name)).toEqual(["penguin-sdk"]);
  });

  it("filters by display copy: zh matches the Chinese short description, en always uses English", () => {
    const withZh = [{ ...skills[0]!, shortDescriptionZh: "把需求变成 Agent" }, skills[1]!];
    expect(filterSkills(withZh, "zh", "需求").map((s) => s.name)).toEqual(["agent-creation"]);
    expect(filterSkills(withZh, "en", "需求")).toEqual([]);
    expect(filterSkills(skills, "en", "requirements").map((s) => s.name)).toEqual([
      "agent-creation",
    ]);
  });

  it("no match yields an empty array", () => {
    expect(filterSkills(skills, "zh", "nonexistent")).toEqual([]);
  });
});

describe("skillsAutoMessage (auto-invoke text for empty-body sends, zh/en dictionaries)", () => {
  it("zh: skill names joined with 、, same wording for singular and plural", () => {
    expect(zh.chat.skillsAutoMessage(["agent-creation"])).toBe("使用 agent-creation 技能");
    expect(zh.chat.skillsAutoMessage(["a", "b"])).toBe("使用 a、b 技能");
  });

  it("en: singular use the <name> skill, plural comma-joined + skills", () => {
    expect(en.chat.skillsAutoMessage(["agent-creation"])).toBe("use the agent-creation skill");
    expect(en.chat.skillsAutoMessage(["a", "b"])).toBe("use the a, b skills");
  });
});
