import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodingAgentManager } from "../src/manager.js";
import { AcpConnection } from "../src/connection.js";
import { AcpAgentError, parseDefinition } from "../src/types.js";
import { FakeCodingAgent } from "./fake-agent.js";
import type { AgentSessionEvent } from "../src/types.js";

const CLIENT_INFO = { name: "penguin-test", version: "0.0.0" };

interface Harness {
  manager: CodingAgentManager;
  fake: FakeCodingAgent;
  events: AgentSessionEvent[];
}

function harness(options: {
  modes?: { currentModeId: string; availableModes: { id: string; name: string }[] };
  configOptions?: import("@agentclientprotocol/sdk").SessionConfigOption[];
  permissionTimeoutMs?: number;
}): Harness {
  const fake = new FakeCodingAgent({
    modes: options.modes,
    configOptions: options.configOptions,
  });
  const events: AgentSessionEvent[] = [];
  const manager = new CodingAgentManager({
    clientInfo: CLIENT_INFO,
    envFor: () => ({}),
    permissionTimeoutMs: options.permissionTimeoutMs,
    createConnection: async (_definition, handlers) => {
      // Forward the kernel's events into the test's array as well as the manager's log.
      const wrapped: typeof handlers = {
        onPermissionRequest: handlers.onPermissionRequest,
        onEvent: (event) => {
          events.push(event);
          handlers.onEvent(event);
        },
      };
      return AcpConnection.inProcess(fake.app, CLIENT_INFO, wrapped);
    },
  });
  manager.setDefinitions([{ id: "fake", command: "fake", title: "Fake Agent" }]);
  return { manager, fake, events };
}

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-test-"));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("CodingAgentManager", () => {
  it("validates the definition id and workspace before touching a connection", async () => {
    const { manager } = harness({});
    manager.setDefinitions([]);
    await expect(manager.createSession("fake", workspace)).rejects.toBeInstanceOf(AcpAgentError);
    manager.setDefinitions([{ id: "fake", command: "fake" }]);
    await expect(manager.createSession("fake", "relative/path")).rejects.toBeInstanceOf(
      AcpAgentError,
    );
    await expect(
      manager.createSession("fake", path.join(workspace, "missing")),
    ).rejects.toBeInstanceOf(AcpAgentError);
  });

  it("runs a turn: chunks land in the log, and the view rebuilds the transcript", async () => {
    const { manager, fake } = harness({});
    fake.promptHandler = async (_ctx, sessionId) => {
      await fake.say(sessionId, "one ");
      await fake.say(sessionId, "two");
      return "end_turn" as const;
    };
    const session = await manager.createSession("fake", workspace);
    await manager.prompt(session.sessionId, "hi");
    const view = manager.sessionView(session.sessionId);
    expect(view?.busy).toBe(false);
    expect(view?.events).toEqual([
      { type: "message_chunk", sessionId: session.sessionId, delta: "one " },
      { type: "message_chunk", sessionId: session.sessionId, delta: "two" },
      { type: "turn_end", sessionId: session.sessionId, stopReason: "end_turn" },
    ]);
  });

  it("advertises session modes from session/new and keeps the list on mode updates", async () => {
    const { manager, fake } = harness({
      modes: {
        currentModeId: "ask",
        availableModes: [
          { id: "ask", name: "Ask" },
          { id: "auto", name: "Auto" },
        ],
      },
    });
    const session = await manager.createSession("fake", workspace);
    expect(session.events[0]).toEqual({
      type: "modes",
      sessionId: session.sessionId,
      modes: {
        currentModeId: "ask",
        modes: [
          { id: "ask", name: "Ask" },
          { id: "auto", name: "Auto" },
        ],
      },
    });
    // A local mode switch logs the merged state; the advertised list must survive it.
    await manager.setMode(session.sessionId, "auto");
    const view = manager.sessionView(session.sessionId);
    const last = view?.events.at(-1);
    expect(last).toMatchObject({ type: "modes", modes: { currentModeId: "auto" } });
    const modes = (last as { modes: { modes: unknown[] } }).modes;
    expect(modes.modes).toHaveLength(2);
  });

  it("surfaces config options from session/new and sets them by id", async () => {
    const { manager, fake } = harness({
      configOptions: [
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
        { id: "plan", name: "Planning", type: "boolean", currentValue: false },
      ],
    });
    const session = await manager.createSession("fake", workspace);
    const view = manager.sessionView(session.sessionId);
    expect(view?.configOptions.map((o) => o.id)).toEqual(["model", "plan"]);
    expect(view?.events.filter((e) => e.type === "config_options")).toHaveLength(1);

    await manager.setConfigOption(session.sessionId, "model", "fast");
    expect(fake.setConfigRequests).toEqual([{ configId: "model", value: "fast" }]);
    expect(manager.sessionView(session.sessionId)?.configOptions[0]?.currentValue).toBe("fast");

    // A live agent-pushed set lands in the log and becomes the session's state.
    await fake.pushConfigOptions(session.sessionId);
    const after = manager.sessionView(session.sessionId);
    // Creation, the set's reply, and the pushed update: one logged set each.
    expect(after?.events.filter((e) => e.type === "config_options")).toHaveLength(3);
  });

  it("refuses a second concurrent prompt on the same session", async () => {
    const { manager, fake } = harness({});
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.promptHandler = async () => {
      await gate;
      return "end_turn" as const;
    };
    const session = await manager.createSession("fake", workspace);
    const first = manager.prompt(session.sessionId, "hi");
    await expect(manager.prompt(session.sessionId, "again")).rejects.toBeInstanceOf(AcpAgentError);
    release();
    await first;
  });

  it("bridges permission asks to waiters and delivers the chosen option", async () => {
    const { manager, fake } = harness({});
    fake.promptHandler = async (_ctx, sessionId) => {
      const answer = await fake.askPermission(sessionId);
      return answer.outcome.outcome === "selected" && answer.outcome.optionId === "allow"
        ? ("end_turn" as const)
        : ("cancelled" as const);
    };
    const session = await manager.createSession("fake", workspace);
    const turn = manager.prompt(session.sessionId, "hi");
    await vi.waitFor(() => {
      expect(
        manager.sessionView(session.sessionId)?.events.some((e) => e.type === "permission_request"),
      ).toBe(true);
    });
    const events = manager.sessionView(session.sessionId)!.events;
    const requestEvent = events.find(
      (e): e is Extract<AgentSessionEvent, { type: "permission_request" }> =>
        e.type === "permission_request",
    );
    expect(requestEvent).toBeDefined();
    const request = requestEvent!.request;
    expect(request.requestId).toMatch(/^perm-/);
    expect(request.toolCall.title).toBe("Run tests");
    expect(
      manager.respondPermission(request.requestId, { outcome: "selected", optionId: "allow" }),
    ).toBe(true);
    await turn;
    expect(fake.answeredPermissions).toEqual([
      { outcome: { outcome: "selected", optionId: "allow" } },
    ]);
    expect(
      manager.sessionView(session.sessionId)!.events.some((e) => e.type === "permission_resolved"),
    ).toBe(true);
  });

  it("auto-cancels an unanswered permission ask after the timeout", async () => {
    const { manager, fake } = harness({ permissionTimeoutMs: 30 });
    fake.promptHandler = async (_ctx, sessionId) => {
      const answer = await fake.askPermission(sessionId);
      return answer.outcome.outcome === "cancelled"
        ? ("end_turn" as const)
        : ("cancelled" as const);
    };
    const session = await manager.createSession("fake", workspace);
    await manager.prompt(session.sessionId, "hi");
    expect(manager.respondPermission("perm-1", { outcome: "selected", optionId: "allow" })).toBe(
      false,
    );
  });

  it("cancels agent elicitation with a notice instead of answering it", async () => {
    const { manager, fake } = harness({});
    fake.promptHandler = async (_ctx, sessionId) => {
      const answer = await fake.askElicitation(sessionId);
      return answer.action === "cancel" ? ("end_turn" as const) : ("cancelled" as const);
    };
    const session = await manager.createSession("fake", workspace);
    await manager.prompt(session.sessionId, "hi");
    const elicitationEvents = manager.sessionView(session.sessionId)!.events;
    expect(elicitationEvents).toContainEqual({
      type: "notice",
      sessionId: null,
      message: "Sign in to continue",
    });
  });

  it("forwards session/cancel to the agent and reports the cancelled stop", async () => {
    const { manager, fake } = harness({});
    fake.promptHandler = async (_ctx, sessionId) => {
      // Hang until the kernel's cancel notification arrives, then end cancelled.
      while (!fake.cancelNotifications.includes(sessionId)) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return "cancelled" as const;
    };
    const session = await manager.createSession("fake", workspace);
    const turn = manager.prompt(session.sessionId, "hi");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await manager.cancel(session.sessionId);
    await turn;
    const view = manager.sessionView(session.sessionId);
    expect(view?.events.at(-1)).toEqual({
      type: "turn_end",
      sessionId: session.sessionId,
      stopReason: "cancelled",
    });
    expect(view?.busy).toBe(false);
  });

  it("keeps the definition's connection open across sessions and closes it with the last one", async () => {
    const { manager, fake } = harness({});
    const sessionA = await manager.createSession("fake", workspace);
    const sessionB = await manager.createSession("fake", workspace);
    expect(sessionA.sessionId).not.toBe(sessionB.sessionId);
    await manager.disposeSession(sessionA.sessionId);
    expect(manager.sessionView(sessionA.sessionId)).toBeUndefined();
    expect(manager.listSessions()).toHaveLength(1);
    await manager.disposeSession(sessionB.sessionId);
    expect(manager.listSessions()).toHaveLength(0);
    // The process is gone with the last session; a further turn cannot start.
    await expect(manager.prompt(sessionB.sessionId, "hi")).rejects.toBeInstanceOf(AcpAgentError);
  });

  it("announces a failed turn when the agent connection dies mid-turn", async () => {
    const { manager, fake } = harness({});
    let kernelConnection: AcpConnection | undefined;
    const manager2 = new CodingAgentManager({
      clientInfo: CLIENT_INFO,
      envFor: () => ({}),
      createConnection: async (_definition, handlers) => {
        kernelConnection = AcpConnection.inProcess(fake.app, CLIENT_INFO, handlers);
        return kernelConnection;
      },
    });
    manager2.setDefinitions([{ id: "fake", command: "fake" }]);
    fake.promptHandler = () =>
      new Promise<never>(() => {
        // Hangs until the connection dies.
      });
    const session = await manager2.createSession("fake", workspace);
    const turn = manager2.prompt(session.sessionId, "hi");
    await new Promise((resolve) => setTimeout(resolve, 10));
    kernelConnection?.dispose();
    await expect(turn).rejects.toBeInstanceOf(AcpAgentError);
    const events = manager2.sessionView(session.sessionId)!.events;
    expect(events.some((e) => e.type === "turn_end" && e.stopReason === "failed")).toBe(true);
    // The connection's own closure is announced after the failed turn.
    expect(events.at(-1)).toMatchObject({ type: "state", state: "closed" });
  });
});

describe("parseDefinition", () => {
  it("accepts a well-formed definition and rejects malformed ones", () => {
    expect(
      parseDefinition({ id: "codex", command: "node", args: ["a.mjs"], env: { K: "v" } }),
    ).toEqual({
      id: "codex",
      command: "node",
      args: ["a.mjs"],
      env: { K: "v" },
    });
    expect(() => parseDefinition("nope")).toThrow();
    expect(() => parseDefinition({ id: "bad id!", command: "x" })).toThrow();
    expect(() => parseDefinition({ id: "ok", command: "" })).toThrow();
    expect(() => parseDefinition({ id: "ok", command: "x", args: [1] })).toThrow();
    expect(() => parseDefinition({ id: "ok", command: "x", env: { K: 3 } })).toThrow();
  });
});
