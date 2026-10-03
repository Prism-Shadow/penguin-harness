/**
 * The Sandbox card's switch: whether new Sessions start confined.
 *
 * - Given settings saved before the switch existed (no `enabled` on disk), when the server
 *   boots, the card shows the switch on exactly when the old policy confined anything — a mode
 *   other than Off, a network that is not open, or masked paths — the service applies that
 *   policy, and the stored document is not rewritten.
 * - Given settings saved before the default preset (`mode`/`network`, no `defaultPreset`), the
 *   card shows as the default the first row giving exactly the same start, and a save pins it;
 *   with no such row it shows none and says what is in effect, and a save of other fields
 *   keeps that start until an administrator picks a row.
 * - Given the switch on, a new Session (and the composer's draft) starts from the default
 *   preset's mode, network and approval mode; changing the default reaches only new Sessions.
 * - Given the switch off, a new Session starts unconfined with no approval mode from the
 *   presets; a Session created while it was on keeps its own policy.
 * - The card reports whether a sandbox backend for this OS is installed — in use, or installed
 *   and failing — and which package this OS defaults to; a backend that declined (another
 *   OS's) does not count. The card names `enabled` as its switch.
 * - Every preset row, and every value a row's choice can take, carries a description in both
 *   languages, for the row's "?".
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
      const confined = await restartWith({ mode: "read-only", network: "none" });
      // The card shows the switch on; the document's own mode and network decide new Sessions
      // (what the card's Default column shows for it is the next case's).
      expect((await confined.card()).values.enabled).toBe(true);
      expect(confined.sandbox.currentSettings()).toEqual({ mode: "read-only", network: "none" });
      expect(confined.t.deps.serverSettingsRepo.get("plugin-config:sandbox")).toBe(
        JSON.stringify({ mode: "read-only", network: "none" }),
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

  it("shows the row a pre-preset document matches as the default, and none when no row matches", async () => {
    const { t, card } = await boot();
    apps.push(t);
    const store = (doc: Record<string, unknown>) =>
      t.deps.serverSettingsRepo.set("plugin-config:sandbox", JSON.stringify(doc));
    const prePresetNotice = (entry: PluginConfigEntry) =>
      entry.notices?.find((n) => n.text.includes("saved before the presets"));

    // Nothing saved is no pre-preset document: the shipped default.
    expect((await card()).values.defaultPreset).toBe("workspace-write");

    // The rows whose start is the old one: the same mode and network, approving everything.
    for (const [doc, row] of [
      [{ mode: "read-only" }, "read-only"],
      [{ mode: "workspace-write", network: "open" }, "workspace-write"],
      // Masked paths are the card's own, laid over every row alike.
      [{ mode: "workspace-write", maskPaths: ["/secret"] }, "workspace-write"],
      // An added row counts, in table order.
      [
        {
          mode: "read-only",
          network: "none",
          presets: {
            $added: {
              cut: {
                name: "Cut",
                enabled: false,
                mode: "read-only",
                network: "none",
                approvalMode: "allow-all",
              },
            },
          },
        },
        "cut",
      ],
    ] as const) {
      store(doc);
      const entry = await card();
      expect(entry.values.defaultPreset, JSON.stringify(doc)).toBe(row);
      expect(prePresetNotice(entry)).toBeUndefined();
    }

    // No row starts there: a cut or local network, or Off with masked paths (Full Access
    // confines nothing). The Default column marks none, and the card says what is in effect.
    for (const doc of [
      { mode: "read-only", network: "none" },
      { mode: "workspace-write", network: "local" },
      { maskPaths: ["/secret"] },
      { mode: "danger-full-access", maskPaths: ["/secret"] },
    ]) {
      store(doc);
      const entry = await card();
      expect(entry.values.defaultPreset, JSON.stringify(doc)).toBeUndefined();
      expect(entry.values.enabled).toBe(true);
      expect(prePresetNotice(entry), JSON.stringify(doc)).toMatchObject({ tone: "attention" });
    }
    store({ mode: "read-only", network: "none" });
    expect(prePresetNotice(await card())).toEqual({
      tone: "attention",
      text: 'While the sandbox is on, new sessions start from the settings saved before the presets: files Read-only, network No network, ask mode Approve everything. No preset has these values, so no row is the default, and saving the card keeps them. To change that, set a row as the default from its "…" menu, or add a preset with these values and set it.',
      textZh:
        "沙盒打开时，新会话从预设出现之前保存的设置开始：文件「只读」、网络「无网络」、询问模式「全部批准」。没有预设与之相同，因此没有一行是默认，保存卡片也会保留这些值。要改变它，在一行的「…」菜单里把它设为默认，或先添加一条同值的预设再设为默认。",
    });
  });

  it("keeps a pre-preset document's start across a save that picks no default", async () => {
    const { t, save, sandbox } = await boot();
    apps.push(t);
    const store = (doc: Record<string, unknown>) =>
      t.deps.serverSettingsRepo.set("plugin-config:sandbox", JSON.stringify(doc));
    const onDisk = () =>
      JSON.parse(t.deps.serverSettingsRepo.get("plugin-config:sandbox")!) as Record<
        string,
        unknown
      >;

    // No row matches: saving an unrelated field writes no default, and the start stays.
    store({ mode: "read-only", network: "none" });
    expect((await save({ presets: { "read-only": { name: "Look only" } } })).status).toBe(200);
    expect(onDisk().defaultPreset).toBeUndefined();
    expect(sandbox.currentSettings()).toEqual({ mode: "read-only", network: "none" });
    // An administrator's pick is what moves it.
    expect((await save({ defaultPreset: "workspace-write" })).status).toBe(200);
    expect(onDisk().defaultPreset).toBe("workspace-write");
    expect(sandbox.currentSettings()).toEqual({ mode: "workspace-write" });

    // A row matches: the save pins it, and the start is what it was.
    store({ mode: "read-only" });
    expect((await save({ presets: { "read-only": { name: "Look only" } } })).status).toBe(200);
    expect(onDisk().defaultPreset).toBe("read-only");
    expect(sandbox.currentSettings()).toEqual({ mode: "read-only" });
  });

  it("on, a new Session starts from the default preset (mode, network, approval); off, unconfined; existing Sessions keep theirs", async () => {
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
    type Created = {
      session: { sessionId: string; approvalMode: string; sandbox: SessionSandbox };
    };
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

    // On, with the Read Only row as the default, remapped to cut the network and ask.
    expect(
      (
        await save({
          enabled: true,
          defaultPreset: "read-only",
          presets: { "read-only": { network: "none", approvalMode: "always-ask" } },
        })
      ).status,
    ).toBe(200);
    const confined = await create();
    expect(confined.session.approvalMode).toBe("always-ask");
    expect(confined.session.sandbox).toMatchObject({
      mode: "read-only",
      network: "none",
      switchOn: true,
    });
    expect(await draft()).toMatchObject({
      mode: "read-only",
      network: "none",
      defaultApprovalMode: "always-ask",
    });

    // Another default reaches new Sessions only.
    expect((await save({ defaultPreset: "workspace-write" })).status).toBe(200);
    const next = await create();
    expect(next.session.approvalMode).toBe("allow-all");
    expect(next.session.sandbox).toMatchObject({ mode: "workspace-write", network: "open" });
    expect(await read(confined.session.sessionId)).toMatchObject({
      mode: "read-only",
      network: "none",
    });

    // Off: new Sessions start unconfined and take no approval mode from the presets.
    const off = await save({ enabled: false });
    expect(off.status).toBe(200);
    const offCard = ((await off.json()) as PluginConfigResponse).plugins.find(
      (e) => e.name === "sandbox",
    )!;
    expect(offCard.values).toMatchObject({ enabled: false, defaultPreset: "workspace-write" });
    expect(sandbox.currentSettings()).toEqual({ mode: "danger-full-access" });
    const unconfined = await create();
    expect(unconfined.session.approvalMode).toBe("allow-all");
    expect(unconfined.session.sandbox).toMatchObject({
      mode: "danger-full-access",
      network: "open",
      switchOn: false,
    });
    const offDraft = await draft();
    expect(offDraft).toMatchObject({ mode: "danger-full-access", switchOn: false });
    expect(offDraft.defaultApprovalMode).toBeUndefined();
    expect(await read(confined.session.sessionId)).toMatchObject({
      mode: "read-only",
      network: "none",
      switchOn: false,
    });

    // On again: the default preset applies again.
    expect((await save({ enabled: true })).status).toBe(200);
    expect(sandbox.currentSettings()).toEqual({ mode: "workspace-write" });
    expect(await read(unconfined.session.sessionId)).toMatchObject({
      mode: "danger-full-access",
    });
  });

  it("serves the card's presets to the composer in the stored order, added ones included, and a pick applies", async () => {
    const { t, save } = await boot();
    apps.push(t);
    const owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
    const projectId = (
      (await (
        await owner.post("/api/projects", { projectId: "owner-order", name: "project" })
      ).json()) as { project: { projectId: string } }
    ).project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    const order = ["mine", "read-only", "full-access", "always-ask", "workspace-write"];
    const saved = await save({
      enabled: true,
      defaultPreset: "mine",
      presets: {
        $added: {
          mine: {
            name: "Mine",
            enabled: true,
            mode: "read-only",
            network: "open",
            approvalMode: "always-ask",
          },
        },
        $order: order,
      },
    });
    expect(saved.status).toBe(200);
    type View = { sandbox: SessionSandbox };
    const defaults = (await (
      await owner.get(`/api/projects/${projectId}/chat-defaults`)
    ).json()) as View;
    // The stored order first, then the rows it does not name, as declared.
    expect(defaults.sandbox.presets?.map((p) => p.id)).toEqual([
      ...order,
      "workspace-write-ask",
      "denied-all",
    ]);
    expect(defaults.sandbox.presets?.[0]).toMatchObject({ name: "Mine", enabled: true });
    expect(defaults.sandbox).toMatchObject({ switchOn: true, defaultApprovalMode: "always-ask" });

    const created = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as { session: { sessionId: string; approvalMode: string } & View };
    expect(created.session.approvalMode).toBe("always-ask");
    expect(created.session.sandbox.presets?.map((p) => p.id).slice(0, 5)).toEqual(order);
    // A preset picked from the menu: its three values land on the Session.
    const picked = await owner.patch(`/api/sessions/${created.session.sessionId}`, {
      approvalMode: "allow-all",
      sandbox: { mode: "read-only", network: "open" },
    });
    expect(picked.status).toBe(200);
    expect(
      ((await picked.json()) as { session: { approvalMode: string } & View }).session,
    ).toMatchObject({
      approvalMode: "allow-all",
      sandbox: { mode: "read-only", network: "open" },
    });
  });

  it("reports no backend for this OS, and the OS's default package, when none is installed", async () => {
    const { t, card } = await boot();
    apps.push(t);
    const entry = await card();
    expect(entry.backend).toEqual({
      installed: false,
      ...(recommended !== undefined ? { recommended } : {}),
    });
    expect(
      entry.notices?.find((n) => n.text.startsWith("This deployment has no usable")),
    ).toMatchObject({ tone: "attention" });
    // The card names its switch: off, the page draws it alone, the warning included.
    expect(entry.configuration.switch).toBe("enabled");
  });

  it("explains every preset row and every value a row's choice can take, in both languages", async () => {
    const { t, card } = await boot();
    apps.push(t);
    const presets = (await card()).configuration.properties.presets!;
    for (const row of presets.rows!) {
      expect(row, row.id).toMatchObject({
        description: expect.any(String),
        descriptionZh: expect.any(String),
      });
    }
    for (const column of presets.columns!.filter((c) => c.type === "enum")) {
      for (const option of column.options!) {
        expect(option, `${column.name}.${option.value}`).toMatchObject({
          description: expect.any(String),
          descriptionZh: expect.any(String),
        });
      }
    }
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
