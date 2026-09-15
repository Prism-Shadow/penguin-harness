/**
 * The plugin detail browser's tree, derived from the files endpoint's keys: one group per
 * skill in the plugin's own order with SKILL.md leading, hook scripts in one trailing group,
 * and a skill the listing did not name (a stale listing against a newer library) still gets a
 * group rather than vanishing; then the rows the shared file tree draws from those groups.
 */
import { describe, expect, it } from "vitest";
import { groupPluginFiles, pluginTreeRows } from "../src/features/plugins/plugin-detail";

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

describe("pluginTreeRows", () => {
  it("nests a file's own path segments under its group and skips a collapsed directory's children", () => {
    const groups = groupPluginFiles(
      ["skills/humanizer/SKILL.md", "skills/humanizer/reference/tells.md", "hooks/stop.mjs"],
      ["humanizer"],
      "Hooks",
    );
    expect(
      pluginTreeRows(groups, new Set()).map((r) => [r.path, r.kind, r.depth, r.expanded]),
    ).toEqual([
      ["skills/humanizer", "dir", 0, true],
      ["skills/humanizer/SKILL.md", "file", 1, false],
      ["skills/humanizer/reference", "dir", 1, true],
      ["skills/humanizer/reference/tells.md", "file", 2, false],
      ["hooks", "dir", 0, true],
      ["hooks/stop.mjs", "file", 1, false],
    ]);
    expect(
      pluginTreeRows(groups, new Set(["skills/humanizer/reference"])).map((r) => r.path),
    ).toEqual([
      "skills/humanizer",
      "skills/humanizer/SKILL.md",
      "skills/humanizer/reference",
      "hooks",
      "hooks/stop.mjs",
    ]);
  });

  it("states each row's own position among its siblings, for the flat list to announce", () => {
    const groups = groupPluginFiles(
      ["skills/a/SKILL.md", "skills/b/SKILL.md", "hooks/stop.mjs"],
      ["a", "b"],
      "Hooks",
    );
    expect(pluginTreeRows(groups, new Set()).map((r) => `${r.posInSet}/${r.setSize}`)).toEqual([
      "1/3",
      "1/1",
      "2/3",
      "1/1",
      "3/3",
      "1/1",
    ]);
  });
});
