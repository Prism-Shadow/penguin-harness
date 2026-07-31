/**
 * memory-tab.tsx pure helpers: the index rewrites that follow a topic file's rename or delete,
 * the group-heading lookup that decides where the index opens, and the frontmatter check run
 * before a topic file is saved.
 *
 * The index is prose the model wrote, so the rewrites are pinned to the exact Markdown link
 * form `](<workspaceKey>/<file>)` — a mention of the file name in ordinary text, or an entry
 * belonging to another Workspace, must survive both operations untouched.
 */
import { describe, expect, it } from "vitest";
import type { MemoryFileInfo } from "@prismshadow/penguin-server/api";
import {
  fileListState,
  frontmatterProblem,
  headingOffset,
  indexWithRenamedFile,
  indexWithoutFile,
} from "../src/features/agents/memory-tab";

const KEY = "my-app-a81f32c4";
const OTHER = "site-c29b110e";

const INDEX = [
  "# Memory",
  "",
  `## ${KEY}`,
  "",
  `- [Testing](${KEY}/feedback_testing.md) — how tests run`,
  `- [Release](${KEY}/project_release.md) — release windows`,
  "",
  `## ${OTHER}`,
  "",
  `- [Testing](${OTHER}/feedback_testing.md) — that workspace's own testing note`,
].join("\n");

describe("indexWithoutFile", () => {
  it("drops only the deleted file's line, in its own Workspace group", () => {
    const next = indexWithoutFile(INDEX, KEY, "feedback_testing.md");
    expect(next).not.toContain(`${KEY}/feedback_testing.md`);
    // The same file name under another Workspace is a different memory and stays.
    expect(next).toContain(`${OTHER}/feedback_testing.md`);
    expect(next).toContain(`${KEY}/project_release.md`);
  });

  it("leaves an index that never linked the file unchanged", () => {
    expect(indexWithoutFile(INDEX, KEY, "never_listed.md")).toBe(INDEX);
  });
});

describe("indexWithRenamedFile", () => {
  it("repoints the link and leaves other groups and prose alone", () => {
    const withProse = `${INDEX}\n\nSee project_release.md for the freeze rules.`;
    const next = indexWithRenamedFile(withProse, KEY, "project_release.md", "project_freeze.md");
    expect(next).toContain(`](${KEY}/project_freeze.md)`);
    expect(next).not.toContain(`](${KEY}/project_release.md)`);
    // A bare mention in a sentence is not a link and must not be rewritten.
    expect(next).toContain("See project_release.md for the freeze rules.");
    expect(next).toContain(`](${OTHER}/feedback_testing.md)`);
  });
});

describe("headingOffset", () => {
  it("finds the Workspace's own group heading", () => {
    expect(INDEX.slice(headingOffset(INDEX, KEY))).toMatch(new RegExp(`^## ${KEY}`));
    expect(INDEX.slice(headingOffset(INDEX, OTHER))).toMatch(new RegExp(`^## ${OTHER}`));
  });

  it("returns -1 when the index has no group for the Workspace yet", () => {
    expect(headingOffset(INDEX, "unseen-0badc0de")).toBe(-1);
  });

  it("does not match a heading that merely mentions the key", () => {
    expect(headingOffset(`## notes about ${KEY} here\n`, KEY)).toBe(-1);
  });
});

describe("fileListState", () => {
  const file = { name: "feedback_testing.md" } as MemoryFileInfo;

  it("renders nothing below the index when no Workspace is selected", () => {
    // Regression: `files` is null here and stays null — no request is in flight and none will
    // be — so treating null as "loading" left an agent with no Workspace Memory directory
    // staring at a skeleton that never resolved.
    expect(fileListState(null, null)).toBe("none");
    expect(fileListState(null, [])).toBe("none");
    expect(fileListState(null, [file])).toBe("none");
  });

  it("distinguishes a Workspace still loading from one with no topic file", () => {
    expect(fileListState("my-app-a81f32c4", null)).toBe("loading");
    expect(fileListState("my-app-a81f32c4", [])).toBe("empty");
  });

  it("lists the files once they arrive", () => {
    expect(fileListState("my-app-a81f32c4", [file])).toBe("files");
  });
});

describe("frontmatterProblem", () => {
  const complete =
    "---\nname: Testing conventions\ndescription: how tests run\ntype: feedback\nupdated_at: 2026-07-30\n---\n\n- body\n";

  it("accepts complete frontmatter", () => {
    expect(frontmatterProblem(complete)).toBeUndefined();
  });

  it("rejects a file with no frontmatter block", () => {
    expect(frontmatterProblem("just a note\n")).toBeTruthy();
  });

  it("rejects a missing name and an unsupported type", () => {
    expect(frontmatterProblem("---\ntype: project\n---\nbody\n")).toBeTruthy();
    // `user` is deliberately not a supported type: Memory is shared across Project members.
    expect(frontmatterProblem("---\nname: Me\ntype: user\n---\nbody\n")).toBeTruthy();
  });

  it("accepts every supported type", () => {
    for (const type of ["feedback", "project", "reference"]) {
      expect(frontmatterProblem(`---\nname: N\ntype: ${type}\n---\nbody\n`)).toBeUndefined();
    }
  });
});
