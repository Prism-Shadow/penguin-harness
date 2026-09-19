import { describe, expect, it, vi } from "vitest";
import { AcpConnection } from "../src/connection.js";
import { AcpAgentError } from "../src/types.js";
import { FakeCodingAgent } from "./fake-agent.js";
import type { AgentSessionEvent } from "../src/types.js";

const CLIENT_INFO = { name: "penguin-test", version: "0.0.0" };

/** Pair a kernel connection with a fake agent and collect its events. */
function pair(fake: FakeCodingAgent): {
  connection: AcpConnection;
  events: AgentSessionEvent[];
} {
  const events: AgentSessionEvent[] = [];
  const connection = AcpConnection.inProcess(fake.app, CLIENT_INFO, {
    onEvent: (event) => events.push(event),
    onPermissionRequest: () => Promise.resolve({ outcome: { outcome: "cancelled" } }),
  });
  return { connection, events };
}

describe("AcpConnection", () => {
  it("initializes, creates a session, and streams a turn's chunks in order", async () => {
    const fake = new FakeCodingAgent();
    fake.promptHandler = async (_ctx, sessionId) => {
      await fake.say(sessionId, "hello ");
      await fake.say(sessionId, "world");
      return "end_turn" as const;
    };
    const { connection, events } = pair(fake);
    await connection.initialize();
    const session = await connection.newSession("/tmp/ws");
    const stop = await connection.prompt(session.sessionId, "hi");
    expect(stop).toBe("end_turn");
    expect(events).toEqual([
      { type: "message_chunk", sessionId: session.sessionId, delta: "hello " },
      { type: "message_chunk", sessionId: session.sessionId, delta: "world" },
    ]);
    connection.dispose();
  });

  it("maps thinking, tool calls, and usage updates onto the neutral vocabulary", async () => {
    const fake = new FakeCodingAgent();
    fake.promptHandler = async (_ctx, sessionId) => {
      await fake.think(sessionId, "pondering");
      await fake.toolCall(sessionId, {
        toolCallId: "t1",
        title: "read_file — src/a.ts",
        kind: "read",
        status: "completed",
        rawInput: { path: "src/a.ts" },
      });
      return "end_turn" as const;
    };
    const { connection, events } = pair(fake);
    await connection.initialize();
    const session = await connection.newSession("/tmp/ws");
    await connection.prompt(session.sessionId, "hi");
    expect(events).toEqual([
      { type: "thought_chunk", sessionId: session.sessionId, delta: "pondering" },
      {
        type: "tool_call",
        sessionId: session.sessionId,
        call: {
          toolCallId: "t1",
          title: "read_file — src/a.ts",
          kind: "read",
          status: "completed",
          rawInput: { path: "src/a.ts" },
          locations: [],
        },
      },
    ]);
    connection.dispose();
  });

  it("refuses an agent speaking an unsupported protocol version", async () => {
    const fake = new FakeCodingAgent();
    fake.protocolVersionOverride = 99;
    const { connection } = pair(fake);
    await expect(connection.initialize()).rejects.toBeInstanceOf(AcpAgentError);
  });

  it("announces closure when the agent side goes away", async () => {
    const fake = new FakeCodingAgent();
    const { connection, events } = pair(fake);
    await connection.initialize();
    connection.dispose();
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: "state", state: "closed" });
    });
  });
});
