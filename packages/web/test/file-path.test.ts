/**
 * file-path.ts unit tests: whether inline code in message text looks like a file path,
 * all branches of normalizing body paths to a Workspace-relative path (toWorkspaceRelative),
 * the directory-browser navigation join (joinWorkspacePath), and the display name of a
 * file path (pathFileName — the details card's Trace file row).
 */
import { describe, expect, it } from "vitest";
import {
  isFilePathLike,
  joinWorkspacePath,
  pathFileName,
  toWorkspaceRelative,
} from "../src/lib/file-path";

describe("isFilePathLike", () => {
  it("relative path + image extension → match", () => {
    expect(isFilePathLike("./foo/bar.png")).toBe(true);
  });

  it("bare filename without slashes + known extension → match", () => {
    expect(isFilePathLike("report.pdf")).toBe(true);
  });

  it("multi-level relative path + code extension → match", () => {
    expect(isFilePathLike("src/lib/format.ts")).toBe(true);
  });

  it("surrounding whitespace is trimmed and does not affect matching", () => {
    expect(isFilePathLike("  ./agentmind-architecture-minimal.png  ")).toBe(true);
  });

  it("bare word (no extension) → no match", () => {
    expect(isFilePathLike("hello")).toBe(false);
  });

  it("unknown extension → no match", () => {
    expect(isFilePathLike("archive.xyz")).toBe(false);
  });

  it("version number (numeric extension) → no match", () => {
    expect(isFilePathLike("v1.2")).toBe(false);
  });

  it("URL (with scheme) → no match, even when the tail looks like an extension", () => {
    expect(isFilePathLike("https://example.com/report.pdf")).toBe(false);
  });

  it("bare domain (www prefix) → no match", () => {
    expect(isFilePathLike("www.example.com")).toBe(false);
  });

  it("long sentence with spaces (dot mid-sentence) → no match", () => {
    expect(isFilePathLike("See the report.pdf attached in this message.")).toBe(false);
  });

  it("empty string → no match", () => {
    expect(isFilePathLike("")).toBe(false);
  });
});

describe("toWorkspaceRelative", () => {
  const WS = "/home/user/workspaces/tmp-1";

  it("absolute path matching the Workspace prefix → strips it, returning the relative path", () => {
    expect(toWorkspaceRelative(`${WS}/report.pdf`, WS)).toBe("report.pdf");
    expect(toWorkspaceRelative(`${WS}/sub/dir/a.txt`, WS)).toBe("sub/dir/a.txt");
  });

  it("absolute path missing the prefix / equal to the Workspace itself / no Workspace → null", () => {
    expect(toWorkspaceRelative("/etc/passwd.txt", WS)).toBe(null);
    // Sibling directory shares the prefix string but differs by a separator: not a match.
    expect(toWorkspaceRelative(`${WS}-other/a.txt`, WS)).toBe(null);
    expect(toWorkspaceRelative(WS, WS)).toBe(null);
    expect(toWorkspaceRelative("/a/b.txt", null)).toBe(null);
    expect(toWorkspaceRelative("/a/b.txt", "")).toBe(null);
  });

  it("absolute paths keep normalizing lexically after the prefix is stripped (.. escaping the root → null)", () => {
    expect(toWorkspaceRelative(`${WS}/sub/../a.txt`, WS)).toBe("a.txt");
    expect(toWorkspaceRelative(`${WS}/../escape.txt`, WS)).toBe(null);
  });

  it("Windows-style Workspace: drive-letter/backslash absolute paths strip the prefix and normalize to '/'", () => {
    const win = "C:\\Users\\me\\ws";
    expect(toWorkspaceRelative("C:\\Users\\me\\ws\\sub\\a.txt", win)).toBe("sub/a.txt");
    expect(toWorkspaceRelative("D:\\other\\a.txt", win)).toBe(null);
    expect(toWorkspaceRelative("C:\\Users\\me\\ws", win)).toBe(null);
  });

  it("Windows Workspace: forward-slash and mixed spellings of the same path also match", () => {
    const win = "C:\\Users\\me\\ws";
    // Core's model-visible spelling uses forward slashes on Windows; the card must still strip.
    expect(toWorkspaceRelative("C:/Users/me/ws/sub/a.txt", win)).toBe("sub/a.txt");
    expect(toWorkspaceRelative("C:/Users/me/ws\\sub/a.txt", win)).toBe("sub/a.txt");
    // Drive letters are case-insensitive on Windows; the rest of the path is not.
    expect(toWorkspaceRelative("c:/Users/me/ws/sub/a.txt", win)).toBe("sub/a.txt");
    expect(toWorkspaceRelative("C:/Users/ME/ws/sub/a.txt", win)).toBe(null);
    // A forward-slash Workspace value matches a backslash assistant path too.
    expect(toWorkspaceRelative("C:\\Users\\me\\ws\\sub\\a.txt", "C:/Users/me/ws")).toBe(
      "sub/a.txt",
    );
  });

  it("Windows Workspace: relative backslash paths split into segments", () => {
    expect(toWorkspaceRelative("dir\\name.txt", "C:\\Users\\me\\ws")).toBe("dir/name.txt");
  });

  it("backslashes in POSIX filenames are not globally replaced (converted only on a Windows prefix match)", () => {
    expect(toWorkspaceRelative("dir\\name.txt", WS)).toBe("dir\\name.txt");
  });

  it("relative-path lexical normalization: ./ and empty segments removed, .. pops the stack", () => {
    expect(toWorkspaceRelative("./foo/bar.png", WS)).toBe("foo/bar.png");
    expect(toWorkspaceRelative("a/./b//c.txt", WS)).toBe("a/b/c.txt");
    expect(toWorkspaceRelative("a/../b.txt", WS)).toBe("b.txt");
  });

  it("relative .. escaping the Workspace root → null", () => {
    expect(toWorkspaceRelative("../a.txt", WS)).toBe(null);
    expect(toWorkspaceRelative("a/../../b.txt", WS)).toBe(null);
  });

  it("leading ~ (home directory) → null", () => {
    expect(toWorkspaceRelative("~/docs/a.txt", WS)).toBe(null);
  });

  it("a plain filename returns unchanged; relative paths normalize as usual with a null Workspace", () => {
    expect(toWorkspaceRelative("report.pdf", WS)).toBe("report.pdf");
    expect(toWorkspaceRelative("sub/a.txt", null)).toBe("sub/a.txt");
  });

  it("empty / pure whitespace / empty after normalization ('.') / overlong (>512) → null", () => {
    expect(toWorkspaceRelative("", WS)).toBe(null);
    expect(toWorkspaceRelative("   ", WS)).toBe(null);
    expect(toWorkspaceRelative(".", WS)).toBe(null);
    expect(toWorkspaceRelative(`a/${"x".repeat(512)}.txt`, WS)).toBe(null);
  });

  it("surrounding whitespace is trimmed before normalization", () => {
    expect(toWorkspaceRelative(`  ${WS}/a.txt  `, WS)).toBe("a.txt");
  });
});

describe("joinWorkspacePath", () => {
  it("joins an entry name onto the Workspace root (empty base)", () => {
    expect(joinWorkspacePath("", "home")).toBe("home");
  });

  it("joins an entry name onto a nested base", () => {
    expect(joinWorkspacePath("home/user", "docs")).toBe("home/user/docs");
  });

  it("two clicks on the same row from the same listing generation are idempotent (regression: compounded descent)", () => {
    // The files-panel race: while the navigation fetch is in flight, the listing for `base`
    // stays rendered but the path state has already advanced. Click #2 on the same stale row
    // must recompute the SAME target from the listing's own base…
    const base = "";
    const first = joinWorkspacePath(base, "home");
    const pathStateAfterFirstClick = first;
    const second = joinWorkspacePath(base, "home");
    expect(second).toBe(first);
    // …whereas joining against the advanced path state — the old behavior — compounds the
    // segment into a directory that does not exist ("home/home", then "home/home/home", …).
    expect(joinWorkspacePath(pathStateAfterFirstClick, "home")).toBe("home/home");
  });
});

describe("pathFileName", () => {
  it("POSIX absolute path → final segment", () => {
    expect(pathFileName("/home/user/PenguinHarness/traces/2026-08-18/s-1/001.jsonl")).toBe(
      "001.jsonl",
    );
  });

  it("Windows path (backslashes) → final segment", () => {
    expect(pathFileName("C:\\Users\\u\\PenguinHarness\\traces\\001.jsonl")).toBe("001.jsonl");
  });

  it("mixed separators → the last of either kind cuts", () => {
    expect(pathFileName("C:/Users/u\\traces\\001.jsonl")).toBe("001.jsonl");
  });

  it("bare filename → unchanged", () => {
    expect(pathFileName("001.jsonl")).toBe("001.jsonl");
  });

  it("a backslash inside a POSIX directory name is harmless — the later '/' wins the cut", () => {
    expect(pathFileName("/data/weird\\dir/traces/001.jsonl")).toBe("001.jsonl");
  });

  it("the cut is the last separator of either kind, so a backslash in the file name cuts too (no such trace name exists — pinning the rule, not endorsing it)", () => {
    expect(pathFileName("/data/traces/weird\\001.jsonl")).toBe("001.jsonl");
  });

  it("degenerate trailing separator falls back to the input (never blank)", () => {
    expect(pathFileName("/home/user/")).toBe("/home/user/");
  });
});
