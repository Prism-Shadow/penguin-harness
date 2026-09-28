/**
 * Coding-agents API integration tests: definition CRUD (admin-only writes, validation),
 * session lifecycle over a REAL spawned ACP agent subprocess (spawn -> handshake ->
 * prompt -> streamed update -> turn end), permission and mode routes against absent
 * resources, and disposal. Kernel-level behavior (event vocabulary, permission bridging)
 * is covered by packages/coding-agents' own suite; these tests pin the HTTP surface and
 * the server-side wiring.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CodingAgentDiscoveryResponse,
  CodingAgentSessionDetailResponse,
  CodingAgentSessionInfo,
  CodingAgentTestResult,
  CodingAgentsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT_MAIN = fileURLToPath(new URL("./coding-agents-agent.mjs", import.meta.url));

async function waitForTurnEnd(
  client: ReturnType<typeof apiClient>,
  sessionId: string,
): Promise<CodingAgentSessionDetailResponse> {
  for (let i = 0; i < 100; i++) {
    const res = await client.get(`/api/coding-agents/sessions/${sessionId}`);
    const detail = (await res.json()) as CodingAgentSessionDetailResponse;
    if (detail.events.some((e) => e.type === "turn_end")) return detail;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("turn never ended");
}

describe("coding agents api", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let workspace: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await loginAdmin(t.app);
    const b = await provisionUser(t.app, "member_b");
    admin = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-api-"));
    const res = await admin.post("/api/coding-agents/agents", {
      id: "fake",
      title: "Fake Agent",
      command: process.execPath,
      args: [AGENT_MAIN],
    });
    expect(res.status).toBe(201);
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await t.cleanup();
  });

  it("lists saved definitions for any authenticated user", async () => {
    const res = await member.get("/api/coding-agents/agents");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CodingAgentsResponse;
    expect(body.agents).toEqual([
      { id: "fake", title: "Fake Agent", command: process.execPath, args: [AGENT_MAIN] },
    ]);
  });

  it("restricts definition writes to admins and validates the body", async () => {
    expect((await member.post("/api/coding-agents/agents", { id: "x", command: "x" })).status).toBe(
      403,
    );
    expect((await member.delete("/api/coding-agents/agents/fake")).status).toBe(403);
    expect(
      (await admin.post("/api/coding-agents/agents", { id: "bad id!", command: "x" })).status,
    ).toBe(400);
    expect((await admin.post("/api/coding-agents/agents", { id: "no-cmd" })).status).toBe(400);
  });

  // Shape-only assertions: what the machine really has installed must not decide the test.
  // The cached read is what the card view is built from, so it is any-user; the live
  // refresh below stays admin-only.
  it("probes the server machine for known agents (any user, cached)", async () => {
    expect((await member.get("/api/coding-agents/discover")).status).toBe(200);
    const res = await admin.get("/api/coding-agents/discover");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CodingAgentDiscoveryResponse;
    expect(body.candidates.map((c) => c.recipeId)).toEqual(
      expect.arrayContaining(["gemini", "claude", "codex"]),
    );
    // The cheap read executes nothing, so it carries no probed options.
    expect(body.agentModels).toEqual({});
    for (const candidate of body.candidates) {
      expect(candidate.homepageUrl).toMatch(/^https:\/\//);
      expect(candidate.authHint).not.toBe("");
      expect(typeof candidate.detected).toBe("boolean");
      if (candidate.launch === null) {
        expect(candidate.setupHint).not.toBe("");
      } else {
        expect(path.isAbsolute(candidate.launch.command)).toBe(true);
        expect(candidate.setupHint).toBeNull();
      }
    }
  });

  it("flags a recipe whose definition id is already saved", async () => {
    await admin.post("/api/coding-agents/agents", { id: "gemini", command: "gemini" });
    const res = await admin.get("/api/coding-agents/discover");
    const body = (await res.json()) as CodingAgentDiscoveryResponse;
    const byRecipe = new Map(body.candidates.map((c) => [c.recipeId, c]));
    expect(byRecipe.get("gemini")?.alreadyAdded).toBe(true);
    expect(byRecipe.get("codex")?.alreadyAdded).toBe(false);
  });

  it("gates the probed rescan to admins", async () => {
    expect((await member.post("/api/coding-agents/discover/refresh?timeoutMs=500")).status).toBe(
      403,
    );
    // Admin refresh runs the live probes; bounded so the test stays quick.
    const res = await admin.post("/api/coding-agents/discover/refresh?timeoutMs=1500");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CodingAgentDiscoveryResponse;
    expect(body.candidates.length).toBeGreaterThan(0);
  }, 60_000);

  // A saved definition is authoritative for its id: the refresh probes it at its own
  // command (the one its sessions actually run), and the shadowed recipe's launch goes
  // unprobed.
  it("probes saved definitions at their own command on refresh", async () => {
    await admin.post("/api/coding-agents/agents", {
      id: "gemini",
      title: "Fake Gemini",
      command: process.execPath,
      args: [AGENT_MAIN],
    });
    const res = await admin.post("/api/coding-agents/discover/refresh?timeoutMs=5000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CodingAgentDiscoveryResponse;
    // Both saved definitions — the beforeEach "fake" and this recipe-shadowing one —
    // report the fake agent's own config options.
    for (const id of ["fake", "gemini"]) {
      expect((body.agentModels[id] ?? []).map((o) => o.id)).toEqual(["model", "plan"]);
    }
    const gemini = body.candidates.find((c) => c.recipeId === "gemini");
    expect(gemini?.models).toBeUndefined();
  }, 60_000);

  // A plain read must keep what the last refresh learned (it is saved, so a restart keeps
  // it too), including why an agent would not start, which only admins are shown.
  it("keeps the last refresh's models and failures for later reads", async () => {
    await admin.post("/api/coding-agents/agents", {
      id: "broken",
      command: process.execPath,
      args: ["-e", "process.exit(1)"],
    });
    expect((await admin.post("/api/coding-agents/discover/refresh?timeoutMs=5000")).status).toBe(
      200,
    );
    const later = (await (
      await admin.get("/api/coding-agents/discover")
    ).json()) as CodingAgentDiscoveryResponse;
    expect(typeof later.probedAt).toBe("number");
    expect((later.agentModels.fake ?? []).map((o) => o.id)).toEqual(["model", "plan"]);
    expect(later.agentErrors?.broken).toMatch(/exited|handshake|session options/);
    const seen = (await (
      await member.get("/api/coding-agents/discover")
    ).json()) as CodingAgentDiscoveryResponse;
    // Members learn that it failed, not why.
    expect(seen.agentErrors?.broken).toBe("");
    expect(seen.candidates.every((c) => !c.probeError)).toBe(true);
    // Removing the agent forgets its failure: a re-saved one is judged afresh.
    expect((await admin.delete("/api/coding-agents/agents/broken")).status).toBe(204);
    const after = (await (
      await admin.get("/api/coding-agents/discover")
    ).json()) as CodingAgentDiscoveryResponse;
    expect(after.agentErrors?.broken).toBeUndefined();
    expect((after.agentModels.fake ?? []).length).toBeGreaterThan(0);
  }, 60_000);

  // The refresh must not run an agent's npx-fallback launch when the agent itself is
  // absent: probing it would install-and-execute a package nobody on this machine chose.
  it("does not execute an npx fallback launch for an agent the machine lacks", async () => {
    const WIN = process.platform === "win32";
    const isolated = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-iso-"));
    const bin = path.join(isolated, "bin");
    const appData = path.join(isolated, "appdata");
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(appData, { recursive: true });
    // Marker shims: each leaves a file behind the moment it is executed.
    const shim = (marker: string) =>
      WIN ? `@echo ran>"${marker}"\r\n` : `#!/bin/sh\necho ran > "${marker}"\n`;
    const geminiRan = path.join(isolated, "gemini-ran");
    const npxRan = path.join(isolated, "npx-ran");
    await fs.writeFile(path.join(bin, WIN ? "gemini.cmd" : "gemini"), shim(geminiRan), {
      mode: 0o755,
    });
    await fs.writeFile(path.join(bin, WIN ? "npx.cmd" : "npx"), shim(npxRan), { mode: 0o755 });
    // Full machine isolation: PATH plus every home discovery derives install dirs from,
    // so only these shims exist and gemini is the sole detected agent. The OS's own
    // tool dirs stay on PATH — the probes spawn cmd.exe for .cmd shims, and a PATH of
    // only the shim dir would make every probe fail to launch and prove nothing.
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(isolated);
    const envKeys = ["PATH", "APPDATA", "LOCALAPPDATA", "FNM_DIR", "NVM_DIR"];
    const savedEnv = envKeys.map((k) => [k, process.env[k]] as const);
    const osDirs = (savedEnv[0]?.[1] ?? "")
      .split(path.delimiter)
      .filter((d) => (WIN ? /\\windows\\/i.test(d) : /^\/(usr|bin|sbin)/.test(d)));
    process.env.PATH = [bin, ...osDirs].join(path.delimiter);
    process.env.APPDATA = appData;
    process.env.LOCALAPPDATA = appData;
    delete process.env.FNM_DIR;
    delete process.env.NVM_DIR;
    try {
      const res = await admin.post("/api/coding-agents/discover/refresh?timeoutMs=500");
      expect(res.status).toBe(200);
      const body = (await res.json()) as CodingAgentDiscoveryResponse;
      const gemini = body.candidates.find((c) => c.recipeId === "gemini");
      const claude = body.candidates.find((c) => c.recipeId === "claude");
      expect(gemini?.detected).toBe(true);
      expect(claude?.detected).toBe(false);
      // The npx fallback still resolves as the suggested launch — it is just never run.
      expect(claude?.launch?.args).toEqual(["-y", "@agentclientprotocol/claude-agent-acp"]);
    } finally {
      homedir.mockRestore();
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    // The refresh answers only after every probe settled, so a marker now proves an
    // execution happened: gemini was detected (its probe ran); npx never may.
    expect(
      await fs.stat(geminiRan).then(
        () => true,
        () => false,
      ),
    ).toBe(true);
    expect(
      await fs.stat(npxRan).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });

  // The auto-add contract: starting a session for a known, detected-but-unsaved agent
  // persists the recipe-derived definition first — even when the session itself then
  // fails (this shim is not a real agent).
  it("auto-adds a known agent definition on session start", async () => {
    const shimDir = path.join(workspace, "bin");
    await fs.mkdir(shimDir, { recursive: true });
    const shim = path.join(
      shimDir,
      process.platform === "win32" ? "claude-agent-acp.cmd" : "claude-agent-acp",
    );
    await fs.writeFile(
      shim,
      process.platform === "win32" ? "@rem not an agent\r\n" : "#!/bin/sh\n",
      {
        mode: 0o755,
      },
    );
    const previousPath = process.env.PATH;
    process.env.PATH = `${shimDir}${path.delimiter}${previousPath ?? ""}`;
    try {
      const res = await admin.post("/api/coding-agents/sessions", { agentId: "claude" });
      expect([201, 400]).toContain(res.status);
    } finally {
      process.env.PATH = previousPath;
    }
    const agents = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    const claude = agents.agents.find((a) => a.id === "claude");
    expect(claude?.command).toContain(shimDir);
  });

  it("rejects unknown agents and workspaces at session creation", async () => {
    expect(
      (
        await admin.post("/api/coding-agents/sessions", {
          agentId: "nope",
          workspaceDir: workspace,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post("/api/coding-agents/sessions", {
          agentId: "fake",
          workspaceDir: path.join(workspace, "missing"),
        })
      ).status,
    ).toBe(400);
  });

  // The chat-session contract: no folder given, the server allocates its own.
  it("auto-creates a temporary workspace when workspaceDir is omitted", async () => {
    const created = await admin.post("/api/coding-agents/sessions", { agentId: "fake" });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    expect(session.workspaceDir).toMatch(/workspaces[/\\]tmp-[0-9a-f]{8}$/);
    expect((await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)).status).toBe(200);
  });

  it("exposes agent config options and sets them by id", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    const detail = (await (
      await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)
    ).json()) as CodingAgentSessionDetailResponse;
    expect(detail.configOptions.map((o) => o.id)).toEqual(["model", "plan"]);
    expect(detail.configOptions[0]?.currentValue).toBe("balanced");

    const set = await admin.post(`/api/coding-agents/sessions/${session.sessionId}/config`, {
      configId: "model",
      value: "fast",
    });
    expect(set.status).toBe(200);
    const body = (await set.json()) as {
      configOptions: CodingAgentSessionDetailResponse["configOptions"];
    };
    expect(body.configOptions[0]?.currentValue).toBe("fast");

    // The stored detail reflects the new value, and unknown sessions/sessions-gone 404.
    const reread = (await (
      await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)
    ).json()) as CodingAgentSessionDetailResponse;
    expect(reread.configOptions[0]?.currentValue).toBe("fast");
    expect(
      (
        await admin.post("/api/coding-agents/sessions/does-not-exist/config", {
          configId: "m",
          value: "x",
        })
      ).status,
    ).toBe(404);
  });

  // The card's Model pick persists per agent and rides the agents list back out.
  it("remembers other settings for an agent and applies them to its next session", async () => {
    expect(
      (
        await member.put("/api/coding-agents/agents/fake/options", {
          configId: "plan",
          value: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (await admin.put("/api/coding-agents/agents/fake/options", { configId: "plan", value: true }))
        .status,
    ).toBe(204);
    const agents = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    expect(agents.agents.find((a) => a.id === "fake")?.rememberedOptions).toEqual({ plan: true });
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    const detail = (await (
      await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)
    ).json()) as CodingAgentSessionDetailResponse;
    expect(detail.configOptions.find((o) => o.id === "plan")?.currentValue).toBe(true);
  });

  describe("connection test", () => {
    async function testAgent(env: Record<string, string>) {
      await admin.post("/api/coding-agents/agents", {
        id: "probe",
        command: process.execPath,
        args: [AGENT_MAIN],
        env,
      });
      const res = await admin.post("/api/coding-agents/agents/probe/test?timeoutMs=2000", {});
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as CodingAgentTestResult;
    }

    it("passes when the agent answers the smoke prompt with ok, and leaves nothing behind", async () => {
      const result = await testAgent({});
      expect(result).toMatchObject({ ok: true, reply: "ok" });
      expect(result.ms).toBeGreaterThanOrEqual(0);
      const { sessions } = (await (await admin.get("/api/coding-agents/sessions")).json()) as {
        sessions: unknown[];
      };
      expect(sessions).toEqual([]);
    });

    it("fails, quoting the reply, when the agent answers something else", async () => {
      expect(await testAgent({ FAKE_TEST_REPLY: "I cannot do that" })).toMatchObject({
        ok: false,
        failure: "reply",
        reply: "I cannot do that",
      });
    });

    it("refuses a permission ask rather than waiting on it", async () => {
      expect(await testAgent({ FAKE_TEST_REPLY: "ask" })).toMatchObject({ ok: true });
    });

    it("gives up after the time limit", async () => {
      expect(await testAgent({ FAKE_TEST_REPLY: "hang" })).toMatchObject({
        ok: false,
        failure: "timeout",
      });
    }, 20_000);

    it("says the agent could not start when its command does not run", async () => {
      await admin.post("/api/coding-agents/agents", { id: "broken", command: "no-such-agent-cli" });
      const res = await admin.post("/api/coding-agents/agents/broken/test", {});
      expect(await res.json()).toMatchObject({ ok: false, failure: "start" });
    });

    it("is for admins only", async () => {
      expect((await member.post("/api/coding-agents/agents/fake/test", {})).status).toBe(403);
    });
  });

  it("remembers the model an agent was set to", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    expect(
      (
        await admin.put(`/api/coding-agents/agents/fake/model`, {
          configId: "model",
          value: "fast",
          name: "Fast",
        })
      ).status,
    ).toBe(204);
    const agents = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    expect(agents.agents.find((a) => a.id === "fake")?.rememberedModel).toEqual({
      configId: "model",
      value: "fast",
      name: "Fast",
    });
    // A model pick made inside a session is remembered the same way.
    await admin.post(`/api/coding-agents/sessions/${session.sessionId}/config`, {
      configId: "model",
      value: "balanced",
    });
    const agentsAgain = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    expect(agentsAgain.agents.find((a) => a.id === "fake")?.rememberedModel?.value).toBe(
      "balanced",
    );
  });

  // Only the option the card would render as the Model is remembered: a session change
  // to any other config option must not clobber the agent's remembered model.
  it("remembers a session's Model change but not other config changes", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    // Flip the agent's non-model boolean option.
    expect(
      (
        await admin.post(`/api/coding-agents/sessions/${session.sessionId}/config`, {
          configId: "plan",
          value: true,
        })
      ).status,
    ).toBe(200);
    let agents = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    expect(agents.agents.find((a) => a.id === "fake")?.rememberedModel).toBeUndefined();
    // Changing the Model itself is still remembered.
    await admin.post(`/api/coding-agents/sessions/${session.sessionId}/config`, {
      configId: "model",
      value: "fast",
    });
    agents = (await (await admin.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse;
    expect(agents.agents.find((a) => a.id === "fake")?.rememberedModel).toMatchObject({
      configId: "model",
      value: "fast",
    });
  });

  // The remembered model rides into the agent's NEXT session as its initial
  // configuration (applyRememberedModel right after session/new).
  it("starts a new session with the remembered model", async () => {
    expect(
      (
        await admin.put(`/api/coding-agents/agents/fake/model`, {
          configId: "model",
          value: "fast",
        })
      ).status,
    ).toBe(204);
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    const detail = (await (
      await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)
    ).json()) as CodingAgentSessionDetailResponse;
    // The agent itself reports the remembered choice, not the factory default.
    expect(detail.configOptions.find((o) => o.id === "model")?.currentValue).toBe("fast");
  });

  it("drives a full turn against a spawned agent and exposes the transcript", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    expect(session.agentId).toBe("fake");
    expect(session.busy).toBe(false);

    expect(
      (await admin.post(`/api/coding-agents/sessions/${session.sessionId}/prompt`, { text: "hi" }))
        .status,
    ).toBe(202);
    const detail = await waitForTurnEnd(admin, session.sessionId);
    // The fixture advertises a Model config option; the creation event opens the log.
    expect(detail.events[0]).toMatchObject({ type: "config_options" });
    expect(detail.events.slice(1)).toEqual([
      {
        type: "user_message",
        sessionId: session.sessionId,
        text: "hi",
      },
      {
        type: "message_chunk",
        sessionId: session.sessionId,
        delta: "hello from subprocess",
      },
      { type: "turn_end", sessionId: session.sessionId, stopReason: "end_turn" },
    ]);
    // The transcript survives a fresh read (the log, not a live subscription).
    const reread = await admin.get(`/api/coding-agents/sessions/${session.sessionId}`);
    expect(((await reread.json()) as CodingAgentSessionDetailResponse).events).toHaveLength(4);
  });

  it("reopens an earlier session by id and continues it", async () => {
    const res = await admin.post("/api/coding-agents/sessions/resume", {
      agentId: "fake",
      workspaceDir: workspace,
      sessionId: "sess-from-an-earlier-run",
    });
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as { session: CodingAgentSessionInfo };
    expect(session).toMatchObject({
      sessionId: "sess-from-an-earlier-run",
      agentId: "fake",
      resumeSupport: "resume",
    });
    await admin.post(`/api/coding-agents/sessions/${session.sessionId}/prompt`, { text: "hi" });
    const detail = await waitForTurnEnd(admin, session.sessionId);
    expect(detail.events[0]).toMatchObject({ type: "notice" });
    expect(detail.events.at(-1)).toMatchObject({ type: "turn_end", stopReason: "end_turn" });
  });

  it("requires the earlier session's own workspace to reopen it", async () => {
    const res = await admin.post("/api/coding-agents/sessions/resume", {
      agentId: "fake",
      sessionId: "sess-from-an-earlier-run",
    });
    expect(res.status).toBe(400);
  });

  it("downloads the transcript as a Markdown attachment in conversation order", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    await admin.post(`/api/coding-agents/sessions/${session.sessionId}/prompt`, {
      text: "run a tool",
    });
    await waitForTurnEnd(admin, session.sessionId);

    const res = await admin.get(`/api/coding-agents/sessions/${session.sessionId}/transcript`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="penguin-coding-agent-[A-Za-z0-9._-]+\.md"$/,
    );
    const doc = await res.text();
    // H1 names the agent (the definition's title), then the metadata block.
    expect(doc.startsWith("# Fake Agent\n")).toBe(true);
    expect(doc).toContain("- Agent: Fake Agent");
    expect(doc).toContain(`- Session: ${session.sessionId}`);
    expect(doc).toMatch(/- Created: \d{4}-\d{2}-\d{2}T/);
    expect(doc).toContain(`- Workspace: ${workspace}`);
    expect(doc).toContain("- Model: Balanced");
    // The user prompt comes first, the agent's turn after it; the tool call renders as a
    // list item with its latest status, the streamed text as a paragraph.
    const userAt = doc.indexOf("## User");
    const agentAt = doc.indexOf("## Agent");
    expect(userAt).toBeGreaterThan("# Fake Agent".length);
    expect(agentAt).toBeGreaterThan(userAt);
    expect(doc).toContain("run a tool");
    expect(doc).toContain("- Read package.json — completed");
    expect(doc.indexOf("- Read package.json — completed")).toBeLessThan(
      doc.indexOf("hello from subprocess"),
    );
    // Connection noise does not render.
    expect(doc).not.toContain("config_options");
    expect(doc).not.toContain("turn_end");
  });

  it("answers 404 for an unknown session's transcript", async () => {
    const res = await admin.get("/api/coding-agents/sessions/does-not-exist/transcript");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("not_found");
  });

  it("answers 404 for unknown sessions across every session route", async () => {
    const base = "/api/coding-agents/sessions/does-not-exist";
    expect((await admin.get(base)).status).toBe(404);
    expect((await admin.patch(base, { title: "x" })).status).toBe(404);
    expect((await admin.post(`${base}/prompt`, { text: "x" })).status).toBe(404);
    expect((await admin.post(`${base}/cancel`)).status).toBe(404);
    expect((await admin.post(`${base}/mode`, { modeId: "m" })).status).toBe(404);
    expect(
      (await admin.post(`${base}/permissions/perm-1`, { outcome: { outcome: "cancelled" } }))
        .status,
    ).toBe(404);
    expect((await admin.delete(base)).status).toBe(204);
  });

  it("renames a session, clears the rename, and validates the title", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    const base = `/api/coding-agents/sessions/${session.sessionId}`;

    const renamed = await admin.patch(base, { title: "  My session  " });
    expect(renamed.status).toBe(200);
    const renamedSession = ((await renamed.json()) as { session: CodingAgentSessionInfo }).session;
    expect(renamedSession.title).toBe("My session");

    // The title rides the list and names the transcript's H1.
    const listed = (await (await admin.get("/api/coding-agents/sessions")).json()) as {
      sessions: CodingAgentSessionInfo[];
    };
    expect(listed.sessions.find((s) => s.sessionId === session.sessionId)?.title).toBe(
      "My session",
    );
    const transcript = await admin.get(`${base}/transcript`);
    expect((await transcript.text()).startsWith("# My session\n")).toBe(true);

    // Empty clears back to the default (no title at all).
    const cleared = await admin.patch(base, { title: "" });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { session: CodingAgentSessionInfo }).session.title).toBe(
      undefined,
    );
    const clearedTranscript = await admin.get(`${base}/transcript`);
    expect((await clearedTranscript.text()).startsWith("# Fake Agent\n")).toBe(true);

    // Validation: over the cap and non-string titles are caller errors.
    expect((await admin.patch(base, { title: "x".repeat(121) })).status).toBe(400);
    expect((await admin.patch(base, { title: 42 })).status).toBe(400);
    expect((await admin.patch(base, {})).status).toBe(400);
  });

  it("lists and disposes sessions", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    expect((await admin.delete(`/api/coding-agents/sessions/${session.sessionId}`)).status).toBe(
      204,
    );
    expect((await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)).status).toBe(404);
    const sessions = (await (await admin.get("/api/coding-agents/sessions")).json()) as {
      sessions: CodingAgentSessionInfo[];
    };
    expect(sessions.sessions).toHaveLength(0);
  });

  it("keeps the definition registry in settings (reloaded on boot)", async () => {
    const agents = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    expect(agents.agents.map((a) => a.id)).toContain("fake");
  });
});
