/**
 * Behavior tests for the file tools (read_file / edit_file / write_file): happy paths,
 * every failure case, workspace-relative path resolution, offset/limit windows,
 * replace_all semantics, and parent-directory creation. Directly drives
 * BuiltinTool.execute and captures the generator's return value (same approach as
 * read-image.test.ts); Environment-side framing is covered by environment.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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
import type { ToolDefinitionConfig } from "../src/interfaces/index.js";
import { modelVisiblePath } from "../src/internal/model-visible-path.js";

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
    expect(text).toContain("Absolute paths are supported");
    expect(text).toContain(
      `The directory "${modelVisiblePath(tmp)}" exists but has no entry "missing.txt".`,
    );
    expect(text).toContain("It is empty.");
  });

  it("points at the nearest existing directory and its closest-named entries", async () => {
    await mkdir(path.join(tmp, "agent_state"));
    await writeFile(path.join(tmp, "agent_state", "AGENTS.md"), "persona\n");
    await writeFile(path.join(tmp, "notes.txt"), "n\n");
    const { result, text } = await run(tool(), { file_path: path.join(tmp, "AGENTS.md") }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain(
      `The directory "${modelVisiblePath(tmp)}" exists but has no entry "AGENTS.md".`,
    );
    // Ranked by shared prefix with the missing name: agent_state/ first, dirs marked with "/".
    expect(text).toContain("It contains: agent_state/, notes.txt");
  });

  it("reports the first missing segment of a deeper path", async () => {
    const missing = path.join(tmp, "nope", "deep", "file.txt");
    const { result, text } = await run(tool(), { file_path: missing }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain(
      `The directory "${modelVisiblePath(tmp)}" exists but has no entry "nope".`,
    );
  });

  it("says so when a path segment is a file, not a directory", async () => {
    await writeFile(path.join(tmp, "a.txt"), "x\n");
    const inner = path.join(tmp, "a.txt", "inner.txt");
    const { result, text } = await run(tool(), { file_path: inner }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("File not found");
    expect(text).toContain(
      `Note: "${modelVisiblePath(path.join(tmp, "a.txt"))}" exists but is a file, not a directory.`,
    );
  });

  it("caps the entry listing and counts the rest", async () => {
    for (let i = 0; i < 10; i += 1) await writeFile(path.join(tmp, `e${i}.txt`), "x\n");
    const { text } = await run(tool(), { file_path: "zz.txt" }, tmp);
    expect(text).toContain("(+2 more)");
    expect(text).not.toContain("e8.txt");
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

  it("replaces a unique occurrence and echoes a git-style unified diff", async () => {
    const file = path.join(tmp, "src.ts");
    await writeFile(file, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const { result, text } = await run(
      tool(),
      { file_path: "src.ts", old_string: "const b = 2;", new_string: "const b = 20;" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toBe(
      [
        'Replaced 1 occurrence in "src.ts".',
        "@@ -1,3 +1,3 @@",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 20;",
        " const c = 3;",
      ].join("\n"),
    );
    expect(await readFile(file, "utf8")).toBe("const a = 1;\nconst b = 20;\nconst c = 3;\n");
  });

  it("replaces every occurrence with replace_all and diffs same-line hits in one hunk", async () => {
    const file = path.join(tmp, "multi.txt");
    await writeFile(file, "foo bar foo baz foo\n");
    const { result, text } = await run(
      tool(),
      { file_path: "multi.txt", old_string: "foo", new_string: "qux", replace_all: true },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toBe(
      [
        'Replaced 3 occurrences in "multi.txt".',
        "@@ -1,1 +1,1 @@",
        "-foo bar foo baz foo",
        "+qux bar qux baz qux",
      ].join("\n"),
    );
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
    expect(text).toContain(
      `The directory "${modelVisiblePath(tmp)}" exists but has no entry "nope.txt".`,
    );
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

  it("refuses case-variant names and symlinks that dereference to a secret store", async () => {
    await writeFile(path.join(tmp, ".vault.toml"), "SECRET=1\n");
    // Case variant: a case-insensitive filesystem (macOS/Windows) opens ".VAULT.TOML" as
    // the store itself; on a case-sensitive one refusing the name is a harmless false positive.
    const upper = await run(tool(), { file_path: ".VAULT.TOML" }, tmp);
    expect(upper.result?.stopReason).toBe("failed");
    expect(upper.text).toContain("Refusing to read");
    // Symlink: the link's own basename says nothing about what it dereferences to.
    await symlink(path.join(tmp, ".vault.toml"), path.join(tmp, "notes.txt"));
    const linked = await run(tool(), { file_path: "notes.txt" }, tmp);
    expect(linked.result?.stopReason).toBe("failed");
    expect(linked.text).toContain("Refusing to read");
    expect(linked.text).not.toContain("SECRET=1");
    // A symlink NAMED like a store but pointing elsewhere is refused on the lexical name —
    // an acceptable false positive for a guard.
    await writeFile(path.join(tmp, "plain.txt"), "hello\n");
    await symlink(path.join(tmp, "plain.txt"), path.join(tmp, ".project_config.toml"));
    const named = await run(tool(), { file_path: ".project_config.toml" }, tmp);
    expect(named.result?.stopReason).toBe("failed");
    // An ordinary symlink to an ordinary file still reads.
    await symlink(path.join(tmp, "plain.txt"), path.join(tmp, "alias.txt"));
    const ok = await run(tool(), { file_path: "alias.txt" }, tmp);
    expect(ok.result?.stopReason).toBeUndefined();
    expect(ok.text).toContain("hello");
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

  it.skipIf(process.platform !== "win32")(
    "accepts the same absolute path in Windows and POSIX spellings",
    async () => {
      await writeFile(path.join(tmp, "spellings.txt"), "both spellings work\n");
      const windowsSpelling = path.join(tmp, "spellings.txt");
      const posixSpelling = windowsSpelling.replaceAll("\\", "/");
      const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));
      for (const spelling of [windowsSpelling, posixSpelling]) {
        const { text } = await run(tool(), { file_path: spelling }, tmp);
        expect(text).toContain("both spellings work");
      }
    },
  );

  it.skipIf(process.platform !== "win32")(
    "names the workspace with forward slashes when a file is missing",
    async () => {
      const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));
      const { text } = await run(tool(), { file_path: "no-such-file.txt" }, tmp);
      expect(text).toContain("File not found");
      expect(text).not.toContain("\\");
    },
  );

  it("confirms EOF for an unterminated line one byte below the scan cap", async () => {
    await writeFile(
      path.join(tmp, "scan-cap-minus-one.txt"),
      "x".repeat(READ_FILE_SCAN_CAP_BYTES - 1),
    );
    const tool = () => createReadFileTool(def(READ_FILE_NAME, "r"));
    const { result, text } = await run(tool(), { file_path: "scan-cap-minus-one.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("[line truncated]");
    expect(text).not.toContain("file has more than");
    expect(text).not.toContain("Stopped after scanning");
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

  it("erasing the whole content diffs to a pure removal hunk", async () => {
    const file = path.join(tmp, "erase.txt");
    await writeFile(file, "abc");
    const { result, text } = await run(
      tool(),
      { file_path: "erase.txt", old_string: "abc", new_string: "" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toBe('Replaced 1 occurrence in "erase.txt".\n@@ -1,1 +0,0 @@\n-abc');
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

  // POSIX-only: Windows has no owner-only mode bits to preserve (chmod maps to the read-only attribute).
  it.skipIf(process.platform === "win32")(
    "preserves the permission bits of an overwritten file (atomic rename)",
    async () => {
      const file = path.join(tmp, "mode.txt");
      await writeFile(file, "old");
      await chmod(file, 0o600);
      const { result } = await run(tool(), { file_path: "mode.txt", content: "new" }, tmp);
      expect(result?.stopReason).toBeUndefined();
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, "utf8")).toBe("new");
    },
  );

  it("writes atomically: no temp files are left behind", async () => {
    await run(tool(), { file_path: "fresh.txt", content: "x" }, tmp);
    const entries = await readdir(tmp);
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });
});

describe("edit_file — diff output caps", () => {
  const tool = () => createEditFileTool(def(EDIT_FILE_NAME, "rw"));

  it("caps replace_all storms at a handful of hunks plus an elision note", async () => {
    // 8 far-apart sites (gaps wider than twice the context) -> 8 hunks, capped at 5.
    const block = ["target", ...Array.from({ length: 9 }, (_, i) => `filler-${i}`)].join("\n");
    await writeFile(
      path.join(tmp, "cap.txt"),
      `${Array.from({ length: 8 }, () => block).join("\n")}\n`,
    );
    const { result, text } = await run(
      tool(),
      { file_path: "cap.txt", old_string: "target", new_string: "changed", replace_all: true },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Replaced 8 occurrences in "cap.txt".');
    expect(text.match(/@@ /g)).toHaveLength(5);
    expect(text).toContain("…and 3 more replacements");
  });

  it("self-budgets under a tiny maxOutputLength: the summary and note survive, hunks are dropped", async () => {
    await writeFile(path.join(tmp, "tiny.txt"), "a\nb\na\n");
    const budgetTool = createEditFileTool({
      name: EDIT_FILE_NAME,
      description: "test",
      permission: "rw",
      maxOutputLength: 150,
    });
    const { result, text } = await run(
      budgetTool,
      { file_path: "tiny.txt", old_string: "a", new_string: "z", replace_all: true },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text.length).toBeLessThanOrEqual(150);
    expect(text).toContain('Replaced 2 occurrences in "tiny.txt".');
    expect(text).not.toContain("@@");
    expect(text).toContain("…and 2 more replacements");
  });

  it("strips \\r from diff lines on CRLF files", async () => {
    await writeFile(path.join(tmp, "crlfdiff.txt"), "alpha\r\nbeta\r\n");
    const { result, text } = await run(
      tool(),
      { file_path: "crlfdiff.txt", old_string: "alpha", new_string: "gamma" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("-alpha");
    expect(text).toContain("+gamma");
    expect(text).toContain(" beta");
    expect(text).not.toContain("\r");
  });
});

describe("write_file — overwrite diffs", () => {
  const tool = () => createWriteFileTool(def(WRITE_FILE_NAME, "rw"));

  it("appends a small unified diff when overwriting", async () => {
    await writeFile(path.join(tmp, "d.txt"), "one\ntwo\nthree\n");
    const { result, text } = await run(
      tool(),
      { file_path: "d.txt", content: "one\nTWO\nthree\n" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    expect(text).toBe(
      [
        'Overwrote "d.txt" (3 lines, 14 bytes).',
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+TWO",
        " three",
      ].join("\n"),
    );
  });

  it("notes an unchanged overwrite", async () => {
    await writeFile(path.join(tmp, "same.txt"), "keep\n");
    const { text } = await run(tool(), { file_path: "same.txt", content: "keep\n" }, tmp);
    expect(text).toContain('Overwrote "same.txt"');
    expect(text).toContain("(content unchanged)");
    expect(text).not.toContain("@@");
  });

  it("collapses a large rewrite to a one-line +X/−Y summary", async () => {
    const oldContent = Array.from({ length: 200 }, (_, i) => `a${i}`).join("\n");
    const newContent = Array.from({ length: 200 }, (_, i) => `b${i}`).join("\n");
    await writeFile(path.join(tmp, "big.txt"), oldContent);
    const { text } = await run(tool(), { file_path: "big.txt", content: newContent }, tmp);
    expect(text).toContain('Overwrote "big.txt"');
    expect(text).toContain("+200/−200 lines vs the previous content (diff too large to show)");
    expect(text).not.toContain("@@");
  });

  it("created files carry no diff", async () => {
    const { text } = await run(tool(), { file_path: "fresh2.txt", content: "x\ny\n" }, tmp);
    expect(text).toContain('Created "fresh2.txt"');
    expect(text).not.toContain("@@");
  });
});

describe("edit_file / write_file — symlinked targets", () => {
  const edit = () => createEditFileTool(def(EDIT_FILE_NAME, "rw"));
  const write = () => createWriteFileTool(def(WRITE_FILE_NAME, "rw"));

  it("edit_file writes through the link and leaves the link in place", async () => {
    await writeFile(path.join(tmp, "real.md"), "hello\nworld\n");
    await symlink("real.md", path.join(tmp, "link.md"));
    const { result } = await run(
      edit(),
      { file_path: "link.md", old_string: "world", new_string: "there" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    // The edit landed on the file the link names — not on a regular file that replaced it.
    expect(await readFile(path.join(tmp, "real.md"), "utf8")).toBe("hello\nthere\n");
    expect((await lstat(path.join(tmp, "link.md"))).isSymbolicLink()).toBe(true);
  });

  it("write_file overwrites through the link and leaves the link in place", async () => {
    await writeFile(path.join(tmp, "real.txt"), "old\n");
    await symlink("real.txt", path.join(tmp, "alias.txt"));
    const { result, text } = await run(write(), { file_path: "alias.txt", content: "new\n" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain('Overwrote "alias.txt"');
    expect(await readFile(path.join(tmp, "real.txt"), "utf8")).toBe("new\n");
    expect((await lstat(path.join(tmp, "alias.txt"))).isSymbolicLink()).toBe(true);
  });

  it("follows a chain of links to the file at its end", async () => {
    await writeFile(path.join(tmp, "end.txt"), "start\n");
    await symlink("end.txt", path.join(tmp, "middle.txt"));
    await symlink("middle.txt", path.join(tmp, "head.txt"));
    const { result } = await run(write(), { file_path: "head.txt", content: "done\n" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(await readFile(path.join(tmp, "end.txt"), "utf8")).toBe("done\n");
    expect((await lstat(path.join(tmp, "middle.txt"))).isSymbolicLink()).toBe(true);
    expect((await lstat(path.join(tmp, "head.txt"))).isSymbolicLink()).toBe(true);
  });

  it("resolves a link that crosses directories", async () => {
    await mkdir(path.join(tmp, "data"), { recursive: true });
    await writeFile(path.join(tmp, "data", "target.txt"), "before\n");
    await symlink(path.join("data", "target.txt"), path.join(tmp, "shortcut.txt"));
    const { result } = await run(write(), { file_path: "shortcut.txt", content: "after\n" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(await readFile(path.join(tmp, "data", "target.txt"), "utf8")).toBe("after\n");
    expect((await lstat(path.join(tmp, "shortcut.txt"))).isSymbolicLink()).toBe(true);
  });

  it("write_file creates the file a dangling link names, including its parent", async () => {
    await symlink(path.join("missing", "created.txt"), path.join(tmp, "dangling.txt"));
    const { result, text } = await run(
      write(),
      { file_path: "dangling.txt", content: "made\n" },
      tmp,
    );
    expect(result?.stopReason).toBeUndefined();
    // Nothing was there to overwrite, so it reads as a creation.
    expect(text).toContain('Created "dangling.txt"');
    expect(await readFile(path.join(tmp, "missing", "created.txt"), "utf8")).toBe("made\n");
    expect((await lstat(path.join(tmp, "dangling.txt"))).isSymbolicLink()).toBe(true);
  });

  // POSIX-only: Windows has no owner-only mode bits to preserve (chmod maps to the read-only attribute).
  it.skipIf(process.platform === "win32")(
    "preserves the permission bits of the file at the end of the link",
    async () => {
      const real = path.join(tmp, "moded.txt");
      await writeFile(real, "old\n");
      await chmod(real, 0o600);
      await symlink("moded.txt", path.join(tmp, "moded-link.txt"));
      const { result } = await run(write(), { file_path: "moded-link.txt", content: "new\n" }, tmp);
      expect(result?.stopReason).toBeUndefined();
      expect(await readFile(real, "utf8")).toBe("new\n");
      expect((await stat(real)).mode & 0o777).toBe(0o600);
    },
  );

  it("fails cleanly on a link cycle instead of hanging", async () => {
    await symlink("b.txt", path.join(tmp, "a.txt"));
    await symlink("a.txt", path.join(tmp, "b.txt"));
    const { result, text } = await run(write(), { file_path: "a.txt", content: "x\n" }, tmp);
    expect(result?.stopReason).toBe("failed");
    expect(text).toContain("Too many levels of symbolic links");
  });

  it("leaves no temp file behind next to the resolved target", async () => {
    await mkdir(path.join(tmp, "nested"), { recursive: true });
    await writeFile(path.join(tmp, "nested", "t.txt"), "a\n");
    await symlink(path.join("nested", "t.txt"), path.join(tmp, "l.txt"));
    await run(write(), { file_path: "l.txt", content: "b\n" }, tmp);
    // The temp file is created beside the RESOLVED target, so the nested directory is the
    // one that has to come out clean.
    expect(await readFile(path.join(tmp, "nested", "t.txt"), "utf8")).toBe("b\n");
    expect((await readdir(path.join(tmp, "nested"))).filter((e) => e.includes(".tmp-"))).toEqual(
      [],
    );
    expect((await readdir(tmp)).filter((e) => e.includes(".tmp-"))).toEqual([]);
  });
});
