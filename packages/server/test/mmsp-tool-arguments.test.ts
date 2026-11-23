import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  assistantText,
  partialText,
  ContextEngine,
  Environment,
  GenerativeModel,
  userText,
  withOrigin,
  type AmspRecord,
} from "@prismshadow/penguin-core";
import { startMmspServer, textReply } from "./fixtures/mmsp-server.js";

it("dispatches exact-text MMSP arguments, preserves them on the next request, and retries a failed tool on the same conversation", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "mmsp-tool-args-"));
  const file = path.join(workspace, "slides.txt");
  const raw = ' { "cmd" : "echo tool-ready", "unused": 9007199254740993 } ';
  const calls = [
    { name: "read_file", tool_call_id: "read", arguments: JSON.stringify({ file_path: file }) },
    { name: "exec_command", tool_call_id: "exec", arguments: raw },
    {
      name: "run_subagent",
      tool_call_id: "child",
      arguments: JSON.stringify({ prompt: "Check the title" }),
    },
  ];
  const expected = calls.map((call) => call.arguments);
  const usage = { prompt_tokens: 4, cached_tokens: 0, response_tokens: 4, thoughts_tokens: 0 };
  let requests = 0;
  const server = await startMmspServer(() => {
    const n = ++requests;
    if (n === 2 || n === 4)
      return textReply(n === 2 ? "The file is missing." : "Read the deck.", usage);
    return {
      events: [
        ...calls.slice(0, n === 1 ? 1 : calls.length).map((call) => ({
          role: "assistant",
          event_type: "delta",
          content_items: [{ type: "tool_call.done", ...call }],
          usage_metadata: null,
          finish_reason: null,
        })),
        {
          role: "assistant",
          event_type: "stop",
          content_items: [],
          usage_metadata: usage,
          finish_reason: "tool_call",
        },
      ],
    };
  });
  const environment = new Environment({
    workspaceDir: workspace,
    toolConfig: {
      customTools: calls.map(({ name }) => ({
        name,
        description: name,
        parameters: { type: "object" },
        permission: "rw",
      })),
      mcpServers: [],
    },
    services: {
      subagentRunner: {
        async spawn() {
          return {
            sessionId: "child_session",
            async *run({ messages }) {
              expect(messages[0]?.payload).toMatchObject({ text: "Check the title" });
              yield withOrigin(partialText("delta", "Checked the title."), "child_session");
              yield withOrigin(assistantText("Checked the title."), "child_session");
              return null;
            },
            dispose() {},
          };
        },
      },
    },
  });
  try {
    const llm = new GenerativeModel({
      modelId: "gemini-4-argon",
      clientType: "mmsp",
      baseUrl: server.baseUrl,
      tools: await environment.listTools(),
    });
    const engine = new ContextEngine({ llm, environment, maxTurns: 3 });
    const inputs: string[] = [];
    const run = async (prompt: string) => {
      const records: AmspRecord[] = [];
      for await (const record of engine.run([userText(prompt)], {
        approve: async () => "allow",
        preToolUse: async (call) => {
          inputs.push(call.payload.arguments);
          return null;
        },
      }))
        records.push(record);
      return records.filter((r) => !r.origin?.length).map((r) => r.payload);
    };
    const first = await run("Check the deck");
    expect(first).toContainEqual(
      expect.objectContaining({ type: "tool_call_output", status: "fatal" }),
    );
    await writeFile(file, "Deck title", "utf8");
    const second = await run("Retry the deck");
    expect(inputs).toEqual([expected[0], ...expected]);
    expect(second.filter((p) => "type" in p && p.type === "tool_call_output")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          output: expect.stringContaining("Deck title"),
          status: "completed",
        }),
        expect.objectContaining({
          output: expect.stringContaining("tool-ready"),
          status: "completed",
        }),
        expect.objectContaining({
          output: expect.stringContaining("Checked the title."),
          status: "completed",
        }),
      ]),
    );
    expect(second).toContainEqual(
      expect.objectContaining({ type: "text", text: "Read the deck." }),
    );
    const history = server.requests
      .at(-1)!
      .messages.flatMap((m) => m.content_items)
      .filter((item) => item.type === "tool_call.done");
    expect(history.map((item) => (item as { arguments?: unknown }).arguments)).toEqual([
      expected[0],
      ...expected,
    ]);
    expect(requests).toBe(4);
  } finally {
    await environment.dispose();
    await server.close();
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
