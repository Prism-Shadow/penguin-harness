import { describe, expect, it } from "vitest";
import { renderPartialToolCall } from "../src/tool-render.js";

describe("renderPartialToolCall", () => {
  it("renders partial run_command args as $ <cmd-so-far>", () => {
    expect(renderPartialToolCall("run_command", '{"cmd":')).toBeNull();
    expect(renderPartialToolCall("run_command", '{"cmd":"l')).toBe("$ l");
    expect(renderPartialToolCall("run_command", '{"cmd":"ls"}')).toBe("$ ls");
    expect(renderPartialToolCall("run_command", '{"cmd":"echo \\"hi\\"')).toBe('$ echo "hi"');
  });

  it("renders the legacy exec_command name the same way (old traces / pre-rename agents)", () => {
    expect(renderPartialToolCall("exec_command", '{"cmd":"ls"}')).toBe("$ ls");
    expect(renderPartialToolCall("exec_command", '{"cmd":"l')).toBe("$ l");
  });

  it("appends the description argument as a suffix only once the arguments are complete", () => {
    // Streaming (incomplete JSON): the description is withheld — appending it while cmd may
    // still grow would rewrite the middle of the append-only preview.
    expect(renderPartialToolCall("run_command", '{"description":"List files","cmd":"ls -l')).toBe(
      "$ ls -l",
    );
    // Complete JSON: the suffix appends onto the settled base, in both property orders.
    expect(
      renderPartialToolCall("run_command", '{"description":"List files","cmd":"ls -la"}'),
    ).toBe("$ ls -la — List files");
    expect(
      renderPartialToolCall("run_command", '{"cmd":"ls -la","description":"List files"}'),
    ).toBe("$ ls -la — List files");
    // Multi-line descriptions fold to one line; an empty description adds nothing.
    expect(renderPartialToolCall("run_command", '{"cmd":"ls","description":"a\\nb"}')).toBe(
      "$ ls — a b",
    );
    expect(renderPartialToolCall("run_command", '{"cmd":"ls","description":""}')).toBe("$ ls");
  });

  it("appends the description for the input/subagent tools too", () => {
    expect(
      renderPartialToolCall(
        "input_command",
        '{"process_id":"proc-1a2b3c4d","chars":"y\\n","description":"Confirm the prompt"}',
      ),
    ).toBe("⌨ input_command → proc-1a2b3c4d << y\\n — Confirm the prompt");
    expect(
      renderPartialToolCall(
        "run_subagent",
        '{"prompt":"do the thing","description":"Delegating research"}',
      ),
    ).toBe("run_subagent << do the thing — Delegating research");
    expect(
      renderPartialToolCall(
        "input_subagent",
        '{"subagent_id":"subagent-9f8e7d6c","description":"Poll for progress"}',
      ),
    ).toBe("⌨ input_subagent → subagent-9f8e7d6c — Poll for progress");
  });

  it("renders the file tools as <name> <file_path>", () => {
    expect(renderPartialToolCall("read_file", '{"file_path":')).toBeNull();
    expect(renderPartialToolCall("read_file", '{"file_path":"src/ap')).toBe("read_file src/ap");
    expect(renderPartialToolCall("read_file", '{"file_path":"src/app.py","offset":10}')).toBe(
      "read_file src/app.py",
    );
    expect(
      renderPartialToolCall("edit_file", '{"file_path":"a.txt","old_string":"x","new_string":"y"}'),
    ).toBe("edit_file a.txt");
    expect(
      renderPartialToolCall("write_file", '{"file_path":"out/report.md","content":"# hi"}'),
    ).toBe("write_file out/report.md");
  });

  it("renders run_subagent as run_subagent << <prompt>, folded to one line", () => {
    expect(renderPartialToolCall("run_subagent", '{"prompt":')).toBeNull();
    expect(renderPartialToolCall("run_subagent", '{"prompt":"analy')).toBe("run_subagent << analy");
    expect(renderPartialToolCall("run_subagent", '{"prompt":"line1\\nline2"}')).toBe(
      "run_subagent << line1 line2",
    );
  });

  it("renders input_command polls (empty chars) without a payload", () => {
    expect(renderPartialToolCall("input_command", '{"process_id":')).toBeNull();
    expect(renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d"}')).toBe(
      "⌨ input_command → proc-1a2b3c4d",
    );
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":""}'),
    ).toBe("⌨ input_command → proc-1a2b3c4d");
  });

  it("renders non-empty input_command chars with visible control characters", () => {
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":"y\\n"}'),
    ).toBe("⌨ input_command → proc-1a2b3c4d << y\\n");
    // U+0003 (Ctrl-C) is rendered in caret notation.
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":"\\u0003"}'),
    ).toBe("⌨ input_command → proc-1a2b3c4d << ^C");
    // Disambiguates literal backslash escapes: chars "a", "\", "n" render as a\\n, distinct from a real newline \n.
    expect(
      renderPartialToolCall("input_command", '{"process_id":"proc-1a2b3c4d","chars":"a\\\\n"}'),
    ).toBe("⌨ input_command → proc-1a2b3c4d << a\\\\n");
  });

  it("keeps input_command previews append-only across \\uXXXX delta boundaries", () => {
    const stages = [
      '{"process_id":"proc-1a2b3c4d","chars":"y',
      '{"process_id":"proc-1a2b3c4d","chars":"y\\u0',
      '{"process_id":"proc-1a2b3c4d","chars":"y\\u0003',
    ];
    const previews = stages.map((s) => renderPartialToolCall("input_command", s)!);
    expect(previews[0]).toBe("⌨ input_command → proc-1a2b3c4d << y");
    // An incomplete \u escape is treated as "stop here" rather than emitting the raw hex as literal text.
    expect(previews[1]).toBe("⌨ input_command → proc-1a2b3c4d << y");
    expect(previews[2]).toBe("⌨ input_command → proc-1a2b3c4d << y^C");
    for (let i = 1; i < previews.length; i++) {
      expect(previews[i]!.startsWith(previews[i - 1]!)).toBe(true);
    }
  });

  it("renders input_subagent polls without a payload and follow-up prompts with one", () => {
    expect(
      renderPartialToolCall("input_subagent", '{"subagent_id":"subagent-9f8e7d6c","prompt":""}'),
    ).toBe("⌨ input_subagent → subagent-9f8e7d6c");
    expect(
      renderPartialToolCall(
        "input_subagent",
        '{"subagent_id":"subagent-9f8e7d6c","prompt":"continue with the tests"}',
      ),
    ).toBe("⌨ input_subagent → subagent-9f8e7d6c << continue with the tests");
  });

  it("truncates long payload previews and stops growing afterwards", () => {
    const long = "x".repeat(130);
    const capped = renderPartialToolCall(
      "input_subagent",
      `{"subagent_id":"subagent-9f8e7d6c","prompt":"${long}"}`,
    );
    expect(capped).toBe(`⌨ input_subagent → subagent-9f8e7d6c << ${"x".repeat(120)}…`);
    const longer = renderPartialToolCall(
      "input_subagent",
      `{"subagent_id":"subagent-9f8e7d6c","prompt":"${long}yyy"}`,
    );
    expect(longer).toBe(capped);
  });

  it("falls back to name(args-prefix) for unknown tools", () => {
    expect(renderPartialToolCall("search", '{"q":"hi')).toBe('search({"q":"hi');
  });
});
