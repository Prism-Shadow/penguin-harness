/**
 * tool-call-card.tsx preview helpers: previewArguments keeps the real arguments (what heads
 * the approval row), headerSubtitle surfaces the model-written `description` argument for
 * the command/subagent tools and the shortened file path for the file tools, and
 * pendingFilePayload decodes the file-tool arguments so a pending approval shows the actual
 * rewrite. All must tolerate incomplete mid-stream JSON.
 */
import { describe, expect, it } from "vitest";
import {
  headerSubtitle,
  pendingFilePayload,
  previewArguments,
  shortenPath,
} from "../src/features/chat/tool-call-card";

describe("previewArguments", () => {
  it("renders run_command and the legacy exec_command name as $ <cmd>", () => {
    expect(previewArguments("run_command", '{"cmd":"ls -la"}')).toBe("$ ls -la");
    expect(previewArguments("exec_command", '{"cmd":"ls -la"}')).toBe("$ ls -la");
    // Mid-stream (incomplete JSON) still extracts the cmd prefix.
    expect(previewArguments("run_command", '{"cmd":"echo h')).toBe("$ echo h");
  });

  it("renders the file tools by their shortened file_path", () => {
    expect(previewArguments("read_file", '{"file_path":"src/app.py","offset":3}')).toBe(
      "src/app.py",
    );
    expect(
      previewArguments("edit_file", '{"file_path":"a.txt","old_string":"x","new_string":"y"}'),
    ).toBe("a.txt");
    expect(previewArguments("write_file", '{"file_path":"packages/core/src/state/out.ts"}')).toBe(
      "…/state/out.ts",
    );
  });

  it("keeps the real command even when a description argument is present (approval fidelity)", () => {
    expect(
      previewArguments("run_command", '{"cmd":"rm -rf build","description":"Clean caches"}'),
    ).toBe("$ rm -rf build");
  });

  it("falls back to the single-line raw arguments for other tools", () => {
    expect(previewArguments("search", '{"q": "a\n b"}')).toBe('{"q": "a b"}');
  });
});

describe("shortenPath", () => {
  it("keeps at most one parent directory plus the filename", () => {
    expect(shortenPath("file.ts")).toBe("file.ts");
    expect(shortenPath("src/file.ts")).toBe("src/file.ts");
    expect(shortenPath("/etc/hosts")).toBe("/etc/hosts");
    expect(shortenPath("packages/core/src/state/default-config.ts")).toBe(
      "…/state/default-config.ts",
    );
  });
});

describe("headerSubtitle", () => {
  it("shows the description for the command/subagent tools when present", () => {
    expect(headerSubtitle("run_command", '{"cmd":"ls","description":"List workspace files"}')).toBe(
      "List workspace files",
    );
    expect(headerSubtitle("exec_command", '{"cmd":"ls","description":"Legacy name"}')).toBe(
      "Legacy name",
    );
    expect(
      headerSubtitle("run_subagent", '{"prompt":"p","description":"Delegating research"}'),
    ).toBe("Delegating research");
    expect(
      headerSubtitle("input_command", '{"process_id":"proc-1","description":"Poll the build"}'),
    ).toBe("Poll the build");
    expect(
      headerSubtitle("input_subagent", '{"subagent_id":"s-1","description":"Follow up"}'),
    ).toBe("Follow up");
  });

  it("is null when the description is absent or empty (call_description off = the model never sends it)", () => {
    expect(headerSubtitle("run_command", '{"cmd":"ls"}')).toBeNull();
    expect(headerSubtitle("run_command", '{"cmd":"ls","description":""}')).toBeNull();
  });

  it("shows the shortened file path for the file tools and nothing for others", () => {
    expect(headerSubtitle("read_file", '{"file_path":"src/app.py"}')).toBe("src/app.py");
    expect(headerSubtitle("edit_file", '{"file_path":"packages/web/src/a.tsx"}')).toBe(
      "…/src/a.tsx",
    );
    expect(headerSubtitle("write_file", '{"file_path":"out.md"}')).toBe("out.md");
    expect(headerSubtitle("search", '{"q":"x"}')).toBeNull();
  });

  it("folds a multi-line description to one line", () => {
    expect(headerSubtitle("run_command", '{"cmd":"ls","description":"one\\ntwo"}')).toBe("one two");
  });
});

describe("pendingFilePayload", () => {
  it("decodes the edit_file rewrite so the approval block shows it", () => {
    const payload = pendingFilePayload(
      "edit_file",
      JSON.stringify({ file_path: "src/app.py", old_string: "a\nb", new_string: "a\nc" }),
    );
    expect(payload).toBe("file_path: src/app.py\nold_string:\na\nb\nnew_string:\na\nc");
  });

  it("decodes write_file content and read_file window arguments", () => {
    expect(pendingFilePayload("write_file", '{"file_path":"out.md","content":"hello"}')).toBe(
      "file_path: out.md\ncontent: hello",
    );
    expect(pendingFilePayload("read_file", '{"file_path":"a.txt","offset":3,"limit":5}')).toBe(
      "file_path: a.txt\noffset: 3\nlimit: 5",
    );
  });

  it("returns null for non-file tools and incomplete JSON", () => {
    expect(pendingFilePayload("run_command", '{"cmd":"ls"}')).toBeNull();
    expect(pendingFilePayload("edit_file", '{"file_path":"a.txt","old_str')).toBeNull();
  });
});
