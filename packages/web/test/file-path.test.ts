/**
 * file-path.ts unit tests: whether inline code in message text looks like a file path,
 * and all branches of normalizing body paths to a Workspace-relative path (toWorkspaceRelative).
 */
import { describe, expect, it } from "vitest";
import { isFilePathLike, toWorkspaceRelative } from "../src/lib/file-path";

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
