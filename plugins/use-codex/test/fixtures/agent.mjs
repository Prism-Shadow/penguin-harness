import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
const session = {
  sessionId: "fixture-session",
  modes: {
    currentModeId: "read-only",
    availableModes: [{ id: "read-only", name: "Human approval" }],
  },
};
agent({ name: "test-agent" })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    authMethods: [{ id: "chat-gpt-device-code", name: "Device" }],
    agentCapabilities: { sessionCapabilities: { resume: {}, close: {} }, auth: { logout: {} } },
  }))
  .onRequest("authentication/status", { parse: (value) => value }, () => ({ type: "chat-gpt" }))
  .onRequest(methods.agent.session.new, () => session)
  .onRequest(methods.agent.session.resume, () => session)
  .onRequest(methods.agent.session.setMode, () => ({}))
  .onRequest(methods.agent.session.prompt, async (ctx) => {
    await ctx.client.notify(methods.client.session.update, {
      sessionId: session.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } },
    });
    const result = await ctx.client.request(
      methods.client.session.requestPermission,
      {
        sessionId: session.sessionId,
        toolCall: { toolCallId: "tool", title: "Edit", status: "pending" },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      },
      { cancellationSignal: ctx.signal },
    );
    return { stopReason: result.outcome.outcome === "cancelled" ? "cancelled" : "end_turn" };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
