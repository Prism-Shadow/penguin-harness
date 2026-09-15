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

  it("lists the sandbox with its backends' notice, and a backend's group inside it", async () => {
    const { t, list } = await appWith([]);
    apps.push(t);
    const entries = await list();
    const sandbox = entries.find((e) => e.name === "sandbox")!;
    expect(entries[0]).toBe(sandbox);
    expect(sandbox.values).toEqual({ mode: "danger-full-access", cutNetwork: false });
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
      },
      runner: "runner-b",
    });

    const refused = await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { mode: "wide-open" },
    });
    expect(refused.status).toBe(400);
    expect(sandbox.currentSettings().mode).toBe("workspace-write");
  });

  it("names a backend that is not in use with its reason, and warns when the saved mode cannot be enforced", async () => {
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
              ],
            },
            children: [],
          }),
          create: () => ({
            api: {},
            bind: {
              "wrong.provider": Promise.reject(
                new Error("wrong-backend runs on Linux only; this host is win32"),
              ),
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
        "This deployment has no usable sandbox backend: a mode confines nothing until one for this platform is installed from the Plugins page.",
      ],
      [
        "attention",
        "wrong-backend is not in use: wrong-backend runs on Linux only; this host is win32",
      ],
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
