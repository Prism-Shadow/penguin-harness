/**
 * Sandbox settings are settings groups: the sandbox's policy and each mounted backend's own
 * options are listed, validated and stored through /api/admin/plugin-config like any plugin's,
 * and what is saved reaches the service — the policy at the next spawn, the backend's options
 * in that policy — and survives a restart.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { SandboxPolicy } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import type { SandboxService } from "../src/sandbox/service.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A backend declaring one option, recording the policy each confine receives. */
function backend(seen: SandboxPolicy[]): ModuleDef {
  return {
    manifest: parseManifest({
      name: "TestBackend",
      requires: {},
      provides: {},
      contributes: {
        "SandboxModule.providers": [
          {
            id: "test.provider",
            name: "test-backend",
            dimensions: ["fs-write", "network", "mask-paths"],
            configuration: {
              title: "Test backend",
              properties: {
                runner: { type: "string", title: "Runner", default: "runner-a" },
              },
            },
          },
        ],
      },
      children: [],
    }),
    create() {
      return {
        api: {},
        bind: {
          "test.provider": {
            dimensions: ["fs-write", "network", "mask-paths"],
            confine(argv: readonly string[], policy: SandboxPolicy) {
              seen.push(policy);
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

async function appWith(seen: SandboxPolicy[], dbPath?: string) {
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

describe("sandbox settings groups", () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    for (const t of apps.splice(0)) await t.cleanup();
  });

  it("lists the sandbox with its backends, and each backend's options inside it", async () => {
    const seen: SandboxPolicy[] = [];
    const { t, list } = await appWith(seen);
    apps.push(t);
    const entries = await list();
    const sandbox = entries.find((e) => e.name === "sandbox")!;
    expect(sandbox.values).toEqual({ mode: "danger-full-access", cutNetwork: false });
    expect(sandbox.notices).toEqual([
      expect.objectContaining({
        tone: "muted",
        text: "Backends: test-backend (fs-write, network, mask-paths)",
      }),
    ]);
    const child = entries.find((e) => e.name === "sandbox:test-backend")!;
    expect(child.parent).toBe("sandbox");
    expect(child.values).toEqual({ runner: "runner-a" });
  });

  it("applies a saved policy and the backend's options to the next spawn", async () => {
    const seen: SandboxPolicy[] = [];
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
          name: "sandbox:test-backend",
          values: { runner: "runner-b" },
        })
      ).status,
    ).toBe(200);
    expect(spawn()).toEqual(["confined", "true"]);
    expect(seen.at(-1)).toMatchObject({
      mode: "workspace-write",
      network: "none",
      maskPaths: ["/etc/x"],
      options: { runner: "runner-b" },
    });

    const refused = await admin.put("/api/admin/plugin-config", {
      name: "sandbox",
      values: { mode: "wide-open" },
    });
    expect(refused.status).toBe(400);
    expect(sandbox.currentSettings().mode).toBe("workspace-write");
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
        name: "sandbox:test-backend",
        values: { runner: "runner-c" },
      });
      await first.t.cleanup();

      const seen: SandboxPolicy[] = [];
      const second = await appWith(seen, dbPath);
      apps.push(second.t);
      expect(second.sandbox.currentSettings()).toEqual({ mode: "read-only" });
      second.spawn();
      expect(seen.at(-1)?.options).toEqual({ runner: "runner-c" });
    } finally {
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});
