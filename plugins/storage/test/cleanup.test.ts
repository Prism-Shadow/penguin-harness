import { describe, expect, it } from "vitest";
import { isWorkspaceHeld } from "../src/server/cleanup.js";

describe("isWorkspaceHeld", () => {
  it("matches Windows paths case-insensitively while preserving segment boundaries", () => {
    const forms = ["E:\\data\\projects\\p1\\agents\\a1\\workspaces\\tmp-1"];
    const holders = [
      "E:\\data\\projects\\p1\\agents\\a1",
      "E:\\data\\projects\\p1\\agents\\a1\\workspaces",
    ];

    expect(
      isWorkspaceHeld(
        forms,
        holders,
        ["e:\\data\\projects\\p1\\agents\\a1\\WorkSpaces\\TMP-1"],
        "win32",
      ),
    ).toBe(true);
    expect(
      isWorkspaceHeld(
        forms,
        holders,
        ["e:\\data\\projects\\p1\\agents\\a1\\workspaces\\tmp-1\\nested\\sub"],
        "win32",
      ),
    ).toBe(true);
    expect(
      isWorkspaceHeld(forms, holders, ["e:\\data\\projects\\p1\\agents\\a1\\WorkSpaces"], "win32"),
    ).toBe(true);
    expect(
      isWorkspaceHeld(
        forms,
        holders,
        ["e:\\data\\projects\\p1\\agents\\a1\\workspaces\\tmp-10"],
        "win32",
      ),
    ).toBe(false);
  });

  it("keeps POSIX path comparisons case-sensitive", () => {
    const forms = ["/data/projects/p1/agents/a1/workspaces/tmp-1"];
    const holders = ["/data/projects/p1/agents/a1", "/data/projects/p1/agents/a1/workspaces"];

    expect(
      isWorkspaceHeld(forms, holders, ["/data/projects/p1/agents/a1/workspaces/tmp-1"], "linux"),
    ).toBe(true);
    expect(
      isWorkspaceHeld(
        forms,
        holders,
        ["/data/projects/p1/agents/a1/workspaces/tmp-1/nested"],
        "linux",
      ),
    ).toBe(true);
    expect(
      isWorkspaceHeld(forms, holders, ["/data/projects/p1/agents/a1/workspaces"], "linux"),
    ).toBe(true);
    expect(
      isWorkspaceHeld(forms, holders, ["/data/projects/p1/agents/a1/workspaces/TMP-1"], "linux"),
    ).toBe(false);
    expect(
      isWorkspaceHeld(forms, holders, ["/data/projects/p1/agents/a1/workspaces/tmp-10"], "linux"),
    ).toBe(false);
    expect(isWorkspaceHeld(["/data/ws/"], [], ["/data/ws/child"], "linux")).toBe(true);
  });
});
