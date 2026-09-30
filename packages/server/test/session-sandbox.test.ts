/**
 * A Session's sandbox policy is its own: snapshotted at creation, changed only on that Session,
 * and bounded for non-admins by the server's settings. Editing the settings afterwards must
 * not reach a Session that already exists.
 */
import { describe, expect, it } from "vitest";
import { assistantText, sessionMeta, userText, withOrigin } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { SandboxProvider, SandboxSettings } from "@prismshadow/penguin-core/plugin";
import { openDatabase } from "../src/db/database.js";
import { migrate } from "../src/db/migrations.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession, SessionEnv } from "../src/runtime/session-manager.js";
import { SandboxService } from "../src/sandbox/index.js";
import { applySandboxPick, sessionSandboxOf } from "../src/services/session-service.js";

const sqlite = process.getBuiltinModule("node:sqlite");

const ROW: SessionRow = {
  sessionId: "session-1",
  projectId: "p",
  agentId: "a",
  provider: "prov",
  modelId: "m",
  workspace: "/w",
  approvalMode: "allow-all",
  title: null,
  lastActiveAt: "t",
  createdAt: "t",
};

describe("picking a Session's sandbox from the composer", () => {
  const settings: SandboxSettings = {
    mode: "workspace-write",
    network: "none",
    maskPaths: ["/secret"],
    writableTemp: false,
  };

  it("keeps the snapshot's mask paths and temp choice, and lays the picks over it", () => {
    const next = applySandboxPick(settings, { mode: "read-only" }, settings, false);
    expect(next).toEqual({ ...settings, mode: "read-only" });
    expect(sessionSandboxOf(next)).toEqual({
      mode: "read-only",
      network: "none",
      localNetworkSupported: false,
    });
  });

  it("a non-admin cannot loosen past the server's settings, in either dimension", () => {
    expect(() =>
      applySandboxPick(settings, { mode: "danger-full-access" }, settings, false),
    ).toThrow(/Only an administrator/);
    expect(() => applySandboxPick(settings, { network: "open" }, settings, false)).toThrow(
      /Only an administrator/,
    );
  });

  it("the local level is refused where no backend supports it, and ranks between none and open", () => {
    expect(() => applySandboxPick(settings, { network: "local" }, settings, true)).toThrow(
      /localhost/,
    );
    const open: SandboxSettings = { mode: "workspace-write" };
    const local = applySandboxPick(open, { network: "local" }, open, false, true);
    expect(local.network).toBe("local");
    expect(sessionSandboxOf(local, true)).toEqual({
      mode: "workspace-write",
      network: "local",
      localNetworkSupported: true,
    });
    // Under settings of "local", a non-admin may cut the network but not open it.
    const localDefaults: SandboxSettings = { mode: "workspace-write", network: "local" };
    expect(
      applySandboxPick(localDefaults, { network: "none" }, localDefaults, false, true).network,
    ).toBe("none");
    expect(() =>
      applySandboxPick(localDefaults, { network: "open" }, localDefaults, false, true),
    ).toThrow(/Only an administrator/);
    // Under settings of "none", "local" is already looser.
    expect(() => applySandboxPick(settings, { network: "local" }, settings, false, true)).toThrow(
      /Only an administrator/,
    );
  });

  it("a non-admin who tightened may come back to the settings; an admin may go past them", () => {
    const tightened = applySandboxPick(settings, { mode: "read-only" }, settings, false);
    expect(applySandboxPick(tightened, { mode: "workspace-write" }, settings, false).mode).toBe(
      "workspace-write",
    );
    const opened = applySandboxPick(
      settings,
      { mode: "danger-full-access", network: "open" },
      settings,
      true,
    );
    expect(opened.mode).toBe("danger-full-access");
    expect(opened.network).toBeUndefined();
  });
});

describe("the snapshot on the Session's row", () => {
  it("round-trips, updates in place, and reads as absent on a row from before the column", () => {
    const db = openDatabase(":memory:");
    try {
      const repo = wire(SessionsRepo, { db });
      repo.insert({ ...ROW, sandbox: { mode: "read-only", network: "none" } });
      expect(repo.findById("session-1")?.sandbox).toEqual({ mode: "read-only", network: "none" });
      repo.updateSandbox("session-1", { mode: "danger-full-access" });
      expect(repo.findById("session-1")?.sandbox).toEqual({ mode: "danger-full-access" });
      repo.insert({ ...ROW, sessionId: "session-legacy" });
      expect(repo.findById("session-legacy")?.sandbox).toBeNull();
    } finally {
      db.close();
    }
  });

  it("grows the column on the swap path, so a pushed platform can write it", () => {
    const db = new sqlite.DatabaseSync(":memory:");
    try {
      db.exec(SCHEMA_SQL);
      db.exec("ALTER TABLE sessions DROP COLUMN sandbox");
      db.exec("PRAGMA user_version = 8");
      migrate(db, { swapPath: true });
      const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
      expect(cols.some((c) => c.name === "sandbox")).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("confining under a Session's own policy", () => {
  it("a settings change does not reach a confiner bound to the Session's snapshot", async () => {
    const seen: string[] = [];
    const provider: SandboxProvider = {
      dimensions: ["fs-write", "network"],
      confine(argv, policy) {
        seen.push(`${policy.mode}/${policy.network ?? "open"}`);
        return {
          argv: ["runner", ...argv],
          enforcement: "full",
          denialSignatures: [],
          runnerFailureRules: [],
        };
      },
    };
    const svc = new SandboxService([["fake", provider]]);
    await svc.whenReady();
    let snapshot: SandboxSettings = { mode: "workspace-write", network: "none" };
    const sessionConfiner = svc.confinerFor(() => snapshot);
    const opts = { cwd: "/w", workspaceDir: "/w" };

    svc.configure({ mode: "danger-full-access" });
    expect(sessionConfiner(["true"], opts).argv[0]).toBe("runner");
    expect(seen).toEqual(["workspace-write/none"]);
    // The settings' own confiner follows the settings; the Session's does not.
    expect(svc.confiner()(["true"], opts).argv).toEqual(["true"]);

    snapshot = { mode: "danger-full-access" };
    expect(sessionConfiner(["true"], opts).argv).toEqual(["true"]);
  });
});

/** A root Session whose run spawns one subagent: registering it ties the child to this root. */
function spawningSession(sessionId: string, childId: string): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      yield withOrigin(
        sessionMeta({
          session_id: childId,
          model_id: "m",
          provider: "prov",
          model_context_window: 1000,
          system_prompt: "sys",
          agent_state: "/root/p/child_agent/agent_state",
          workspace: "/w",
          source: "subagent",
        }),
        childId,
      );
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("the policy SessionEnv hands core for the file tools", () => {
  const ctx = (sessionId: string) => ({ projectId: "p", agentId: "a", sessionId });

  it("is the Session's snapshot, its root's for a subagent, and the settings snapshotted onto a row without one", async () => {
    const { createTestApp, waitFor } = await import("./helpers.js");
    const t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    try {
      const env = t.deps.tree.api<SessionEnv>("SessionRuntimeModule", "SessionEnv");
      const sandbox = t.deps.tree.api<SandboxService>("SandboxModule", "sandbox");
      const repo = t.deps.sessionsRepo;

      // The Session's own snapshot, whatever the settings say.
      sandbox.configure({ mode: "read-only" });
      const row: SessionRow = { ...ROW, sandbox: { mode: "workspace-write", network: "none" } };
      repo.insert(row);
      expect(env.sandboxPolicy(ctx("session-1"))).toEqual({
        mode: "workspace-write",
        network: "none",
      });

      // A subagent follows its root: a change made on the root after the child registered
      // reaches it, while the child's own row keeps the copy taken at registration.
      t.deps.manager.adopt(row, spawningSession("session-1", "child-1"));
      await t.deps.manager.startTask("session-1", [userText("go")]);
      await waitFor(() => t.deps.manager.statusOf("session-1") === "idle");
      repo.updateSandbox("session-1", { mode: "read-only", maskPaths: ["/secret"] });
      expect(repo.findById("child-1")?.sandbox).toEqual({
        mode: "workspace-write",
        network: "none",
      });
      expect(env.sandboxPolicy(ctx("child-1"))).toEqual({
        mode: "read-only",
        maskPaths: ["/secret"],
      });

      // A row from before snapshots takes the settings at its first read, and keeps them.
      repo.insert({ ...ROW, sessionId: "session-legacy" });
      expect(env.sandboxPolicy(ctx("session-legacy"))).toEqual({ mode: "read-only" });
      expect(repo.findById("session-legacy")?.sandbox).toEqual({ mode: "read-only" });
      sandbox.configure({ mode: "workspace-write" });
      expect(env.sandboxPolicy(ctx("session-legacy"))).toEqual({ mode: "read-only" });
    } finally {
      await t.cleanup();
    }
  });

  it("is the snapshot the commands' confiner took: both seams read one policy", async () => {
    const { createTestApp } = await import("./helpers.js");
    const t = await createTestApp({ titles: { maybeGenerate: () => {} } });
    try {
      const env = t.deps.tree.api<SessionEnv>("SessionRuntimeModule", "SessionEnv");
      const sandbox = t.deps.tree.api<SandboxService>("SandboxModule", "sandbox");
      t.deps.sessionsRepo.insert({ ...ROW, sessionId: "session-legacy" });

      // The row's first command snapshots full access; a later settings change does not
      // reach the file tools, which apply that same snapshot.
      sandbox.configure({ mode: "danger-full-access" });
      const confiner = env.confineSpawn(ctx("session-legacy"));
      expect(confiner!(["true"], { cwd: "/w", workspaceDir: "/w" }).argv).toEqual(["true"]);
      sandbox.configure({ mode: "read-only" });
      expect(env.sandboxPolicy(ctx("session-legacy"))).toEqual({ mode: "danger-full-access" });
    } finally {
      await t.cleanup();
    }
  });
});

describe("the API: settings seed new Sessions, and never reach existing ones", () => {
  it("snapshots at creation, keeps the snapshot across a settings change, and bounds non-admins", async () => {
    const { apiClient, createTestApp, loginAdmin, provisionUser } = await import("./helpers.js");
    const t = await createTestApp();
    try {
      const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
      const owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
      const project = (await (
        await owner.post("/api/projects", { projectId: "owner-sandbox", name: "project" })
      ).json()) as { project: { projectId: string } };
      const projectId = project.project.projectId;
      await owner.put(`/api/projects/${projectId}/models`, {
        defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
        models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
      });
      const settings = (values: Record<string, unknown>) =>
        admin.put("/api/admin/plugin-config", { name: "sandbox", values });
      const create = async (body: Record<string, unknown> = {}) =>
        owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, body);
      type Created = { session: { sessionId: string; sandbox: unknown } };

      expect((await settings({ mode: "workspace-write", network: "none" })).status).toBe(200);
      const first = (await (await create()).json()) as Created;
      expect(first.session.sandbox).toEqual({
        mode: "workspace-write",
        network: "none",
        localNetworkSupported: false,
      });

      // The settings change: a new Session starts from it, the existing one does not move.
      expect((await settings({ mode: "read-only", network: "open" })).status).toBe(200);
      const again = (await (
        await owner.get(`/api/sessions/${first.session.sessionId}`)
      ).json()) as Created;
      expect(again.session.sandbox).toEqual({
        mode: "workspace-write",
        network: "none",
        localNetworkSupported: false,
      });
      const second = (await (await create()).json()) as Created;
      expect(second.session.sandbox).toEqual({
        mode: "read-only",
        network: "open",
        localNetworkSupported: false,
      });

      // A non-admin tightens freely, and may not loosen past the settings.
      const tightened = await owner.patch(`/api/sessions/${first.session.sessionId}`, {
        sandbox: { mode: "read-only" },
      });
      expect(tightened.status).toBe(200);
      expect(((await tightened.json()) as Created).session.sandbox).toEqual({
        mode: "read-only",
        network: "none",
        localNetworkSupported: false,
      });
      const loosened = await owner.patch(`/api/sessions/${second.session.sessionId}`, {
        sandbox: { mode: "danger-full-access" },
      });
      expect(loosened.status).toBe(403);
      expect(await loosened.json()).toMatchObject({ error: { code: "sandbox_forbidden" } });
      expect((await create({ sandbox: { mode: "workspace-write" } })).status).toBe(403);
      expect((await create({ sandbox: { mode: "nope" } })).status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });
});
