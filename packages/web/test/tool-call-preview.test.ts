/**
 * tool-call-card.tsx preview helpers: previewArguments keeps the real arguments (what heads
 * the approval row), headerSubtitle surfaces the model-written `description` argument for
 * the command/subagent tools and the shortened file path for the file tools, and
 * pendingFilePayload decodes the file-tool arguments so a pending approval shows the actual
 * rewrite. All must tolerate incomplete mid-stream JSON; headerSubtitle additionally holds a
 * still-streaming field back until its closing quote so the header never jitters (#137).
 * isDetachedCall and showsBackgroundAction decide the background mark and the "move to
 * background" button from the same row's facts.
 */
import { describe, expect, it } from "vitest";
import {
  headerSubtitle,
  isBackgroundCall,
  isDetachedCall,
  pendingFilePayload,
  previewArguments,
  shortenPath,
  showsBackgroundAction,
} from "../src/features/chat/tool-call-card";

describe("previewArguments", () => {
  it("renders exec_command as $ <cmd>", () => {
    expect(previewArguments("exec_command", '{"cmd":"ls -la"}')).toBe("$ ls -la");
    // Mid-stream (incomplete JSON) still extracts the cmd prefix.
    expect(previewArguments("exec_command", '{"cmd":"echo h')).toBe("$ echo h");
  });

  it("previews exec_command's shell text under the `command` alias core also runs", () => {
    expect(previewArguments("exec_command", '{"command":"ls -la"}')).toBe("$ ls -la");
    // `cmd` is what runs when both are present, so it is what the approval row shows.
    expect(previewArguments("exec_command", '{"cmd":"pwd","command":"ls"}')).toBe("$ pwd");
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
      previewArguments("exec_command", '{"cmd":"rm -rf build","description":"Clean caches"}'),
    ).toBe("$ rm -rf build");
  });

  it("previews the historical image tools by their source argument (old Traces)", () => {
    expect(previewArguments("read_image", '{"source":"shots/home.png"}')).toBe("shots/home.png");
    expect(
      previewArguments("describe_image", '{"source":"https://x.test/a/b/c.png","prompt":"?"}'),
    ).toBe("…/b/c.png");
    expect(headerSubtitle("read_image", '{"source":"shots/home.png"}')).toBe("shots/home.png");
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
    expect(
      headerSubtitle("exec_command", '{"cmd":"ls","description":"List workspace files"}'),
    ).toBe("List workspace files");
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
    expect(headerSubtitle("exec_command", '{"cmd":"ls"}')).toBeNull();
    expect(headerSubtitle("exec_command", '{"cmd":"ls","description":""}')).toBeNull();
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
    expect(headerSubtitle("exec_command", '{"cmd":"ls","description":"one\\ntwo"}')).toBe(
      "one two",
    );
  });

  it("holds a still-streaming description back until its closing quote (#137)", () => {
    expect(headerSubtitle("exec_command", '{"description":"Read the con', false)).toBeNull();
    // Closing quote arrived: renders even though later arguments are still streaming.
    expect(
      headerSubtitle("exec_command", '{"description":"Read the config","cmd":"cat co', false),
    ).toBe("Read the config");
  });

  it("holds a still-streaming file path back (shortenPath would rewrite non-monotonically)", () => {
    expect(headerSubtitle("read_file", '{"file_path":"/home/us', false)).toBeNull();
    expect(headerSubtitle("write_file", '{"file_path":"/a/b/c.txt","content":"xx', false)).toBe(
      "…/b/c.txt",
    );
  });

  it("renders whatever is there once the arguments settled, even unterminated (aborted call)", () => {
    expect(headerSubtitle("exec_command", '{"description":"half', true)).toBe("half");
    expect(headerSubtitle("read_file", '{"file_path":"/a/b/c.txt', true)).toBe("…/b/c.txt");
  });

  it("prefers a complete description over the file path when a file tool carries one (user-enabled schema)", () => {
    expect(
      headerSubtitle("read_file", '{"description":"Check the config","file_path":"/a/b/c.ts"}'),
    ).toBe("Check the config");
    // Description still streaming: nothing renders yet — no path-then-description swap.
    expect(headerSubtitle("read_file", '{"description":"Check the co', false)).toBeNull();
    // Empty description falls back to the path.
    expect(headerSubtitle("read_file", '{"description":"","file_path":"/a/b/c.ts"}')).toBe(
      "…/b/c.ts",
    );
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
    // read_file's image branch forwards `prompt` to the vision model: it must be visible too.
    expect(
      pendingFilePayload("read_file", '{"file_path":"shot.png","prompt":"read the error"}'),
    ).toBe("file_path: shot.png\nprompt: read the error");
  });

  it("returns null for non-file tools and incomplete JSON", () => {
    expect(pendingFilePayload("exec_command", '{"cmd":"ls"}')).toBeNull();
    expect(pendingFilePayload("edit_file", '{"file_path":"a.txt","old_str')).toBeNull();
  });
});

describe("isBackgroundCall", () => {
  it("marks exec_command and run_subagent launched with the flag", () => {
    expect(isBackgroundCall('{"cmd":"pnpm dev","run_in_background":true}')).toBe(true);
    expect(isBackgroundCall('{"prompt":"go","run_in_background":true}')).toBe(true);
  });

  it("leaves an ordinary call unmarked, flag absent or false", () => {
    expect(isBackgroundCall('{"cmd":"ls"}')).toBe(false);
    expect(isBackgroundCall('{"cmd":"ls","run_in_background":false}')).toBe(false);
    // Only the real boolean counts: a string "true" is not the argument the tool acts on.
    expect(isBackgroundCall('{"cmd":"ls","run_in_background":"true"}')).toBe(false);
  });

  it("reads nothing from a mid-stream or malformed argument string", () => {
    // The flag is last in both schemas, so a still-growing call has not shown it yet — and a
    // command that merely mentions it is not one that was launched with it.
    expect(isBackgroundCall('{"cmd":"pnpm dev","run_in_background":tr')).toBe(false);
    expect(isBackgroundCall('{"cmd":"grep run_in_background\\": true src"}')).toBe(false);
    expect(isBackgroundCall("")).toBe(false);
  });
});

describe("isDetachedCall", () => {
  it("marks a call whose output carries the note the tool wrote on being moved to the background", () => {
    expect(
      isDetachedCall(
        "building…\n[moved to the background by the user with process_id proc-12ab34cd; its " +
          "completion will arrive as a user message — no need to poll.]",
      ),
    ).toBe(true);
  });

  it("leaves an ordinary or deadline-promoted call unmarked", () => {
    expect(isDetachedCall("done\n[exit code: 0]")).toBe(false);
    // The yield deadline promotes too, but nobody moved that one — it wears no mark today.
    expect(
      isDetachedCall("[process running with process_id proc-12ab34cd; use input_command …]"),
    ).toBe(false);
    expect(isDetachedCall("")).toBe(false);
  });
});

describe("showsBackgroundAction", () => {
  it("offers the action while the two detachable tools execute on a main-session card", () => {
    expect(showsBackgroundAction("exec_command", true, [])).toBe(true);
    expect(showsBackgroundAction("run_subagent", true, [])).toBe(true);
  });

  it("hides it once the call is no longer executing", () => {
    expect(showsBackgroundAction("exec_command", false, [])).toBe(false);
  });

  it("hides it for tools with no background form", () => {
    expect(showsBackgroundAction("read_file", true, [])).toBe(false);
    expect(showsBackgroundAction("input_command", true, [])).toBe(false);
    expect(showsBackgroundAction("mcp__docs__search", true, [])).toBe(false);
  });

  it("hides it on a subagent-nested card: that call lives in the child Session's environment", () => {
    expect(showsBackgroundAction("exec_command", true, ["session-child-12ab34cd"])).toBe(false);
  });
});
