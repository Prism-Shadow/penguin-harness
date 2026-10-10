/**
 * Behavior tests for the rename_session tool: the default target (the hosting Session),
 * an explicit session_id, an absent host control (fatal), a missing or blank title (fatal
 * through the standard argument error), a host refusal (completed, so the model can pick
 * another id), and a thrown host error (fatal). Drives BuiltinTool.execute directly with a
 * fake SessionControl — the host is the seam the tool talks to.
 */
import { describe, expect, it } from "vitest";
import {
  createRenameSessionTool,
  RENAME_SESSION_NAME,
} from "../src/environment/tools/rename-session.js";
import type { BuiltinTool, ToolResult } from "../src/environment/tools/types.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type {
  EnvironmentServices,
  SessionRenameResult,
  SessionControl,
  ToolDefinitionConfig,
} from "../src/interfaces/index.js";

const DEFINITION: ToolDefinitionConfig = {
  name: RENAME_SESSION_NAME,
  description: "test",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "new title" },
      session_id: { type: "string", description: "target session" },
    },
    required: ["title"],
  },
};

/** Records every rename input and returns the scripted outcome. */
function fakeControl(script: () => SessionRenameResult): {
  control: SessionControl;
  calls: { title: string; sessionId?: string }[];
} {
  const calls: { title: string; sessionId?: string }[] = [];
  return {
    calls,
    control: {
      rename: async (input) => {
        calls.push(input);
        return script();
      },
    },
  };
}

async function run(
  tool: BuiltinTool,
  args: Record<string, unknown>,
): Promise<{ result: ToolResult | void; text: string }> {
  const gen = tool.execute(args, { workspaceDir: "/ws", toolCallId: "c1" });
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

describe("rename_session", () => {
  it("renames the hosting Session when session_id is omitted", async () => {
    const { control, calls } = fakeControl(() => ({
      ok: true,
      sessionId: "s-own",
      title: "Billing audit",
    }));
    const tool = createRenameSessionTool(DEFINITION, {
      sessionControl: control,
    } satisfies EnvironmentServices);

    const { result, text } = await run(tool, { title: "Billing audit" });

    expect(calls).toEqual([{ title: "Billing audit" }]);
    expect(text).toContain('Session s-own titled "Billing audit".');
    expect(result).toBeUndefined();
  });

  it("passes an explicit session_id through to the host", async () => {
    const { control, calls } = fakeControl(() => ({
      ok: true,
      sessionId: "s-other",
      title: "Old run",
    }));
    const tool = createRenameSessionTool(DEFINITION, {
      sessionControl: control,
    } satisfies EnvironmentServices);

    await run(tool, { title: "Old run", session_id: "s-other" });

    expect(calls).toEqual([{ title: "Old run", sessionId: "s-other" }]);
  });

  it("treats an absent Session control as fatal", async () => {
    const tool = createRenameSessionTool(DEFINITION);

    const { result, text } = await run(tool, { title: "X" });

    expect(text).toContain("[rename_session unavailable");
    expect(result).toEqual({ stopReason: "fatal" });
  });

  it("treats a missing or blank title as a fatal argument error", async () => {
    const { control, calls } = fakeControl(() => ({
      ok: true,
      sessionId: "s",
      title: "x",
    }));
    const tool = createRenameSessionTool(DEFINITION, {
      sessionControl: control,
    } satisfies EnvironmentServices);

    const { result, text } = await run(tool, { title: "   " });

    expect(calls).toEqual([]);
    expect(text).toContain(RENAME_SESSION_NAME);
    expect(text).toContain("title");
    expect(result).toEqual({ stopReason: "fatal" });
  });

  it("reports a host refusal and completes so the model can try another id", async () => {
    const { control } = fakeControl(() => ({
      ok: false,
      code: "session_not_found",
      message: "no such Session in this Project",
    }));
    const tool = createRenameSessionTool(DEFINITION, {
      sessionControl: control,
    } satisfies EnvironmentServices);

    const { result, text } = await run(tool, {
      title: "X",
      session_id: "s-nope",
    });

    expect(text).toContain("[rename_session refused: session_not_found");
    expect(text).toContain("no such Session in this Project");
    expect(result).toBeUndefined();
  });

  it("treats a thrown host error as fatal", async () => {
    const control: SessionControl = {
      rename: async () => {
        throw new Error("db down");
      },
    };
    const tool = createRenameSessionTool(DEFINITION, {
      sessionControl: control,
    } satisfies EnvironmentServices);

    const { result, text } = await run(tool, { title: "X" });

    expect(text).toContain("[rename_session error: db down]");
    expect(result).toEqual({ stopReason: "fatal" });
  });
});
