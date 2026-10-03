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
import type { SessionSandbox } from "../src/api/types.js";
import { SandboxService } from "../src/sandbox/index.js";
import { applySandboxPick, sessionSandboxOf } from "../src/services/session-service.js";

const sqlite = process.getBuiltinModule("node:sqlite");

/** What a server with no sandbox backend mounted says it can enforce: nothing. */
const NO_BACKEND = {
  confinementSupported: false,
  noNetworkSupported: false,
  localNetworkSupported: false,
  maskPathsSupported: false,
  unavailableBackends: [],
};

/** The Sandbox card's presets table as a Session's view carries it with nothing saved. */
const DEFAULT_PRESETS = (
  [
    ["full-access", "Full Access", "完全访问", true, "danger-full-access", "allow-all"],
    ["always-ask", "Always Ask", "每次询问", true, "danger-full-access", "always-ask"],
    ["workspace-write", "Workspace Write", "仅工作区可写", true, "workspace-write", "allow-all"],
    ["read-only", "Read Only", "只读", true, "read-only", "allow-all"],
    [
      "workspace-write-ask",
      "Workspace Write with Ask",
      "仅工作区可写并询问",
      false,
      "workspace-write",
      "always-ask",
    ],
    ["denied-all", "Denied All", "全部拒绝", false, "danger-full-access", "deny-all"],
  ] as const
).map(([id, name, nameZh, enabled, mode, approvalMode]) => ({
  id,
  name,
  nameZh,
  enabled,
  mode,
  network: "open",
  approvalMode,
}));

/** Served beside a policy on a server with no backend: the presets, and the switch on. */
const SERVED = { ...NO_BACKEND, presets: DEFAULT_PRESETS, switchOn: true };

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
    // Masked paths and a read-only temp are what no preset shows: the view says so.
    expect(sessionSandboxOf(next)).toEqual({
      mode: "read-only",
      network: "none",
      ...NO_BACKEND,
      advanced: true,
      // The masked paths need a backend that masks; none is mounted here.
      masksPaths: true,
    });
  });

  it("is advanced only while the policy holds what no preset shows, and carries the presets it is given", () => {
    expect(sessionSandboxOf({ mode: "workspace-write" }).advanced).toBeUndefined();
    expect(sessionSandboxOf({ mode: "workspace-write", writableTemp: false }).advanced).toBe(true);
    expect(sessionSandboxOf({ mode: "workspace-write", maskPaths: ["/k"] }).advanced).toBe(true);
    // Only masked paths set `masksPaths`: a read-only temp needs no further backend.
    expect(sessionSandboxOf({ mode: "workspace-write", writableTemp: false }).masksPaths).toBe(
      undefined,
    );
    expect(
      sessionSandboxOf({ mode: "workspace-write", maskPaths: ["/k"] }, ["fs-write"]),
    ).toMatchObject({ masksPaths: true, maskPathsSupported: false, confinementSupported: true });
    expect(sessionSandboxOf({ mode: "workspace-write" }).presets).toBeUndefined();
    const view = sessionSandboxOf({ mode: "read-only" }, [], [], DEFAULT_PRESETS as never);
    expect(view.presets).toEqual(DEFAULT_PRESETS);
  });

  it("says which levels the mounted backends can enforce, and none without a backend", () => {
    const policy: SandboxSettings = { mode: "danger-full-access" };
    expect(sessionSandboxOf(policy)).toEqual({
      mode: "danger-full-access",
      network: "open",
      ...NO_BACKEND,
    });
    // A filesystem-only backend (the DSH adaptor) confines, but cannot cut the network.
    expect(sessionSandboxOf(policy, ["fs-write"])).toEqual({
      mode: "danger-full-access",
      network: "open",
      confinementSupported: true,
      noNetworkSupported: false,
      localNetworkSupported: false,
      maskPathsSupported: false,
      unavailableBackends: [],
    });
  });

  it("names an enabled backend that failed its check, and leaves out one for another platform", async () => {
    const svc = new SandboxService([
      [
        "penguin-wsl",
        () => Promise.reject(new Error("the sandbox distro is not set up; run Set up")),
      ],
      // Another platform's backend declines: nothing is wrong with it here.
      ["penguin-seatbelt", () => null],
    ]);
    await svc.whenReady();
    const dimensions = [...new Set(svc.backends().flatMap((b) => b.dimensions))];
    expect(sessionSandboxOf({ mode: "danger-full-access" }, dimensions, svc.failures())).toEqual({
      mode: "danger-full-access",
      network: "open",
      ...NO_BACKEND,
      unavailableBackends: [
        { name: "penguin-wsl", reason: "the sandbox distro is not set up; run Set up" },
      ],
    });
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

type ApiSession = { sessionId: string; approvalMode: string; sandbox: SessionSandbox };

/** A fresh app, an admin, and an owner's Project with a model, to create Sessions in. */
async function ownerProject(id: string) {
  const { apiClient, createTestApp, loginAdmin, provisionUser } = await import("./helpers.js");
  const t = await createTestApp();
  const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
  const projectId = (
    (await (await owner.post("/api/projects", { projectId: id, name: "project" })).json()) as {
      project: { projectId: string };
    }
  ).project.projectId;
  await owner.put(`/api/projects/${projectId}/models`, {
    defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
  });
  const body = async (res: Response) => ((await res.json()) as { session: ApiSession }).session;
  return {
    t,
    admin,
    owner,
    projectId,
    body,
    settings: (values: Record<string, unknown>) =>
      admin.put("/api/admin/plugin-config", { name: "sandbox", values }),
    post: (sandbox?: unknown) =>
      owner.post(
        `/api/projects/${projectId}/agents/default_agent/sessions`,
        sandbox ? { sandbox } : {},
      ),
    create: async () =>
      body(await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})),
    read: async (sessionId: string) => body(await owner.get(`/api/sessions/${sessionId}`)),
    defaults: async () =>
      (
        (await (await owner.get(`/api/projects/${projectId}/chat-defaults`)).json()) as {
          sandbox: SessionSandbox;
        }
      ).sandbox,
  };
}

describe("the API: settings seed new Sessions, and never reach existing ones", () => {
  it("snapshots at creation, keeps the snapshot across a settings change, and bounds non-admins", async () => {
    const { t, owner, settings, post, create, read, body } = await ownerProject("owner-sandbox");
    try {
      const served = (mode: string, network: string) => ({
        mode,
        network,
        ...SERVED,
        presets: expect.any(Array),
      });
      // A new Session starts from the default preset, here remapped to cut the network.
      const remap = {
        enabled: true,
        defaultPreset: "workspace-write",
        presets: { "workspace-write": { network: "none" } },
      };
      expect((await settings(remap)).status).toBe(200);
      const first = await create();
      expect(first.sandbox).toEqual(served("workspace-write", "none"));

      // The settings change: a new Session starts from it, the existing one does not move.
      expect((await settings({ defaultPreset: "read-only" })).status).toBe(200);
      expect((await read(first.sessionId)).sandbox).toEqual(served("workspace-write", "none"));
      const second = await create();
      expect(second.sandbox).toEqual(served("read-only", "open"));

      // A non-admin tightens freely, and may not loosen past the settings.
      const patch = (id: string, mode: string) =>
        owner.patch(`/api/sessions/${id}`, { sandbox: { mode } });
      const tightened = await patch(first.sessionId, "read-only");
      expect((await body(tightened)).sandbox).toEqual(served("read-only", "none"));
      const loosened = await patch(second.sessionId, "danger-full-access");
      expect(loosened.status).toBe(403);
      expect(await loosened.json()).toMatchObject({ error: { code: "sandbox_forbidden" } });
      expect((await post({ mode: "workspace-write" })).status).toBe(403);
      expect((await post({ mode: "nope" })).status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });

  it("carries the Sandbox card's presets, read back after a save, and says when the policy is advanced", async () => {
    const { t, settings, create, read, defaults } = await ownerProject("owner-presets");
    try {
      const first = await create();
      expect(first.sandbox.presets).toEqual(DEFAULT_PRESETS);
      expect(first.sandbox.advanced).toBeUndefined();

      // The table names levels, it is not part of a Session's policy: a save reaches existing ones.
      const edits = {
        "read-only": { name: "Look only", network: "none" },
        "denied-all": { enabled: true },
      };
      expect((await settings({ presets: edits })).status).toBe(200);
      const presets = (await read(first.sessionId)).sandbox.presets!;
      expect(presets.map((p) => p.id)).toEqual(DEFAULT_PRESETS.map((p) => p.id));
      // A saved row reads without its shipped Chinese name.
      const readOnly = {
        id: "read-only",
        enabled: true,
        mode: "read-only",
        approvalMode: "allow-all",
      };
      expect(presets[3]).toEqual({ ...readOnly, name: "Look only", network: "none" });
      expect(presets[5]?.enabled).toBe(true);
      expect((await defaults()).presets).toEqual(presets);

      // A Session created under masked paths holds what no preset shows.
      await settings({ maskPaths: ["/secret"] });
      expect((await create()).sandbox.advanced).toBe(true);
      expect((await read(first.sessionId)).sandbox.advanced).toBeUndefined();
    } finally {
      await t.cleanup();
    }
  });

  it("a refused pick stores nothing: not the sandbox, nor the title or approval mode beside it", async () => {
    const { t, owner, settings, create } = await ownerProject("owner-refused");
    try {
      await settings({ enabled: true, defaultPreset: "workspace-write-ask" });
      const created = await create();
      const confined = {
        approvalMode: "always-ask",
        sandbox: { mode: "workspace-write", network: "open" },
      };
      expect(created).toMatchObject(confined);
      const before = t.deps.sessionsRepo.findById(created.sessionId);
      const cases = [
        // Past the server's settings for a non-admin.
        [
          {
            title: "Renamed",
            approvalMode: "allow-all",
            sandbox: { mode: "danger-full-access", network: "open" },
          },
          403,
          "sandbox_forbidden",
        ],
        // A level this server cannot enforce.
        [{ approvalMode: "allow-all", sandbox: { network: "local" } }, 400, "sandbox_unsupported"],
      ] as const;
      for (const [patch, status, code] of cases) {
        const res = await owner.patch(`/api/sessions/${created.sessionId}`, patch);
        expect(res.status).toBe(status);
        expect(await res.json()).toMatchObject({ error: { code } });
        expect(t.deps.sessionsRepo.findById(created.sessionId)).toEqual(before);
      }
    } finally {
      await t.cleanup();
    }
  });

  it("an approval-mode change alone leaves the policy unchecked and untouched", async () => {
    const { t, owner, create, body } = await ownerProject("owner-modeonly");
    try {
      const id = (await create()).sessionId;
      // Localhost-only networking no backend here enforces (picked while one was installed).
      const held = {
        ...t.deps.sessionService.sandboxOf(t.deps.sessionsRepo.findById(id)!),
        network: "local" as const,
      };
      t.deps.sessionService.updateSandbox(id, held);
      const res = await owner.patch(`/api/sessions/${id}`, { approvalMode: "read-only" });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(await body(res)).toMatchObject({
        approvalMode: "read-only",
        sandbox: { network: "local" },
      });
      expect(t.deps.sessionsRepo.findById(id)!.sandbox).toEqual(held);
    } finally {
      await t.cleanup();
    }
  });

  it("marks the presets wider than the server's settings as above the ceiling", async () => {
    const { t, owner, settings, create, read, defaults } = await ownerProject("owner-ceiling");
    try {
      const aboveIds = (sandbox: SessionSandbox) =>
        (sandbox.presets ?? []).filter((p) => p.aboveCeiling === true).map((p) => p.id);
      // On, from Workspace Write: the presets whose file mode is Off are above it.
      expect((await settings({ enabled: true })).status).toBe(200);
      const created = await create();
      const above = ["full-access", "always-ask", "denied-all"];
      expect(aboveIds(created.sandbox)).toEqual(above);
      expect(aboveIds(await defaults())).toEqual(above);
      // The mark is the refusal's own comparison: a marked row is refused, an unmarked one is not.
      const pick = (mode: string) =>
        owner.patch(`/api/sessions/${created.sessionId}`, { sandbox: { mode, network: "open" } });
      expect((await pick("danger-full-access")).status).toBe(403);
      expect((await pick("read-only")).status).toBe(200);

      // Off: the server's settings confine nothing, so no row is above them.
      expect((await settings({ enabled: false })).status).toBe(200);
      const after = (await read(created.sessionId)).sandbox;
      expect(after.presets).toHaveLength(DEFAULT_PRESETS.length);
      expect(aboveIds(after)).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });
});
