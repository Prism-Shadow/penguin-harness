/**
 * A real ACP agent subprocess for end-to-end tests: speaks v1 over actual stdio, streams
 * one fixed text chunk per prompt, then ends the turn. Run with node; no arguments needed.
 */
import { Readable, Writable } from "node:stream";
import { agent, methods, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

/** @type {import("@agentclientprotocol/sdk").AgentConnection | undefined} */
let connection;

const app = agent({ name: "fake-agent-subprocess" })
  .onConnect((conn) => {
    connection = conn;
  })
  .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: "sess-1" }))
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    await connection.client.notify(methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "hello from subprocess" },
      },
    });
    return { stopReason: "end_turn" };
  });

app.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
