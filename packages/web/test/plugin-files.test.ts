/**
 * The plugin detail browser's tree, derived from the files endpoint's keys: one group per
 * skill in the plugin's own order with SKILL.md leading, hook scripts in one trailing group,
 * and a skill the listing did not name (a stale listing against a newer library) still gets a
 * group rather than vanishing.
 */
import { describe, expect, it } from "vitest";
import { groupPluginFiles } from "../src/features/plugins/plugin-detail";

describe("groupPluginFiles", () => {
  it("groups skills in plugin order, SKILL.md first, then the hook scripts", () => {
    const groups = groupPluginFiles(
      [
        "skills/web-design/reference/tokens.md",
        "skills/web-design/SKILL.md",
        "hooks/stop.mjs",
        "hooks/lib.mjs",
        "skills/software-engineering/SKILL.md",
      ],
      ["software-engineering", "web-design"],
      "Hooks",
    );
    expect(groups).toEqual([
      {
        id: "skills/software-engineering",
        label: "software-engineering",
        paths: ["skills/software-engineering/SKILL.md"],
      },
      {
        id: "skills/web-design",
        label: "web-design",
        paths: ["skills/web-design/SKILL.md", "skills/web-design/reference/tokens.md"],
      },
      { id: "hooks", label: "Hooks", paths: ["hooks/lib.mjs", "hooks/stop.mjs"] },
    ]);
  });

  it("keeps a skill the listing does not name, after the named ones, and omits an empty hooks group", () => {
    const groups = groupPluginFiles(
      ["skills/extra/SKILL.md", "skills/known/SKILL.md"],
      ["known"],
      "Hooks",
    );
    expect(groups.map((g) => g.id)).toEqual(["skills/known", "skills/extra"]);
  });
});
