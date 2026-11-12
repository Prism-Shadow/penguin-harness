/**
 * What a compaction's tool rounds may run, as the Agent composes it (internal/compaction-tool-gate).
 *
 * - Given `read_file`, it is allowed wherever it points: the sandbox's read rules still apply.
 * - Given `write_file` / `edit_file` on an absolute path inside the Session's scratchpad, it is
 *   allowed; on a relative path (which resolves to the Workspace), a path outside, a `..` walk
 *   out, a sibling directory sharing the prefix, the scratchpad itself, or arguments with no
 *   path, it is refused with the reason that names what is allowed.
 * - Given any other tool (a command, a subagent), it is refused.
 * - On Windows the comparison takes either separator and ignores case.
 */
import { describe, expect, it } from "vitest";
import { toolCall } from "@prismshadow/amsp/records";
import {
  COMPACTION_TOOL_REFUSAL,
  compactionToolGate,
} from "../src/internal/compaction-tool-gate.js";

const call = (name: string, args: unknown) =>
  toolCall({
    name,
    arguments: typeof args === "string" ? args : JSON.stringify(args),
    toolCallId: "c1",
  });

describe("the compaction tool gate", () => {
  const pad = "/data/agents/a/scratchpad/s1";
  const gate = compactionToolGate(pad, "linux");

  it.each([
    ["read_file anywhere", call("read_file", { file_path: "/etc/hosts" })],
    ["a hand-off write", call("write_file", { file_path: `${pad}/handoff/plan.md`, content: "x" })],
    ["an edit inside", call("edit_file", { file_path: `${pad}/notes.md`, old_string: "a" })],
    ["a .. that stays inside", call("write_file", { file_path: `${pad}/handoff/../plan.md` })],
  ])("allows %s", (_label, tc) => {
    expect(gate(tc)).toEqual({ allow: true });
  });

  it.each([
    ["a command", call("exec_command", { cmd: "ls" })],
    ["a subagent", call("run_subagent", { prompt: "go" })],
    ["a relative path", call("write_file", { file_path: "handoff/plan.md" })],
    ["a path outside", call("write_file", { file_path: "/data/agents/a/agent_state/AGENTS.md" })],
    ["a .. walk out", call("edit_file", { file_path: `${pad}/../s2/plan.md` })],
    ["a sibling sharing the prefix", call("write_file", { file_path: `${pad}-other/plan.md` })],
    ["the scratchpad itself", call("write_file", { file_path: pad })],
    ["no path", call("write_file", { content: "x" })],
    ["arguments that do not parse", call("edit_file", "{not json")],
  ])("refuses %s, naming what is allowed", (_label, tc) => {
    expect(gate(tc)).toEqual({ allow: false, reason: COMPACTION_TOOL_REFUSAL });
  });

  it("on Windows takes either separator and ignores case", () => {
    const win = compactionToolGate("C:\\Users\\u\\penguin\\scratchpad\\s1", "win32");
    expect(
      win(call("write_file", { file_path: "c:/users/U/penguin/scratchpad/s1/handoff/a.md" })),
    ).toEqual({ allow: true });
    expect(
      win(call("write_file", { file_path: "C:\\Users\\u\\penguin\\scratchpad\\s2\\a.md" })),
    ).toEqual({ allow: false, reason: COMPACTION_TOOL_REFUSAL });
  });
});
