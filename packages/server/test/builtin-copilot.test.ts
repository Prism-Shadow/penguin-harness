/**
 * Built-in Copilot over HTTP against a local registry: setup downloads and registers a
 * coding agent that starts over ACP, one download for concurrent clicks, token replace and
 * removal, admin-only, and a stable state for an unsupported or failed download.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BuiltinAgentsResponse,
  CodingAgentTestResult,
  CodingAgentsResponse,
} from "../src/api/types.js";
import {
  COPILOT_VERSION,
  copilotPackageName,
  isMuslLinux,
} from "../src/coding-agents/builtin/copilot-package.js";
import { apiClient, createTestApp, loginAdmin, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { fakeRegistry, type FakeRegistry } from "./fixtures/builtin-registry.js";

const PAT = "github_pat_11EXAMPLE0000000000000000abcd";

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = await read();
    if (done(value)) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("state never settled");
}

describe("built-in copilot", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let registry: FakeRegistry;
  const packageName = copilotPackageName(process.platform, process.arch, isMuslLinux())!;

  beforeEach(async () => {
    registry = await fakeRegistry({ packageName, version: COPILOT_VERSION });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "member_b")).cookie);
  });
  afterEach(async () => {
    delete process.env.PENGUIN_NPM_REGISTRY;
    await t.cleanup();
    await registry.close();
  });

  const state = async () =>
    ((await (await admin.get("/api/coding-agents/builtin")).json()) as BuiltinAgentsResponse)
      .agents[0]!;

  it("starts not set up, admin-only", async () => {
    expect((await member.get("/api/coding-agents/builtin")).status).toBe(403);
    expect(await state()).toMatchObject({
      id: "copilot",
      status: "not-installed",
      tokenMasked: null,
    });
  });

  it("sets up from a PAT: one download, a registered agent that passes Test", async () => {
    const [a, b] = await Promise.all([
      admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT }),
      admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT }),
    ]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    const ready = await until(state, (s) => s.status !== "downloading");
    expect(ready).toMatchObject({
      status: "ready",
      installedVersion: COPILOT_VERSION,
      tokenMasked: "gith…abcd",
    });
    expect(registry.requests.filter((r) => r.endsWith(".tgz"))).toHaveLength(1);

    const agents = (
      (await (await admin.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse
    ).agents;
    const builtin = agents.find((x) => x.id === "copilot-builtin")!;
    expect(builtin).toMatchObject({
      title: "GitHub Copilot (built-in)",
      args: ["--acp"],
      builtin: "copilot",
    });
    expect(builtin.env!.map((e) => e.key).sort()).toEqual(["COPILOT_GITHUB_TOKEN", "COPILOT_HOME"]);

    const test = (await (
      await admin.post("/api/coding-agents/agents/copilot-builtin/test", {})
    ).json()) as CodingAgentTestResult;
    expect(test.failure).not.toBe("start");
  });

  it("requires a token for the first setup, and keeps the stored one after", async () => {
    expect((await admin.post("/api/coding-agents/builtin/copilot/setup", {})).status).toBe(400);
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    await until(state, (s) => s.status !== "downloading");
    expect((await admin.post("/api/coding-agents/builtin/copilot/setup", {})).status).toBe(202);
    expect((await until(state, (s) => s.status !== "downloading")).tokenMasked).toBe("gith…abcd");
  });

  it("replaces the token and removes everything", async () => {
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    await until(state, (s) => s.status !== "downloading");
    const replaced = await admin.put("/api/coding-agents/builtin/copilot/token", {
      token: "github_pat_22OTHER00000000000000000wxyz",
    });
    expect(replaced.status).toBe(200);
    expect((await state()).tokenMasked).toBe("gith…wxyz");
    expect((await admin.delete("/api/coding-agents/builtin/copilot")).status).toBe(204);
    expect(await state()).toMatchObject({ status: "not-installed", tokenMasked: null });
    const agents = (
      (await (await admin.get("/api/coding-agents/agents")).json()) as CodingAgentsResponse
    ).agents;
    expect(agents.some((x) => x.id === "copilot-builtin")).toBe(false);
  });

  it("reports a failed download and keeps no half install", async () => {
    await registry.close();
    registry = await fakeRegistry({ packageName, version: COPILOT_VERSION, corrupt: true });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    const failed = await until(state, (s) => s.status !== "downloading");
    expect(failed.status).toBe("failed");
    expect(failed.message).toMatch(/checksum/);
    expect(failed.installedVersion).toBeNull();
  });
  it("never answers with the token itself", async () => {
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    await until(state, (s) => s.status !== "downloading");
    for (const route of ["/api/coding-agents/builtin", "/api/coding-agents/agents"]) {
      expect(await (await admin.get(route)).text()).not.toContain(PAT);
    }
  });

  it("cancels a download without reporting a failure", async () => {
    await registry.close();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    registry = await fakeRegistry({ packageName, version: COPILOT_VERSION, hold });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    const started = await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    expect(((await started.json()) as { agent: { status: string } }).agent.status).toBe(
      "downloading",
    );
    expect((await admin.post("/api/coding-agents/builtin/copilot/cancel", {})).status).toBe(204);
    release();
    expect(await until(state, (s) => s.status !== "downloading")).toMatchObject({
      status: "not-installed",
      message: null,
      installedVersion: null,
    });
  });

  it("removes mid-download, leaving no runtime behind", async () => {
    await registry.close();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    registry = await fakeRegistry({ packageName, version: COPILOT_VERSION, hold });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    const removed = admin.delete("/api/coding-agents/builtin/copilot");
    release();
    expect((await removed).status).toBe(204);
    expect(await state()).toMatchObject({ status: "not-installed", tokenMasked: null });
    await expect(fs.access(path.join(t.root, "runtimes", "copilot"))).rejects.toThrow();
  });

  it("says a replaced token waits for the running sessions to end", async () => {
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    expect(await until(state, (s) => s.status !== "downloading")).toMatchObject({
      status: "ready",
      envPending: false,
    });
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "copilot-builtin",
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { sessionId: string } };
    expect((await state()).envPending).toBe(false);
    await admin.put("/api/coding-agents/builtin/copilot/token", {
      token: "github_pat_22OTHER00000000000000000wxyz",
    });
    expect(await state()).toMatchObject({ tokenMasked: "gith…wxyz", envPending: true });
    expect((await admin.delete(`/api/coding-agents/sessions/${session.sessionId}`)).status).toBe(
      204,
    );
    expect((await state()).envPending).toBe(false);
  });

  it("refuses Remove while a session uses it, and removes once it closes", async () => {
    await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
    await until(state, (s) => s.status !== "downloading");
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "copilot-builtin",
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: { sessionId: string } };
    const refused = await admin.delete("/api/coding-agents/builtin/copilot");
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain(
      "Close the sessions using built-in Copilot before removing it.",
    );
    expect(await state()).toMatchObject({ status: "ready", tokenMasked: "gith…abcd" });
    await fs.access(path.join(t.root, "runtimes", "copilot", COPILOT_VERSION));

    await admin.delete(`/api/coding-agents/sessions/${session.sessionId}`);
    expect((await admin.delete("/api/coding-agents/builtin/copilot")).status).toBe(204);
    expect(await state()).toMatchObject({ status: "not-installed", tokenMasked: null });
  });

  it("refuses an unknown built-in agent", async () => {
    expect(
      (await admin.post("/api/coding-agents/builtin/other/setup", { token: PAT })).status,
    ).toBe(404);
  });
});

describe("built-in copilot across a restart", () => {
  it("restores the install and sweeps leftovers", async () => {
    const packageName = copilotPackageName(process.platform, process.arch, isMuslLinux())!;
    const registry = await fakeRegistry({ packageName, version: COPILOT_VERSION });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    const root = await makeTempRoot();
    const config = { root, dbPath: path.join(root, "web.db") };
    let second: TestApp | undefined;
    try {
      const first = await createTestApp({ config });
      const admin = apiClient(first.app, (await loginAdmin(first.app)).cookie);
      await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
      await until(
        async () =>
          ((await (await admin.get("/api/coding-agents/builtin")).json()) as BuiltinAgentsResponse)
            .agents[0]!,
        (s) => s.status !== "downloading",
      );
      // Shut the first app down without deleting its root, as a process exit would.
      first.deps.hmr.dispose();
      first.deps.channels.dispose();
      first.deps.db.close();
      const runtimes = path.join(root, "runtimes", "copilot");
      await fs.mkdir(path.join(runtimes, ".incoming-deadbeef"), { recursive: true });
      await fs.mkdir(path.join(runtimes, "0.0.1"), { recursive: true });

      second = await createTestApp({ config });
      const again = apiClient(second.app, (await loginAdmin(second.app)).cookie);
      const restored = (
        (await (await again.get("/api/coding-agents/builtin")).json()) as BuiltinAgentsResponse
      ).agents[0]!;
      expect(restored).toMatchObject({
        status: "ready",
        installedVersion: COPILOT_VERSION,
        tokenMasked: "gith…abcd",
      });
      expect((await fs.readdir(runtimes)).sort()).toEqual([COPILOT_VERSION]);
    } finally {
      delete process.env.PENGUIN_NPM_REGISTRY;
      if (second !== undefined) await second.cleanup();
      else await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await registry.close();
    }
  });

  it("reports a missing program as failed, keeps the token, and downloads it again", async () => {
    const packageName = copilotPackageName(process.platform, process.arch, isMuslLinux())!;
    const registry = await fakeRegistry({ packageName, version: COPILOT_VERSION });
    process.env.PENGUIN_NPM_REGISTRY = registry.url;
    const root = await makeTempRoot();
    const config = { root, dbPath: path.join(root, "web.db") };
    let second: TestApp | undefined;
    const read = async (client: ReturnType<typeof apiClient>) =>
      ((await (await client.get("/api/coding-agents/builtin")).json()) as BuiltinAgentsResponse)
        .agents[0]!;
    try {
      const first = await createTestApp({ config });
      const admin = apiClient(first.app, (await loginAdmin(first.app)).cookie);
      await admin.post("/api/coding-agents/builtin/copilot/setup", { token: PAT });
      await until(
        () => read(admin),
        (s) => s.status !== "downloading",
      );
      first.deps.hmr.dispose();
      first.deps.channels.dispose();
      first.deps.db.close();
      // Quarantined, cleared or moved: the definition survives, the program does not.
      await fs.rm(path.join(root, "runtimes", "copilot"), { recursive: true, force: true });

      second = await createTestApp({ config });
      const again = apiClient(second.app, (await loginAdmin(second.app)).cookie);
      expect(await read(again)).toMatchObject({
        status: "failed",
        installedVersion: null,
        tokenMasked: "gith…abcd",
        message: "The Copilot program is missing. Try again to download it.",
      });
      // Try again with the stored token.
      expect((await again.post("/api/coding-agents/builtin/copilot/setup", {})).status).toBe(202);
      expect(
        await until(
          () => read(again),
          (s) => s.status !== "downloading",
        ),
      ).toMatchObject({
        status: "ready",
        installedVersion: COPILOT_VERSION,
        tokenMasked: "gith…abcd",
        message: null,
      });
    } finally {
      delete process.env.PENGUIN_NPM_REGISTRY;
      if (second !== undefined) await second.cleanup();
      else await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await registry.close();
    }
  });
});
