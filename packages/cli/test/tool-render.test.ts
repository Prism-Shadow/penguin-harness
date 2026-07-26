import { describe, expect, it } from "vitest";
import {
  renderFileToolApprovalPayload,
  renderPartialToolCall,
  shortenPath,
} from "../src/tool-render.js";

describe("renderPartialToolCall — exec_command", () => {
  it("withholds the plain form until the arguments settle, then renders it", () => {
    // A description may still follow the command (models don't always honour schema order),
    // and showing the plain form first would strand it above the described one.
    expect(renderPartialToolCall("exec_command", '{"cmd":')).toBeNull();
    expect(renderPartialToolCall("exec_command", '{"cmd":"l')).toBeNull();
    expect(renderPartialToolCall("exec_command", '{"cmd":"ls"}')).toBe("exec_command <- $ ls");
    // `final` settles the question for an interrupted stream: render what is there.
    expect(renderPartialToolCall("exec_command", '{"cmd":"echo \\"hi\\"', true)).toBe(
      'exec_command <- $ echo "hi"',
    );
  });

  it("renders `exec_command <- {description} ($ {cmd})` when a description is present", () => {
    expect(
      renderPartialToolCall("exec_command", '{"description":"List files","cmd":"ls -la"}'),
    ).toBe("exec_command <- List files ($ ls -la)");
    // Same final form regardless of the model's property order.
    expect(
      renderPartialToolCall("exec_command", '{"cmd":"ls -la","description":"List files"}'),
    ).toBe("exec_command <- List files ($ ls -la)");
    // Multi-line descriptions fold to one line; an empty description falls back to the plain form.
    expect(renderPartialToolCall("exec_command", '{"cmd":"ls","description":"a\\nb"}')).toBe(
      "exec_command <- a b ($ ls)",
    );
    expect(renderPartialToolCall("exec_command", '{"cmd":"ls","description":""}')).toBe(
      "exec_command <- $ ls",
    );
  });

  it("streams the description form append-only when the description arrives first", () => {
    const stages = [
      '{"description":"List fi', // description streams live
      '{"description":"List files"', // description complete
      '{"description":"List files","cmd":"ls', // cmd streaming inside the open parenthesis
      '{"description":"List files","cmd":"ls -la"}', // cmd complete: parenthesis closes
    ];
    const previews = stages.map((s) => renderPartialToolCall("exec_command", s));
    expect(previews[0]).toBe("exec_command <- List fi");
    expect(previews[1]).toBe("exec_command <- List files");
    expect(previews[2]).toBe("exec_command <- List files ($ ls");
    expect(previews[3]).toBe("exec_command <- List files ($ ls -la)");
    for (let i = 1; i < previews.length; i++) {
      expect(previews[i]!.startsWith(previews[i - 1]!)).toBe(true);
    }
  });

  it("never shows the plain form first when the model emits the payload before the description", () => {
    // The regression this guards: a plain line followed by a described one for the same call.
    const stages = [
      '{"cmd":"ls -la', // withheld: a description may still follow
      '{"cmd":"ls -la","description":"List fi', // description streams; payload waits for it
      '{"cmd":"ls -la","description":"List files"}', // settled: payload appended
    ];
    const previews = stages.map((s) => renderPartialToolCall("exec_command", s));
    expect(previews[0]).toBeNull();
    expect(previews[1]).toBe("exec_command <- List fi");
    expect(previews[2]).toBe("exec_command <- List files ($ ls -la)");
    expect(previews[2]!.startsWith(previews[1]!)).toBe(true);
    expect(previews.some((p) => p === "exec_command <- $ ls -la")).toBe(false);
  });
});

describe("renderPartialToolCall — run_subagent", () => {
  it("renders `run_subagent <- {prompt}` and the description form", () => {
    expect(renderPartialToolCall("run_subagent", '{"prompt":')).toBeNull();
    expect(renderPartialToolCall("run_subagent", '{"prompt":"analy')).toBeNull();
    expect(renderPartialToolCall("run_subagent", '{"prompt":"analy', true)).toBe(
      "run_subagent <- analy",
    );
    expect(renderPartialToolCall("run_subagent", '{"prompt":"line1\\nline2"}')).toBe(
      "run_subagent <- line1 line2",
    );
    expect(
      renderPartialToolCall(
        "run_subagent",
        '{"description":"Delegating research","prompt":"do the thing"}',
      ),
    ).toBe("run_subagent <- Delegating research (do the thing)");
  });
});

describe("renderPartialToolCall — input_command / input_subagent", () => {
  it("renders polls (empty chars) without a payload", () => {
    expect(renderPartialToolCall("input_command", '{"process_id":')).toBeNull();
    expect(renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d"}')).toBe(
      "input_command <- proc-1a2b3c4d",
    );
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":""}'),
    ).toBe("input_command <- proc-1a2b3c4d");
  });

  it("renders non-empty chars with visible control characters", () => {
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":"y\\n"}'),
    ).toBe("input_command <- proc-1a2b3c4d << y\\n");
    // U+0003 (Ctrl-C) is rendered in caret notation.
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":"\\u0003"}'),
    ).toBe("input_command <- proc-1a2b3c4d << ^C");
    // Disambiguates literal backslash escapes: chars "a", "\", "n" render as a\\n, distinct from a real newline \n.
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":"a\\\\n"}'),
    ).toBe("input_command <- proc-1a2b3c4d << a\\\\n");
  });

  it("wraps the payload in parentheses after the description", () => {
    expect(
      renderPartialToolCall(
        "input_command",
        '{"description":"Confirm the prompt","process_id":"proc-1a2b3c4d","chars":"y\\n"}',
      ),
    ).toBe("input_command <- Confirm the prompt (proc-1a2b3c4d << y\\n)");
    expect(
      renderPartialToolCall(
        "input_subagent",
        '{"description":"Poll for progress","subagent_id":"subagent-9f8e7d6c"}',
      ),
    ).toBe("input_subagent <- Poll for progress (subagent-9f8e7d6c)");
  });

  it("keeps input_command previews append-only across \\uXXXX delta boundaries", () => {
    // Schema order (description first) keeps the whole call streaming live.
    const stages = [
      '{"description":"Confirm","process_id":"proc-1a2b3c4d","chars":"y',
      '{"description":"Confirm","process_id":"proc-1a2b3c4d","chars":"y\\u0',
      '{"description":"Confirm","process_id":"proc-1a2b3c4d","chars":"y\\u0003',
    ];
    const previews = stages.map((s) => renderPartialToolCall("input_command", s)!);
    expect(previews[0]).toBe("input_command <- Confirm (proc-1a2b3c4d << y");
    // An incomplete \u escape is treated as "stop here" rather than emitting the raw hex as literal text.
    expect(previews[1]).toBe("input_command <- Confirm (proc-1a2b3c4d << y");
    expect(previews[2]).toBe("input_command <- Confirm (proc-1a2b3c4d << y^C");
    for (let i = 1; i < previews.length; i++) {
      expect(previews[i]!.startsWith(previews[i - 1]!)).toBe(true);
    }
  });

  it("renders input_subagent polls and follow-up prompts", () => {
    expect(
      renderPartialToolCall("input_subagent", '{"subagent_id":"subagent-9f8e7d6c","prompt":""}'),
    ).toBe("input_subagent <- subagent-9f8e7d6c");
    expect(
      renderPartialToolCall(
        "input_subagent",
        '{"subagent_id":"subagent-9f8e7d6c","prompt":"continue with the tests"}',
      ),
    ).toBe("input_subagent <- subagent-9f8e7d6c << continue with the tests");
  });

  it("truncates long payload previews and stops growing afterwards", () => {
    const long = "x".repeat(130);
    const capped = renderPartialToolCall(
      "input_subagent",
      `{"subagent_id":"subagent-9f8e7d6c","prompt":"${long}"}`,
    );
    expect(capped).toBe(`input_subagent <- subagent-9f8e7d6c << ${"x".repeat(120)}…`);
    const longer = renderPartialToolCall(
      "input_subagent",
      `{"subagent_id":"subagent-9f8e7d6c","prompt":"${long}yyy"}`,
    );
    expect(longer).toBe(capped);
  });
});

describe("renderPartialToolCall — file tools", () => {
  it("renders `<name> <shortened path>` only once the path is complete", () => {
    expect(renderPartialToolCall("read_file", '{"file_path":')).toBeNull();
    // A still-streaming path is withheld: shortening a growing path would rewrite the line.
    expect(renderPartialToolCall("read_file", '{"file_path":"src/ap')).toBeNull();
    expect(renderPartialToolCall("read_file", '{"file_path":"src/app.py","offset":10}')).toBe(
      "read_file src/app.py",
    );
    expect(
      renderPartialToolCall("edit_file", '{"file_path":"a.txt","old_string":"x","new_string":"y"}'),
    ).toBe("edit_file a.txt");
    expect(
      renderPartialToolCall("write_file", '{"file_path":"packages/core/src/state/out.ts"}'),
    ).toBe("write_file …/state/out.ts");
  });
});

describe("renderPartialToolCall — fallback", () => {
  it("falls back to name(args-prefix) for unknown tools", () => {
    expect(renderPartialToolCall("search", '{"q":"hi')).toBe('search({"q":"hi');
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
    expect(shortenPath("/home/user/project/src/app.py")).toBe("…/src/app.py");
  });
});

describe("renderFileToolApprovalPayload", () => {
  it("prints the decoded edit_file payload with gutters for multi-line fields", () => {
    const payload = renderFileToolApprovalPayload(
      "edit_file",
      JSON.stringify({
        file_path: "src/app.py",
        old_string: "a\nb",
        new_string: "a\nc",
      }),
    );
    expect(payload).toBe(
      [
        "file_path: src/app.py",
        "old_string:",
        "  | a",
        "  | b",
        "new_string:",
        "  | a",
        "  | c",
      ].join("\n"),
    );
  });

  it("prints write_file content and read_file window arguments", () => {
    expect(
      renderFileToolApprovalPayload("write_file", '{"file_path":"out.md","content":"hello"}'),
    ).toBe(["file_path: out.md", "content: hello"].join("\n"));
    expect(
      renderFileToolApprovalPayload("read_file", '{"file_path":"a.txt","offset":3,"limit":5}'),
    ).toBe(["file_path: a.txt", "offset: 3", "limit: 5"].join("\n"));
  });

  it("bounds the payload to a line count with an explicit elision note", () => {
    const content = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`).join("\n");
    const payload = renderFileToolApprovalPayload(
      "write_file",
      JSON.stringify({ file_path: "big.txt", content }),
    )!;
    const lines = payload.split("\n");
    // 24 shown lines + the elision note.
    expect(lines).toHaveLength(25);
    expect(lines[lines.length - 1]).toMatch(/\[… \d+ more lines not shown\]/);
  });

  it("returns null for non-file tools", () => {
    expect(renderFileToolApprovalPayload("exec_command", '{"cmd":"ls"}')).toBeNull();
  });
});
