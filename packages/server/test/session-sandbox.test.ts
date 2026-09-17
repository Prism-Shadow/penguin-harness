/**
 * A Session's sandbox policy is its own: snapshotted at creation, changed only on that Session,
 * and bounded for non-admins by the server's settings. Editing the settings afterwards must
 * not reach a Session that already exists.
 */
import { describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { SandboxProvider, SandboxSettings } from "@prismshadow/penguin-core/plugin";
import { openDatabase } from "../src/db/database.js";
import { migrate } from "../src/db/migrations.js";
import { SCHEMA_SQL } from "../src/db/schema.js";
import { SessionsRepo } from "../src/db/repos/sessions.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
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
    expect(sessionSandboxOf(next)).toEqual({ mode: "read-only", network: "none" });
  });

  it("a non-admin cannot loosen past the server's settings, in either dimension", () => {
    expect(() =>
      applySandboxPick(settings, { mode: "danger-full-access" }, settings, false),
    ).toThrow(/Only an administrator/);
    expect(() => applySandboxPick(settings, { network: "open" }, settings, false)).toThrow(
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

      expect((await settings({ mode: "workspace-write", cutNetwork: true })).status).toBe(200);
      const first = (await (await create()).json()) as Created;
      expect(first.session.sandbox).toEqual({ mode: "workspace-write", network: "none" });

      // The settings change: a new Session starts from it, the existing one does not move.
      expect((await settings({ mode: "read-only", cutNetwork: false })).status).toBe(200);
      const again = (await (
        await owner.get(`/api/sessions/${first.session.sessionId}`)
      ).json()) as Created;
      expect(again.session.sandbox).toEqual({ mode: "workspace-write", network: "none" });
      const second = (await (await create()).json()) as Created;
      expect(second.session.sandbox).toEqual({ mode: "read-only", network: "open" });

      // A non-admin tightens freely, and may not loosen past the settings.
      const tightened = await owner.patch(`/api/sessions/${first.session.sessionId}`, {
        sandbox: { mode: "read-only" },
      });
      expect(tightened.status).toBe(200);
      expect(((await tightened.json()) as Created).session.sandbox).toEqual({
        mode: "read-only",
        network: "none",
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
