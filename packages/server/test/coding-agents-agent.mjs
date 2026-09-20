/**
 * A real ACP agent subprocess for the coding-agents API tests: v1 over stdio, one fixed
 * text chunk per prompt, then end_turn. Run with node.
 */
import { Readable, Writable } from "node:stream";
import { agent, methods, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

/** @type {import("@agentclientprotocol/sdk").AgentConnection | undefined} */
let connection;

const app = agent({ name: "fake-agent-test" })
  .onConnect((conn) => {
    connection = conn;
  })
  .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: `sess-${Date.now()}` }))
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    await connection.client.notify(methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from subprocess" },
      },
    });
    return { stopReason: "end_turn" };
  })
  .onRequest(methods.agent.session.close, () => ({}));

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
