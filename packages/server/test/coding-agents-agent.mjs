/**
 * A real ACP agent subprocess for the coding-agents API tests: v1 over stdio, one fixed
 * text chunk per prompt, then end_turn, plus a Model config option that can be set.
 * Run with node.
 */
import { existsSync, writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import {
  agent,
  methods,
  PROTOCOL_VERSION,
  ndJsonStream,
  RequestError,
} from "@agentclientprotocol/sdk";

/** @type {import("@agentclientprotocol/sdk").AgentConnection | undefined} */
let connection;
let turns = 0;

const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "balanced",
    options: [
      { value: "balanced", name: "Balanced" },
      { value: "fast", name: "Fast" },
    ],
  },
  {
    id: "plan",
    name: "Planning",
    type: "boolean",
    currentValue: false,
  },
];

const app = agent({ name: "fake-agent-test" })
  .onConnect((conn) => {
    connection = conn;
  })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    // FAKE_NO_RESUME plays an agent that cannot reopen a session at all.
    agentCapabilities: process.env.FAKE_NO_RESUME ? {} : { sessionCapabilities: { resume: {} } },
  }))
  // Any id reopens: the fixture keeps no history, which is what session/resume allows.
  .onRequest(methods.agent.session.resume, () => ({ configOptions }))
  .onRequest(methods.agent.session.new, () => ({
    sessionId: `sess-${Date.now()}`,
    configOptions,
  }))
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    const text = ctx.params.prompt
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join("");
    // The connection test's smoke prompt: FAKE_TEST_REPLY says what to answer (default ok),
    // and "ask" makes the agent ask for permission first, which a test must refuse.
    if (text === "Reply with only the word: ok") {
      if (process.env.FAKE_TEST_REPLY === "ask") {
        await connection.client.request(methods.client.session.requestPermission, {
          sessionId: ctx.params.sessionId,
          toolCall: { toolCallId: "t-test", title: "Run something", kind: "execute" },
          options: [{ optionId: "yes", name: "Allow", kind: "allow_once" }],
        });
      }
      if (process.env.FAKE_TEST_REPLY === "hang") await new Promise(() => {});
      // "error" fails the turn the way Claude Code does when its sign-in has lapsed, naming
      // the agent's own key in the reason so the test can check it is masked.
      // FAKE_SIGNIN_FAIL_ONCE names a marker file: the first turn anywhere fails its
      // sign-in and leaves the marker, so every later turn succeeds.
      const failOnce = process.env.FAKE_SIGNIN_FAIL_ONCE;
      if (failOnce && !existsSync(failOnce)) {
        writeFileSync(failOnce, "failed");
        throw new RequestError(-32603, "Internal error: Failed to authenticate: expired", {
          errorKind: "authentication_failed",
        });
      }
      if (process.env.FAKE_TEST_REPLY === "error") {
        throw new RequestError(
          -32603,
          `Internal error: Failed to authenticate with key ${process.env.FAKE_API_KEY}`,
          { errorKind: "authentication_failed" },
        );
      }
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "text",
            text:
              process.env.FAKE_TEST_REPLY && process.env.FAKE_TEST_REPLY !== "ask"
                ? process.env.FAKE_TEST_REPLY
                : "ok",
          },
        },
      });
      return { stopReason: "end_turn" };
    }
    // A marker prompt exercises permission: the agent asks before writing, and says what
    // it was told.
    if (text === "ask permission") {
      const answer = await connection.client.request(methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: {
          toolCallId: "perm-tool",
          title: "Write notes.txt",
          kind: "edit",
          // FAKE_ASK_PATH names where the write would land, as a real agent's ask does.
          ...(process.env.FAKE_ASK_PATH
            ? { locations: [{ path: process.env.FAKE_ASK_PATH }] }
            : {}),
        },
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "no", name: "Reject", kind: "reject_once" },
        ],
      });
      const allowed = answer.outcome.outcome === "selected" && answer.outcome.optionId === "yes";
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: allowed ? "wrote it" : "did not write it" },
        },
      });
      return { stopReason: "end_turn" };
    }
    // A marker prompt exercises the tool-call projection: one call, then its completion.
    if (text === "run a tool") {
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tool-1",
          title: "Read package.json",
          kind: "read",
          status: "pending",
        },
      });
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tool-1",
          status: "completed",
        },
      });
    }
    await connection.client.notify(methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from subprocess" },
      },
    });
    // FAKE_USAGE plays an agent that reports what each turn used and prices its own work:
    // tokens on the prompt response, and a running cost of 0.25 USD more per turn.
    if (process.env.FAKE_USAGE) {
      turns += 1;
      await connection.client.notify(methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: {
          sessionUpdate: "usage_update",
          used: 130 * turns,
          size: 200000,
          cost: { amount: 0.25 * turns, currency: "USD" },
        },
      });
      return {
        stopReason: "end_turn",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 130, cachedReadTokens: 10 },
      };
    }
    return { stopReason: "end_turn" };
  })
  .onRequest(methods.agent.session.setConfigOption, (ctx) => {
    for (const option of configOptions) {
      if (option.id === ctx.params.configId) option.currentValue = ctx.params.value;
    }
    return { configOptions };
  })
  .onRequest(methods.agent.session.close, () => ({}));

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
