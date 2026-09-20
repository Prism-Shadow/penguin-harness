import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodingAgentManager } from "../src/manager.js";

const CLIENT_INFO = { name: "penguin-test", version: "0.0.0" };

describe("CodingAgentManager over a real subprocess", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("spawns the agent, handshakes, and streams a full turn over stdio", async () => {
    const manager = new CodingAgentManager({
      clientInfo: CLIENT_INFO,
      envFor: () => ({}),
    });
    manager.setDefinitions([
      {
        id: "fake",
        command: process.execPath,
        args: [fileURLToPath(new URL("./agent-main.mjs", import.meta.url))],
      },
    ]);
    const session = await manager.createSession("fake", workspace);
    await manager.prompt(session.sessionId, "hi");
    const view = manager.sessionView(session.sessionId);
    expect(view?.events).toEqual([
      {
        type: "message_chunk",
        sessionId: session.sessionId,
        delta: "hello from subprocess",
      },
      { type: "turn_end", sessionId: session.sessionId, stopReason: "end_turn" },
    ]);
    await manager.disposeSession(session.sessionId);
    manager.dispose();
  });
});
