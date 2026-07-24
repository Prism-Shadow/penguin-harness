/**
 * Behavior tests for the file tools (read_file / edit_file / write_file): happy paths,
 * every failure case, workspace-relative path resolution, offset/limit windows,
 * replace_all semantics, and parent-directory creation. Directly drives
 * BuiltinTool.execute and captures the generator's return value (same approach as
 * read-image.test.ts); Environment-side framing is covered by environment.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_READ_FILE_LIMIT,
  MAX_LINE_LENGTH,
  READ_FILE_NAME,
  READ_FILE_SCAN_CAP_BYTES,
  createReadFileTool,
} from "../src/environment/tools/read-file.js";
import { EDIT_FILE_NAME, createEditFileTool } from "../src/environment/tools/edit-file.js";
import { WRITE_FILE_NAME, createWriteFileTool } from "../src/environment/tools/write-file.js";
import type { BuiltinTool, ToolResult } from "../src/environment/tools/types.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolDefinitionConfig } from "../src/interfaces.js";

function def(name: string, permission: "r" | "rw"): ToolDefinitionConfig {
  return { name, description: "test", permission };
}

/** Runs one tool execution: concatenates text deltas and captures the generator's return value. */
async function run(tool: BuiltinTool, args: Record<string, unknown>, workspaceDir: string) {
  const gen = tool.execute(args, { workspaceDir, toolCallId: "c1" });
  const messages: OmniMessage[] = [];
  let result: ToolResult | void;
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      result = res.value;
      break;
    }
    messages.push(res.value);
  }
  const text = messages.map((m) => (m.payload as { output?: string }).output ?? "").join("");
  return { result, text };
}

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-filetools-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("read_file", () => {
  const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));

  it("reads a file by workspace-relative path in cat -n style", async () => {
    await writeFile(path.join(tmp, "a.txt"), "alpha\nbeta\ngamma\n");
    const { result, text } = await run(tool(), { file_path: "a.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined(); // Defaults to completed
    expect(text.split("\n")).toEqual(["     1\talpha", "     2\tbeta", "     3\tgamma"]);
  });

  it("reads an absolute path outside the workspace", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "penguin-filetools-out-"));
    try {
      const abs = path.join(outside, "abs.txt");
      await writeFile(abs, "outside\n");
      const { result, text } = await run(tool(), { file_path: abs }, tmp);
      expect(result?.stopReason).toBeUndefined();
      expect(text).toContain("\toutside");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("windows the output with offset/limit and points at the continuation", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n");
    await writeFile(path.join(tmp, "many.txt"), `${lines}\n`);
    const { result, text } = await run(tool(), { file_path: "many.txt", offset: 3, limit: 4 }, tmp);
    expect(result?.stopReason).toBeUndefined();
    const rows = text.split("\n");
    expect(rows[0]).toBe("     3\tline-3");
    expect(rows[3]).toBe("     6\tline-6");
    expect(rows[4]).toBe(
      "[file has 10 lines total; showing 3-6 — call again with offset to continue]",
    );
  });

  it("caps a missing limit at the default window and reports the total", async () => {
    const total = DEFAULT_READ_FILE_LIMIT + 5;
    const lines = Array.from({ length: total }, (_, i) => `l${i + 1}`).join("\n");
    await writeFile(path.join(tmp, "long.txt"), lines);
    const { text } = await run(tool(), { file_path: "long.txt" }, tmp);
    expect(text).toContain(`[file has ${total} lines total; showing 1-${DEFAULT_READ_FILE_LIMIT}`);
  });

  it("truncates a single overlong line with a marker", async () => {
    await writeFile(path.join(tmp, "wide.txt"), `${"x".repeat(MAX_LINE_LENGTH + 50)}\nshort\n`);
    const { text } = await run(tool(), { file_path: "wide.txt" }, tmp);
    expect(text).toContain("… [line truncated]");
    expect(text).toContain("\tshort");
    expect(text).not.toContain("x".repeat(MAX_LINE_LENGTH + 1));
  });

  it("reports an empty file as a note, not a failure", async () => {
    await writeFile(path.join(tmp, "empty.txt"), "");
    const { result, text } = await run(tool(), { file_path: "empty.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("empty file");
  });

  it("fails with a path hint when the file does not exist", async () => {
    const { result, text } = await run(tool(), { file_path: "missing.txt" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("File not found");
    expect(text).toContain("missing.txt");
    expect(text).toContain("workspace");
  });

  it("fails when the path is a directory", async () => {
    await mkdir(path.join(tmp, "subdir"));
    const { result, text } = await run(tool(), { file_path: "subdir" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("directory");
  });

  it("fails on binary content (NUL bytes) and advises other tools", async () => {
    await writeFile(path.join(tmp, "bin.dat"), Buffer.from([0x89, 0x50, 0x00, 0x0a, 0x42]));
    const { result, text } = await run(tool(), { file_path: "bin.dat" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("binary");
    expect(text).toContain("read_image");
  });

  it("fails when offset is past the end of the file", async () => {
    await writeFile(path.join(tmp, "two.txt"), "a\nb\n");
    const { result, text } = await run(tool(), { file_path: "two.txt", offset: 5 }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("past the end");
    expect(text).toContain("2 lines");
  });

  it("fails when file_path is missing", async () => {
    const { result, text } = await run(tool(), {}, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain('"file_path"');
  });
});

describe("edit_file", () => {
  const tool = () => createEditFileTool(def(EDIT_FILE_NAME, "rw"));

  it("replaces a unique occurrence and echoes a numbered verification snippet", async () => {
    const file = path.join(tmp, "src.ts");
    await writeFile(file, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const { result, text } = await run(
      tool(),
      { file_path: "src.ts", old_string: "const b = 2;", new_string: "const b = 20;" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Replaced 1 occurrence in "src.ts"');
    // The snippet is cat -n numbered and shows the replaced line with context.
    expect(text).toContain("     2\tconst b = 20;");
    expect(text).toContain("     1\tconst a = 1;");
    expect(await readFile(file, "utf8")).toBe("const a = 1;\nconst b = 20;\nconst c = 3;\n");
  });

  it("replaces every occurrence with replace_all", async () => {
    const file = path.join(tmp, "multi.txt");
    await writeFile(file, "foo bar foo baz foo\n");
    const { result, text } = await run(
      tool(),
      { file_path: "multi.txt", old_string: "foo", new_string: "qux", replace_all: true },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Replaced 3 occurrences in "multi.txt"');
    expect(await readFile(file, "utf8")).toBe("qux bar qux baz qux\n");
  });

  it("fails when old_string is not found", async () => {
    await writeFile(path.join(tmp, "f.txt"), "hello\n");
    const { result, text } = await run(
      tool(),
      { file_path: "f.txt", old_string: "goodbye", new_string: "farewell" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain('old_string not found in "f.txt"');
    expect(await readFile(path.join(tmp, "f.txt"), "utf8")).toBe("hello\n"); // Untouched
  });

  it("fails with the count when old_string is ambiguous and replace_all is unset", async () => {
    await writeFile(path.join(tmp, "dup.txt"), "x\nx\nx\n");
    const { result, text } = await run(
      tool(),
      { file_path: "dup.txt", old_string: "x", new_string: "y" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("3 times");
    expect(text).toContain("replace_all");
    expect(await readFile(path.join(tmp, "dup.txt"), "utf8")).toBe("x\nx\nx\n");
  });

  it("fails when old_string equals new_string", async () => {
    await writeFile(path.join(tmp, "same.txt"), "abc\n");
    const { result, text } = await run(
      tool(),
      { file_path: "same.txt", old_string: "abc", new_string: "abc" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("identical");
  });

  it("fails and suggests write_file when the file does not exist", async () => {
    const { result, text } = await run(
      tool(),
      { file_path: "nope.txt", old_string: "a", new_string: "b" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("File not found");
    expect(text).toContain("write_file");
  });

  it("fails when the path is a directory", async () => {
    await mkdir(path.join(tmp, "d"));
    const { result, text } = await run(
      tool(),
      { file_path: "d", old_string: "a", new_string: "b" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("directory");
  });

  it("fails when required arguments are missing", async () => {
    const missingPath = await run(tool(), { old_string: "a", new_string: "b" }, tmp);
    expect(missingPath.result?.stopReason).toBe("failed");
    expect(missingPath.text).toContain('"file_path"');
    const missingOld = await run(tool(), { file_path: "f", new_string: "b" }, tmp);
    expect(missingOld.result?.stopReason).toBe("failed");
    expect(missingOld.text).toContain('"old_string"');
    const missingNew = await run(tool(), { file_path: "f", old_string: "a" }, tmp);
    expect(missingNew.result?.stopReason).toBe("failed");
    expect(missingNew.text).toContain('"new_string"');
  });
});

describe("write_file", () => {
  const tool = () => createWriteFileTool(def(WRITE_FILE_NAME, "rw"));

  it("creates a new file (workspace-relative) and reports lines/bytes", async () => {
    const { result, text } = await run(
      tool(),
      { file_path: "out.txt", content: "one\ntwo\n" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Created "out.txt"');
    expect(text).toContain("2 lines");
    expect(text).toContain("8 bytes");
    expect(await readFile(path.join(tmp, "out.txt"), "utf8")).toBe("one\ntwo\n");
  });

  it("creates missing parent directories", async () => {
    const { result, text } = await run(
      tool(),
      { file_path: "a/b/c/deep.txt", content: "deep" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("Created");
    expect(await readFile(path.join(tmp, "a/b/c/deep.txt"), "utf8")).toBe("deep");
    expect((await stat(path.join(tmp, "a/b"))).isDirectory()).toBe(true);
  });

  it("reports Overwrote when the file already exists", async () => {
    await writeFile(path.join(tmp, "exists.txt"), "old");
    const { result, text } = await run(
      tool(),
      { file_path: "exists.txt", content: "new content" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Overwrote "exists.txt"');
    expect(await readFile(path.join(tmp, "exists.txt"), "utf8")).toBe("new content");
  });

  it("accepts an empty string as content", async () => {
    const { result, text } = await run(tool(), { file_path: "blank.txt", content: "" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("0 lines, 0 bytes");
    expect(await readFile(path.join(tmp, "blank.txt"), "utf8")).toBe("");
  });

  it("fails when the path is a directory", async () => {
    await mkdir(path.join(tmp, "adir"));
    const { result, text } = await run(tool(), { file_path: "adir", content: "x" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("directory");
  });

  it("fails when a parent path component is an existing file", async () => {
    await writeFile(path.join(tmp, "plain.txt"), "x");
    const { result, text } = await run(
      tool(),
      { file_path: "plain.txt/child.txt", content: "y" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("Failed to write");
  });

  it("fails when content is missing (but not when it is empty)", async () => {
    const { result, text } = await run(tool(), { file_path: "nocontent.txt" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain('"content"');
  });
});

describe("read_file — argument coercion, CRLF, secret guard", () => {
  const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));

  it("accepts numeric strings for offset/limit", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n");
    await writeFile(path.join(tmp, "many.txt"), `${lines}\n`);
    const { result, text } = await run(
      tool(),
      { file_path: "many.txt", offset: "3", limit: "4" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("     3\tline-3");
    expect(text).toContain("showing 3-6");
  });

  it("fails on non-numeric offset/limit instead of silently defaulting", async () => {
    await writeFile(path.join(tmp, "a.txt"), "x\n");
    const badOffset = await run(tool(), { file_path: "a.txt", offset: "abc" }, tmp);
    expect(badOffset.result?.stopReason).toBe("failed");
    expect(badOffset.text).toContain('Invalid "offset"');
    const badLimit = await run(tool(), { file_path: "a.txt", limit: 0 }, tmp);
    expect(badLimit.result?.stopReason).toBe("failed");
    expect(badLimit.text).toContain('Invalid "limit"');
  });

  it("strips trailing \\r from displayed lines and notes CRLF line endings", async () => {
    await writeFile(path.join(tmp, "crlf.txt"), "alpha\r\nbeta\r\n");
    const { result, text } = await run(tool(), { file_path: "crlf.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("     1\talpha\n");
    expect(text).not.toContain("\r");
    expect(text).toContain("(file uses CRLF line endings)");
  });

  it("refuses the secret stores by basename regardless of directory", async () => {
    await writeFile(path.join(tmp, ".vault.toml"), "SECRET=1\n");
    await mkdir(path.join(tmp, "sub"));
    await writeFile(path.join(tmp, "sub", ".project_config.toml"), "key=1\n");
    const vault = await run(tool(), { file_path: ".vault.toml" }, tmp);
    expect(vault.result?.stopReason).toBe("failed");
    expect(vault.text).toContain("Refusing to read");
    const cfg = await run(tool(), { file_path: "sub/.project_config.toml" }, tmp);
    expect(cfg.result?.stopReason).toBe("failed");
    expect(cfg.text).toContain("Refusing to read");
  });
});

describe("read_file — bounded scan and output budget", () => {
  it("self-budgets the window so the continuation note survives a small maxOutputLength", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`).join("\n");
    await writeFile(path.join(tmp, "many.txt"), `${lines}\n`);
    const tool = createReadFileTool({
      name: READ_FILE_NAME,
      description: "test",
      permission: "r",
      maxOutputLength: 300,
    });
    const { result, text } = await run(tool, { file_path: "many.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    // The whole output fits under the tool's own cap, so Environment cannot cut the note.
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).toMatch(
      /\[file has 10 lines total; showing 1-\d+ \(output limit reached\) — call again with offset to continue\]/,
    );
    expect(text).not.toContain("line-10");
  });

  it("fails with guidance when the scan cap is hit before the window (one huge line)", async () => {
    await writeFile(path.join(tmp, "huge-line.txt"), "x".repeat(READ_FILE_SCAN_CAP_BYTES + 1024));
    const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));
    const { result, text } = await run(tool(), { file_path: "huge-line.txt" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("Stopped after scanning 8 MB");
    expect(text).toContain("sed -n");
  });

  it("reports a lower-bound total when the file outruns the scan cap after the window", async () => {
    // > 8MB of two-byte lines: the window (1-2000) completes early, counting stops at the cap.
    await writeFile(path.join(tmp, "long.txt"), "x\n".repeat(READ_FILE_SCAN_CAP_BYTES / 2 + 4096));
    const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));
    const { result, text } = await run(tool(), { file_path: "long.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toMatch(
      /\[file has more than \d+ lines; showing 1-2000 — call again with offset to continue\]/,
    );
  });
});

describe("edit_file — review follow-ups", () => {
  const tool = () => createEditFileTool(def(EDIT_FILE_NAME, "rw"));

  it("gives an explicitly-empty old_string its own message", async () => {
    await writeFile(path.join(tmp, "f.txt"), "hello\n");
    const { result, text } = await run(
      tool(),
      { file_path: "f.txt", old_string: "", new_string: "x" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("old_string must not be empty");
    expect(text).toContain("write_file");
  });

  it("mentions CRLF in the not-found error when the file uses \\r\\n", async () => {
    await writeFile(path.join(tmp, "crlf.txt"), "alpha\r\nbeta\r\n");
    const { result, text } = await run(
      tool(),
      { file_path: "crlf.txt", old_string: "alpha\nbeta", new_string: "gamma" },
      tmp,
    );
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("old_string not found");
    expect(text).toContain("CRLF");
  });

  it("erasing the whole content produces no dangling snippet newline", async () => {
    const file = path.join(tmp, "erase.txt");
    await writeFile(file, "abc");
    const { result, text } = await run(
      tool(),
      { file_path: "erase.txt", old_string: "abc", new_string: "" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toBe('Replaced 1 occurrence in "erase.txt".');
    expect(await readFile(file, "utf8")).toBe("");
  });

  it("writes atomically: no temp files are left behind", async () => {
    await writeFile(path.join(tmp, "at.txt"), "a b a\n");
    await run(tool(), { file_path: "at.txt", old_string: "b", new_string: "c" }, tmp);
    const entries = await readdir(tmp);
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });
});

describe("write_file — review follow-ups", () => {
  const tool = () => createWriteFileTool(def(WRITE_FILE_NAME, "rw"));

  it("preserves the permission bits of an overwritten file (atomic rename)", async () => {
    const file = path.join(tmp, "mode.txt");
    await writeFile(file, "old");
    await chmod(file, 0o600);
    const { result } = await run(tool(), { file_path: "mode.txt", content: "new" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toBe("new");
  });

  it("writes atomically: no temp files are left behind", async () => {
    await run(tool(), { file_path: "fresh.txt", content: "x" }, tmp);
    const entries = await readdir(tmp);
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });
});
