/**
 * The Sandbox card's switch: whether new Sessions start confined.
 *
 * - Given settings saved before the switch existed (no `enabled` on disk), when the server
 *   boots, the card shows the switch on exactly when the old policy confined anything, the
 *   service applies that policy, and the stored document is not rewritten.
 * - Given the switch turned off, when a Session is created, it starts unconfined and its view
 *   says the switch is off; a Session created while it was on keeps its own policy. Turned back
 *   on, the stored mode and network apply again.
 * - The card reports whether a sandbox backend for this OS is installed — in use, or installed
 *   and failing — and which package this OS defaults to; a backend that declined (another
 *   OS's) does not count.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { PluginConfigEntry, PluginConfigResponse, SessionSandbox } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import type { SandboxService } from "../src/sandbox/service.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** What the server defaults to on the OS the suite runs on. */
const RECOMMENDED: Partial<Record<NodeJS.Platform, string>> = {
  linux: "@penguinharness/sandbox-bwrap",
  darwin: "@penguinharness/sandbox-seatbelt",
  win32: "@penguinharness/sandbox-wsl",
};
const recommended = RECOMMENDED[process.platform];

/** A backend plugin whose providers resolve as given: a provider, null (declined), or a failure. */
function backendPlugin(bind: Record<string, unknown>): PluginHost {
  const module: ModuleDef = {
    manifest: parseManifest({
      name: "SwitchTestBackend",
      requires: {},
      provides: {},
      contributes: {
        "SandboxModule.providers": Object.keys(bind).map((id) => ({
          id,
          name: id.replace(/\.provider$/, ""),
          dimensions: ["fs-write", "network"],
        })),
      },
      children: [],
    }),
    create: () => ({ api: {}, bind }),
  };
  const host = new PluginHost();
  host.use({ specifier: "switch-test-backend", modules: [module], replaces: [] });
  return host;
}

const PROVIDER = {
  dimensions: ["fs-write", "network"],
  confine: (argv: readonly string[]) => ({
    argv: ["confined", ...argv],
    enforcement: "full" as const,
    denialSignatures: [],
    runnerFailureRules: [],
  }),
};

async function boot(opts: { plugins?: PluginHost; dbPath?: string } = {}) {
  const t = await createTestApp({
    ...(opts.plugins ? { plugins: opts.plugins } : {}),
    ...(opts.dbPath ? { config: { dbPath: opts.dbPath } } : {}),
  });
  const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const sandbox = t.deps.tree.api<SandboxService>("SandboxModule", "sandbox");
  await sandbox.whenReady();
  const card = async (): Promise<PluginConfigEntry> =>
    (
      (await (await admin.get("/api/admin/plugin-config")).json()) as PluginConfigResponse
    ).plugins.find((e) => e.name === "sandbox")!;
  const save = (values: Record<string, unknown>) =>
    admin.put("/api/admin/plugin-config", { name: "sandbox", values });
  return { t, admin, sandbox, card, save };
}

describe("the sandbox switch", () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    for (const t of apps.splice(0)) await t.cleanup();
  });

  it("reads settings saved before the switch as on when they confined anything, applies them, and leaves the disk alone", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sandbox-switch-"));
    const dbPath = path.join(dir, "web.db");
    const plugins = () => backendPlugin({ "fake.provider": PROVIDER });
    const restartWith = async (doc: Record<string, unknown>) => {
      const first = await boot({ plugins: plugins(), dbPath });
      first.t.deps.serverSettingsRepo.set("plugin-config:sandbox", JSON.stringify(doc));
      await first.t.cleanup();
      const next = await boot({ plugins: plugins(), dbPath });
      apps.push(next.t);
      return next;
    };
    try {
      const confined = await restartWith({ mode: "workspace-write", network: "none" });
      expect((await confined.card()).values).toMatchObject({
        enabled: true,
        mode: "workspace-write",
        network: "none",
      });
      expect(confined.sandbox.currentSettings()).toEqual({
        mode: "workspace-write",
        network: "none",
      });
      expect(confined.t.deps.serverSettingsRepo.get("plugin-config:sandbox")).toBe(
        JSON.stringify({ mode: "workspace-write", network: "none" }),
      );
      await apps.pop()!.cleanup();

      // Off with the network cut still confined: it reads as on, and stays confined.
      const cutOnly = await restartWith({ mode: "danger-full-access", network: "none" });
      expect((await cutOnly.card()).values.enabled).toBe(true);
      expect(cutOnly.sandbox.currentSettings()).toEqual({
        mode: "danger-full-access",
        network: "none",
      });
      await apps.pop()!.cleanup();

      const open = await restartWith({ mode: "danger-full-access", maskPaths: [] });
      expect((await open.card()).values.enabled).toBe(false);
      expect(open.sandbox.currentSettings()).toEqual({ mode: "danger-full-access" });
    } finally {
      for (const t of apps.splice(0)) await t.cleanup();
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("off, a new Session starts unconfined while an existing one keeps its policy; on again, the stored mode returns", async () => {
    const { t, card, save, sandbox } = await boot({
      plugins: backendPlugin({ "fake.provider": PROVIDER }),
    });
    apps.push(t);
    // Fresh install: off, and the composer is told so.
    expect((await card()).values.enabled).toBe(false);
    const owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
    const projectId = (
      (await (
        await owner.post("/api/projects", { projectId: "owner-switch", name: "project" })
      ).json()) as { project: { projectId: string } }
    ).project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    type Created = { session: { sessionId: string; sandbox: SessionSandbox } };
    const create = async () =>
      (await (
        await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
      ).json()) as Created;
    const read = async (id: string) =>
      ((await (await owner.get(`/api/sessions/${id}`)).json()) as Created).session.sandbox;
    const draft = async () =>
      (
        (await (await owner.get(`/api/projects/${projectId}/chat-defaults`)).json()) as {
          sandbox: SessionSandbox;
        }
      ).sandbox;

    expect((await save({ enabled: true, mode: "read-only", network: "none" })).status).toBe(200);
    const confined = await create();
    expect(confined.session.sandbox).toMatchObject({
      mode: "read-only",
      network: "none",
      switchOn: true,
    });

    const off = await save({ enabled: false });
    expect(off.status).toBe(200);
    // The card keeps the mode and network it will apply again.
    const offCard = ((await off.json()) as PluginConfigResponse).plugins.find(
      (e) => e.name === "sandbox",
    )!;
    expect(offCard.values).toMatchObject({ enabled: false, mode: "read-only", network: "none" });
    expect(sandbox.currentSettings()).toEqual({ mode: "danger-full-access" });
    const unconfined = await create();
    expect(unconfined.session.sandbox).toMatchObject({
      mode: "danger-full-access",
      network: "open",
      switchOn: false,
    });
    expect(await draft()).toMatchObject({ mode: "danger-full-access", switchOn: false });
    expect(await read(confined.session.sessionId)).toMatchObject({
      mode: "read-only",
      network: "none",
      switchOn: false,
    });

    expect((await save({ enabled: true })).status).toBe(200);
    expect(sandbox.currentSettings()).toEqual({ mode: "read-only", network: "none" });
    expect((await create()).session.sandbox).toMatchObject({
      mode: "read-only",
      network: "none",
      switchOn: true,
    });
    expect(await read(unconfined.session.sessionId)).toMatchObject({
      mode: "danger-full-access",
    });
  });

  it("reports no backend for this OS, and the OS's default package, when none is installed", async () => {
    const { t, card } = await boot();
    apps.push(t);
    expect((await card()).backend).toEqual({
      installed: false,
      ...(recommended !== undefined ? { recommended } : {}),
    });
  });

  it("counts a backend in use, or one installed and failing, but not one that declined", async () => {
    const declinedOnly = await boot({
      plugins: backendPlugin({ "elsewhere.provider": Promise.resolve(null) }),
    });
    apps.push(declinedOnly.t);
    expect((await declinedOnly.card()).backend?.installed).toBe(false);

    const failing = await boot({
      plugins: backendPlugin({
        "elsewhere.provider": Promise.resolve(null),
        // A loader, so the failure is not an unhandled rejection before the service asks.
        "broken.provider": () => Promise.reject(new Error("'bwrap' is missing")),
      }),
    });
    apps.push(failing.t);
    expect((await failing.card()).backend?.installed).toBe(true);

    const mounted = await boot({ plugins: backendPlugin({ "fake.provider": PROVIDER }) });
    apps.push(mounted.t);
    expect((await mounted.card()).backend?.installed).toBe(true);
  });
});
