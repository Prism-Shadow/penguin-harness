import { describe, expect, it } from "vitest";
import { Readable, Writable } from "node:stream";
import { toolCall } from "@prismshadow/penguin-core";
import type { OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core";
import { makeApprove, promptApproval, resolveApprovalMode } from "../src/approval.js";
import { getMessages } from "../src/i18n.js";

const t = getMessages("en");

/** An in-memory writable stream that collects everything written to output. */
function collector(): { stream: Writable; text: () => string } {
  let buf = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
}

// mock_read_only_tool is only used for approval-mode tests, not a real tool; its permission is read-only ("r").
const readTool = (): OmniMessage<ToolCallPayload> =>
  toolCall({ name: "mock_read_only_tool", arguments: '{"path":"a"}', toolCallId: "r1" });
const writeTool = (): OmniMessage<ToolCallPayload> =>
  toolCall({ name: "run_command", arguments: '{"cmd":"rm x"}', toolCallId: "w1" });

const perms: Record<string, "r" | "rw"> = {
  mock_read_only_tool: "r",
  run_command: "rw",
};
const toolPermission = (name: string): "r" | "rw" | undefined => perms[name];

describe("promptApproval", () => {
  it('returns "allow" when the user types "y"', async () => {
    const { stream, text } = collector();
    const decision = await promptApproval({
      input: Readable.from(["y\n"]),
      output: stream,
      t,
    });
    expect(decision).toBe("allow");
    // Output is exactly the approval prompt itself — no input echo, no repeated tool-call rendering.
    expect(text()).toBe("? Approve this tool call? [Y/n] ");
  });

  it('returns "allow" on empty input (Enter) — tool approval defaults to yes', async () => {
    const { stream } = collector();
    const decision = await promptApproval({
      input: Readable.from(["\n"]),
      output: stream,
      t,
    });
    expect(decision).toBe("allow");
  });

  it('returns "allow" for "yes" (case-insensitive, trimmed)', async () => {
    const { stream } = collector();
    const decision = await promptApproval({
      input: Readable.from(["  YES  \n"]),
      output: stream,
      t,
    });
    expect(decision).toBe("allow");
  });

  it('returns "deny" when the user types "n"', async () => {
    const { stream } = collector();
    const decision = await promptApproval({
      input: Readable.from(["n\n"]),
      output: stream,
      t,
    });
    expect(decision).toBe("deny");
  });

  it('returns "allow" for unrelated input (tool approval defaults to yes)', async () => {
    const { stream } = collector();
    const decision = await promptApproval({
      input: Readable.from(["maybe\n"]),
      output: stream,
      t,
    });
    expect(decision).toBe("allow");
  });

  it('returns "deny" when the input stream ends (EOF) instead of hanging', async () => {
    const { stream } = collector();
    const decision = await promptApproval({
      input: Readable.from([]),
      output: stream,
      t,
    });
    expect(decision).toBe("deny");
  });
});

describe("resolveApprovalMode", () => {
  it("maps --approve values; defaults to allow-all", () => {
    expect(resolveApprovalMode("allow-all", t)).toBe("allow-all");
    expect(resolveApprovalMode("read-only", t)).toBe("read-only");
    expect(resolveApprovalMode("deny-all", t)).toBe("deny-all");
    expect(resolveApprovalMode("always-ask", t)).toBe("always-ask");
    expect(resolveApprovalMode("READ-ONLY", t)).toBe("read-only");
    expect(resolveApprovalMode(undefined, t)).toBe("allow-all");
  });
});

describe("makeApprove permission modes", () => {
  it("allow-all → allows everything", async () => {
    const approve = makeApprove({
      mode: "allow-all",
      toolPermission,
      interactivePrompt: async () => "deny",
    });
    expect(await approve(readTool())).toBe("allow");
    expect(await approve(writeTool())).toBe("allow");
  });

  it("deny-all → rejects everything", async () => {
    const approve = makeApprove({
      mode: "deny-all",
      toolPermission,
      interactivePrompt: async () => "allow",
    });
    expect(await approve(readTool())).toBe("deny");
    expect(await approve(writeTool())).toBe("deny");
  });

  it("read-only → auto-allows read-only tools, prompts for the rest", async () => {
    let prompted = 0;
    const approve = makeApprove({
      mode: "read-only",
      toolPermission,
      interactivePrompt: async () => {
        prompted += 1;
        return "deny";
      },
    });
    // Read-only tools are auto-allowed without prompting.
    expect(await approve(readTool())).toBe("allow");
    expect(prompted).toBe(0);
    // Read-write tools are handed off to the interactive prompt (denied here).
    expect(await approve(writeTool())).toBe("deny");
    expect(prompted).toBe(1);
  });

  it("always-ask → always delegates to the interactive prompt", async () => {
    let prompted = 0;
    const approve = makeApprove({
      mode: "always-ask",
      toolPermission,
      interactivePrompt: async () => {
        prompted += 1;
        return "allow";
      },
    });
    expect(await approve(readTool())).toBe("allow");
    expect(await approve(writeTool())).toBe("allow");
    expect(prompted).toBe(2);
  });
});
