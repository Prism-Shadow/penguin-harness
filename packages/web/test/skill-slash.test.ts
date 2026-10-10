/**
 * Skills in the composer and the skill library (features/chat/skill-use.ts and the
 * dictionaries' skill messages).
 *
 * - A skill's text follows the UI language: zh uses the Chinese value when it is non-empty,
 *   otherwise English; en always English. The short description wins over the full one, the
 *   language over the length.
 * - Every installed skill becomes a `/<name>` command described in the UI language; no skills,
 *   no commands.
 * - The skill dropdown's search matches the name and the localized description,
 *   case-insensitively; an empty query lists everything and no match lists nothing.
 * - The skill library's quick invoke prefills exactly the auto-invoke text an empty-body send
 *   uses, which names the picked skills in the UI language.
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
      name: "agent-initialization",
      description: "Create agents from requirements",
      version: "2026.07.01.1",
    },
    { name: "penguin-sdk", description: "Develop with the Penguin SDK", version: "" },
  ];

  it("one item per skill: cmd is /<skill_name>, desc follows the UI language (falling back to English without a Chinese short description)", () => {
    expect(skillSlashItems(skills, "zh")).toEqual([
      {
        name: "agent-initialization",
        cmd: "/agent-initialization",
        desc: "Create agents from requirements",
      },
      { name: "penguin-sdk", cmd: "/penguin-sdk", desc: "Develop with the Penguin SDK" },
    ]);
    expect(skillSlashItems(skills, "en")).toEqual([
      {
        name: "agent-initialization",
        cmd: "/agent-initialization",
        desc: "Create agents from requirements",
      },
      { name: "penguin-sdk", cmd: "/penguin-sdk", desc: "Develop with the Penguin SDK" },
    ]);
  });

  it("an empty list yields an empty array", () => {
    expect(skillSlashItems([], "zh")).toEqual([]);
  });

  it("desc prefers the short description (falling back to the full one when missing)", () => {
    const withShort: SkillMetadataItem[] = [
      {
        name: "agent-initialization",
        description: "Create agents from requirements",
        shortDescription: "Create agents",
        shortDescriptionZh: "创建 Agent",
        version: "2026.07.01.1",
      },
    ];
    expect(skillSlashItems(withShort, "zh")[0]!.desc).toBe("创建 Agent");
    expect(skillSlashItems(withShort, "en")[0]!.desc).toBe("Create agents");
  });
});

describe("quickInvokeText (prefill text for skill-library quick invoke, zh/en dictionaries)", () => {
  it("reads exactly as the empty-body auto-invoke text for the same single skill", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      expect(dict.skills.quickInvokeText("agent-initialization"), locale).toBe(
        dict.chat.skillsAutoMessage(["agent-initialization"]),
      );
    }
  });
});

describe("filterSkills (search filter for the skill dropdown)", () => {
  const skills: SkillMetadataItem[] = [
    {
      name: "agent-initialization",
      description: "Create agents from requirements",
      version: "2026.07.01.1",
    },
    { name: "penguin-sdk", description: "Develop with the Penguin SDK", version: "" },
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
    expect(filterSkills(withZh, "zh", "需求").map((s) => s.name)).toEqual(["agent-initialization"]);
    expect(filterSkills(withZh, "en", "需求")).toEqual([]);
    expect(filterSkills(skills, "en", "requirements").map((s) => s.name)).toEqual([
      "agent-initialization",
    ]);
  });

  it("no match yields an empty array", () => {
    expect(filterSkills(skills, "zh", "nonexistent")).toEqual([]);
  });
});

describe("skillsAutoMessage (auto-invoke text for empty-body sends, zh/en dictionaries)", () => {
  it("zh: skill names joined with 、, same wording for singular and plural", () => {
    expect(zh.chat.skillsAutoMessage(["agent-initialization"])).toBe(
      "使用 agent-initialization 技能",
    );
    expect(zh.chat.skillsAutoMessage(["a", "b"])).toBe("使用 a、b 技能");
  });

  it("en: singular use the <name> skill, plural comma-joined + skills", () => {
    expect(en.chat.skillsAutoMessage(["agent-initialization"])).toBe(
      "use the agent-initialization skill",
    );
    expect(en.chat.skillsAutoMessage(["a", "b"])).toBe("use the a, b skills");
  });
});
