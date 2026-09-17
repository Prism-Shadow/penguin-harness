/**
 * Sandbox settings are a settings group: the sandbox's policy is listed, validated and stored
 * through /api/admin/plugin-config like any module's settings and applied at the next spawn,
 * surviving a restart. A backend with settings of its own declares its own group inside the
 * sandbox's and reads it itself through PluginConfig — nothing hands it a bag of values.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigResponse } from "../src/api/types.js";
import type { PluginConfig } from "../src/plugin/config.js";
import { PluginHost } from "../src/plugin/host.js";
import type { SandboxService } from "../src/sandbox/service.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** What the backend saw at each confine: the policy, and the runner it read from its own group. */
interface Seen {
  policy: SandboxPolicy;
  runner: unknown;
}

/** A backend declaring a group inside the sandbox's and reading it at each confine. */
function backend(seen: Seen[]): ModuleDef {
  return {
    manifest: parseManifest({
      name: "TestBackend",
      requires: {
        config: { iface: "@prismshadow/penguin-server#PluginConfig", from: "PluginConfigModule" },
      },
      provides: {},
      contributes: {
        "SandboxModule.providers": [
          {
            id: "test.provider",
            name: "test-backend",
            dimensions: ["fs-write", "network", "mask-paths"],
          },
          // Installed for another platform: it declines here, and says nothing on the card.
          { id: "elsewhere.provider", name: "other-platform", dimensions: ["fs-write"] },
        ],
        "PluginConfigProvider.groups": [
          {
            id: "sandbox-test",
            parent: "sandbox",
            title: "Test backend",
            properties: { runner: { type: "string", title: "Runner", default: "runner-a" } },
          },
        ],
      },
      children: [],
    }),
    create({ use }) {
      const config = use.config as PluginConfig;
      return {
        api: {},
        bind: {
          "elsewhere.provider": Promise.resolve(null),
          "test.provider": {
            dimensions: ["fs-write", "network", "mask-paths"],
            confine(argv: readonly string[], policy: SandboxPolicy) {
              seen.push({ policy, runner: config.get("sandbox-test").runner });
              return {
                argv: ["confined", ...argv],
                enforcement: "full",
                denialSignatures: [],
                runnerFailureRules: [],
              };
            },
          },
        },
      };
    },
  };
}

async function appWith(seen: Seen[], dbPath?: string) {
  const host = new PluginHost();
  host.use({ specifier: "test-backend", modules: [backend(seen)], replaces: [] });
  const t = await createTestApp({ plugins: host, ...(dbPath ? { config: { dbPath } } : {}) });
  const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  const sandbox = t.deps.tree.api<SandboxService>("SandboxModule", "sandbox");
  await sandbox.whenReady();
  const spawn = () => sandbox.confiner()(["true"], { workspaceDir: "/w" } as never);
  const list = async () =>
    ((await (await admin.get("/api/admin/plugin-config")).json()) as PluginConfigResponse).plugins;
  return { t, admin, sandbox, spawn, list };
}

describe("sandbox settings group", () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    for (const t of apps.splice(0)) await t.cleanup();
  });

  it("lists the sandbox with its backends' notice (a backend for another platform is not a notice), and a backend's group inside it", async () => {
    const { t, list } = await appWith([]);
    apps.push(t);
    const entries = await list();
    const sandbox = entries.find((e) => e.name === "sandbox")!;
    expect(entries[0]).toBe(sandbox);
    expect(sandbox.values).toEqual({
      mode: "danger-full-access",
      cutNetwork: false,
      writableTemp: true,
    });
    expect(sandbox.notices).toEqual([
      expect.objectContaining({
        tone: "muted",
        text: "Backends: test-backend (fs-write, network, mask-paths)",
      }),
    ]);
    const child = entries.find((e) => e.name === "sandbox-test")!;
    expect(child.parent).toBe("sandbox");
    expect(child.values).toEqual({ runner: "runner-a" });
  });

  it("applies a saved policy to the next spawn; the backend reads its own saved group", async () => {
    const seen: Seen[] = [];
    const { t, admin, spawn, sandbox } = await appWith(seen);
    apps.push(t);
    const saved = await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { mode: "workspace-write", cutNetwork: true, maskPaths: [" /etc/x ", "/etc/x", ""] },
    });
    expect(saved.status).toBe(200);
    expect(sandbox.currentSettings()).toEqual({
      mode: "workspace-write",
      network: "none",
      maskPaths: ["/etc/x"],
    });
    expect(
      (
        await admin.put("/api/admin/plugin-config", {
          name: "sandbox-test",
          values: { runner: "runner-b" },
        })
      ).status,
    ).toBe(200);
    expect(spawn()).toEqual(["confined", "true"]);
    expect(seen.at(-1)).toEqual({
      policy: {
        mode: "workspace-write",
        workspaceRoot: "/w",
        network: "none",
        maskPaths: ["/etc/x"],
        writableTemp: true,
      },
      runner: "runner-b",
    });

    await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { mode: "read-only", cutNetwork: false, maskPaths: [], writableTemp: false },
    });
    expect(sandbox.currentSettings()).toEqual({ mode: "read-only", writableTemp: false });
    spawn();
    expect(seen.at(-1)?.policy).toEqual({ mode: "read-only", workspaceRoot: "/w" });
    expect(sandbox.parkedSettings()).toEqual({ mode: "read-only", writableTemp: false });

    const refused = await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { mode: "wide-open" },
    });
    expect(refused.status).toBe(400);
    // A relative masked path would resolve against the server's working directory.
    const relative = await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { maskPaths: ["/etc/x", ".ssh"] },
    });
    expect(relative.status).toBe(400);
    expect(sandbox.currentSettings().maskPaths).toBeUndefined();
    expect(sandbox.currentSettings().mode).toBe("read-only");
  });

  it("names a failed backend with its reason and the ones meant for another platform, and warns when the saved mode cannot be enforced", async () => {
    const host = new PluginHost();
    host.use({
      specifier: "wrong-platform",
      modules: [
        {
          manifest: parseManifest({
            name: "WrongPlatformBackend",
            requires: {},
            provides: {},
            contributes: {
              "SandboxModule.providers": [
                { id: "wrong.provider", name: "wrong-backend", dimensions: ["fs-write"] },
                { id: "elsewhere.provider", name: "other-platform", dimensions: ["fs-write"] },
              ],
            },
            children: [],
          }),
          create: () => ({
            api: {},
            bind: {
              "wrong.provider": Promise.reject(new Error("'bwrap' is missing")),
              // A backend for another platform declines: not a failure, and not named on its own.
              "elsewhere.provider": Promise.resolve(null),
            },
          }),
        },
      ],
      replaces: [],
    });
    const t = await createTestApp({ plugins: host });
    apps.push(t);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    await t.deps.tree.api<SandboxService>("SandboxModule", "sandbox").whenReady();
    await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { mode: "workspace-write" },
    });
    const entries = (
      (await (await admin.get("/api/admin/plugin-config")).json()) as PluginConfigResponse
    ).plugins;
    const notices = entries
      .find((e) => e.name === "sandbox")!
      .notices!.map((n) => [n.tone, n.text]);
    expect(notices).toEqual([
      [
        "attention",
        "The saved mode needs fs-write, and no usable backend implements it: every agent command is refused until one does.",
      ],
      [
        "attention",
        "This deployment has no usable sandbox backend: until one for this platform is installed from the Plugins page, every mode but Off refuses every agent command. other-platform is installed, but for another platform.",
      ],
      ["attention", "wrong-backend is not in use: 'bwrap' is missing"],
    ]);
  });

  it("loads a backend that failed its check again when its group is saved, and answers with the outcome", async () => {
    const host = new PluginHost();
    host.use({
      specifier: "probed-backend",
      modules: [
        {
          manifest: parseManifest({
            name: "ProbedBackend",
            requires: {
              config: {
                iface: "@prismshadow/penguin-server#PluginConfig",
                from: "PluginConfigModule",
              },
            },
            provides: {},
            contributes: {
              "SandboxModule.providers": [
                { id: "probed.provider", name: "probed", dimensions: ["fs-write"] },
              ],
              "PluginConfigProvider.groups": [
                {
                  id: "sandbox-probed",
                  parent: "sandbox",
                  title: "Probed backend",
                  properties: {
                    runner: { type: "string", title: "Runner", default: "/opt/bwarp" },
                  },
                },
              ],
            },
            children: [],
          }),
          create({ use }) {
            const config = use.config as PluginConfig;
            return {
              api: {},
              bind: {
                // A loader, the way bwrap binds one: it checks the runner its group names.
                "probed.provider": async () => {
                  const runner = config.get("sandbox-probed").runner;
                  if (runner !== "/usr/bin/bwrap")
                    throw new Error(`'${String(runner)}' is missing`);
                  return {
                    confine: (argv: readonly string[]) => ({
                      argv: ["probed", ...argv],
                      enforcement: "full" as const,
                      denialSignatures: [],
                      runnerFailureRules: [],
                    }),
                  };
                },
              },
            };
          },
        },
      ],
      replaces: [],
    });
    const t = await createTestApp({ plugins: host });
    apps.push(t);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const sandbox = t.deps.tree.api<SandboxService>("SandboxModule", "sandbox");
    await sandbox.whenReady();
    expect(sandbox.failures()).toEqual([{ name: "probed", reason: "'/opt/bwarp' is missing" }]);

    const saved = await admin.put("/api/admin/plugin-config", {
      name: "sandbox-probed",
      values: { runner: "/usr/bin/bwrap" },
    });
    expect(saved.status).toBe(200);
    const card = ((await saved.json()) as PluginConfigResponse).plugins.find(
      (e) => e.name === "sandbox",
    )!;
    expect(card.notices?.map((n) => n.text)).toEqual(["Backends: probed (fs-write)"]);
    expect(sandbox.failures()).toEqual([]);
    sandbox.configure({ mode: "read-only" });
    expect(sandbox.confiner()(["true"], { workspaceDir: "/w" } as never)).toEqual([
      "probed",
      "true",
    ]);
  });

  it("keeps what was saved across a restart", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-sandbox-settings-"));
    const dbPath = path.join(dir, "web.db");
    try {
      const first = await appWith([], dbPath);
      await first.admin.put("/api/admin/plugin-config", {
        name: "sandbox",
        values: { mode: "read-only" },
      });
      await first.admin.put("/api/admin/plugin-config", {
        name: "sandbox-test",
        values: { runner: "runner-c" },
      });
      await first.t.cleanup();

      const seen: Seen[] = [];
      const second = await appWith(seen, dbPath);
      apps.push(second.t);
      expect(second.sandbox.currentSettings()).toEqual({ mode: "read-only" });
      second.spawn();
      expect(seen.at(-1)?.runner).toBe("runner-c");
    } finally {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
