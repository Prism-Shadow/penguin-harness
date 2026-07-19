/**
 * file-path.ts unit tests: whether inline code in message text looks like a file path,
 * and all branches of normalizing body paths to a Workspace-relative path (toWorkspaceRelative).
 */
import { describe, expect, it } from "vitest";
import { isFilePathLike, toWorkspaceRelative } from "../src/lib/file-path";

describe("isFilePathLike", () => {
  it("相对路径 + 图片扩展名 → 命中", () => {
    expect(isFilePathLike("./foo/bar.png")).toBe(true);
  });

  it("无斜杠的裸文件名 + 已知扩展名 → 命中", () => {
    expect(isFilePathLike("report.pdf")).toBe(true);
  });

  it("多级相对路径 + 代码扩展名 → 命中", () => {
    expect(isFilePathLike("src/lib/format.ts")).toBe(true);
  });

  it("前后空白会被裁剪，不影响命中", () => {
    expect(isFilePathLike("  ./agentmind-architecture-minimal.png  ")).toBe(true);
  });

  it("裸词（无扩展名）→ 不命中", () => {
    expect(isFilePathLike("hello")).toBe(false);
  });

  it("未知扩展名 → 不命中", () => {
    expect(isFilePathLike("archive.xyz")).toBe(false);
  });

  it("版本号（数字扩展名）→ 不命中", () => {
    expect(isFilePathLike("v1.2")).toBe(false);
  });

  it("URL（含 scheme）→ 不命中，即使结尾像扩展名", () => {
    expect(isFilePathLike("https://example.com/report.pdf")).toBe(false);
  });

  it("裸域名（www 前缀）→ 不命中", () => {
    expect(isFilePathLike("www.example.com")).toBe(false);
  });

  it("含空格的长句子（句中带点）→ 不命中", () => {
    expect(isFilePathLike("See the report.pdf attached in this message.")).toBe(false);
  });

  it("空字符串 → 不命中", () => {
    expect(isFilePathLike("")).toBe(false);
  });
});

describe("toWorkspaceRelative", () => {
  const WS = "/home/user/workspaces/tmp-1";

  it("绝对路径命中 Workspace 前缀 → 剥前缀返回相对路径", () => {
    expect(toWorkspaceRelative(`${WS}/report.pdf`, WS)).toBe("report.pdf");
    expect(toWorkspaceRelative(`${WS}/sub/dir/a.txt`, WS)).toBe("sub/dir/a.txt");
  });

  it("绝对路径未命中前缀 / 等于 Workspace 本身 / 无 Workspace → null", () => {
    expect(toWorkspaceRelative("/etc/passwd.txt", WS)).toBe(null);
    // Sibling directory shares the prefix string but differs by a separator: not a match.
    expect(toWorkspaceRelative(`${WS}-other/a.txt`, WS)).toBe(null);
    expect(toWorkspaceRelative(WS, WS)).toBe(null);
    expect(toWorkspaceRelative("/a/b.txt", null)).toBe(null);
    expect(toWorkspaceRelative("/a/b.txt", "")).toBe(null);
  });

  it("绝对路径剥前缀后继续词法归一（含 .. 越根 → null）", () => {
    expect(toWorkspaceRelative(`${WS}/sub/../a.txt`, WS)).toBe("a.txt");
    expect(toWorkspaceRelative(`${WS}/../escape.txt`, WS)).toBe(null);
  });

  it("Windows 风格 Workspace：盘符/反斜杠绝对路径剥前缀并统一转 '/'", () => {
    const win = "C:\\Users\\me\\ws";
    expect(toWorkspaceRelative("C:\\Users\\me\\ws\\sub\\a.txt", win)).toBe("sub/a.txt");
    expect(toWorkspaceRelative("D:\\other\\a.txt", win)).toBe(null);
    expect(toWorkspaceRelative("C:\\Users\\me\\ws", win)).toBe(null);
  });

  it("POSIX 文件名里的反斜杠不做全局替换（仅 Windows 前缀命中时转换）", () => {
    expect(toWorkspaceRelative("dir\\name.txt", WS)).toBe("dir\\name.txt");
  });

  it("相对路径词法归一：./ 与空段剔除、.. 弹栈", () => {
    expect(toWorkspaceRelative("./foo/bar.png", WS)).toBe("foo/bar.png");
    expect(toWorkspaceRelative("a/./b//c.txt", WS)).toBe("a/b/c.txt");
    expect(toWorkspaceRelative("a/../b.txt", WS)).toBe("b.txt");
  });

  it("相对路径 .. 越出 Workspace 根 → null", () => {
    expect(toWorkspaceRelative("../a.txt", WS)).toBe(null);
    expect(toWorkspaceRelative("a/../../b.txt", WS)).toBe(null);
  });

  it("~ 开头（家目录）→ null", () => {
    expect(toWorkspaceRelative("~/docs/a.txt", WS)).toBe(null);
  });

  it("纯文件名原样返回；Workspace 为 null 的相对路径照常归一", () => {
    expect(toWorkspaceRelative("report.pdf", WS)).toBe("report.pdf");
    expect(toWorkspaceRelative("sub/a.txt", null)).toBe("sub/a.txt");
  });

  it("空 / 纯空白 / 归一后为空（'.'）/ 超长（>512）→ null", () => {
    expect(toWorkspaceRelative("", WS)).toBe(null);
    expect(toWorkspaceRelative("   ", WS)).toBe(null);
    expect(toWorkspaceRelative(".", WS)).toBe(null);
    expect(toWorkspaceRelative(`a/${"x".repeat(512)}.txt`, WS)).toBe(null);
  });

  it("前后空白先裁剪再归一", () => {
    expect(toWorkspaceRelative(`  ${WS}/a.txt  `, WS)).toBe("a.txt");
  });
});
