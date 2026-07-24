/**
 * tool-call-card.tsx preview helpers: previewArguments keeps the real arguments (what the
 * approval row must show), headerSubtitle surfaces the model-written `description` argument
 * for the command/subagent tools and the file path for the file tools. Both must tolerate
 * incomplete mid-stream JSON.
 */
import { describe, expect, it } from "vitest";
import { headerSubtitle, previewArguments } from "../src/features/chat/tool-call-card";

describe("previewArguments", () => {
  it("renders run_command and the legacy exec_command name as $ <cmd>", () => {
    expect(previewArguments("run_command", '{"cmd":"ls -la"}')).toBe("$ ls -la");
    expect(previewArguments("exec_command", '{"cmd":"ls -la"}')).toBe("$ ls -la");
    // Mid-stream (incomplete JSON) still extracts the cmd prefix.
    expect(previewArguments("run_command", '{"cmd":"echo h')).toBe("$ echo h");
  });

  it("renders the file tools by their file_path", () => {
    expect(previewArguments("read_file", '{"file_path":"src/app.py","offset":3}')).toBe(
      "src/app.py",
    );
    expect(
      previewArguments("edit_file", '{"file_path":"a.txt","old_string":"x","new_string":"y"}'),
    ).toBe("a.txt");
    expect(previewArguments("write_file", '{"file_path":"out.md","content":"hi"}')).toBe("out.md");
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

  it("is null when the description is absent or empty (toggle off = the model never sends it)", () => {
    expect(headerSubtitle("run_command", '{"cmd":"ls"}')).toBeNull();
    expect(headerSubtitle("run_command", '{"cmd":"ls","description":""}')).toBeNull();
  });

  it("shows the file path for the file tools and nothing for others", () => {
    expect(headerSubtitle("read_file", '{"file_path":"src/app.py"}')).toBe("src/app.py");
    expect(headerSubtitle("edit_file", '{"file_path":"a.txt"}')).toBe("a.txt");
    expect(headerSubtitle("write_file", '{"file_path":"out.md"}')).toBe("out.md");
    expect(headerSubtitle("search", '{"q":"x"}')).toBeNull();
  });

  it("folds a multi-line description to one line", () => {
    expect(headerSubtitle("run_command", '{"cmd":"ls","description":"one\\ntwo"}')).toBe("one two");
  });
});
