import { describe, expect, it } from "vitest";
import { renderPartialToolCall } from "../src/tool-render.js";

describe("renderPartialToolCall", () => {
  it("renders partial exec_command args as $ <cmd-so-far>", () => {
    expect(renderPartialToolCall("exec_command", '{"cmd":')).toBeNull();
    expect(renderPartialToolCall("exec_command", '{"cmd":"l')).toBe("$ l");
    expect(renderPartialToolCall("exec_command", '{"cmd":"ls"}')).toBe("$ ls");
    expect(renderPartialToolCall("exec_command", '{"cmd":"echo \\"hi\\"')).toBe('$ echo "hi"');
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
