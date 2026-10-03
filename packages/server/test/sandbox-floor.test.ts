/**
 * The Linux floor: where bubblewrap is refused (a default Ubuntu 23.10 or later restricts
 * unprivileged user namespaces to AppArmor-profiled programs), the DSH adaptor confines files
 * through Landlock, and the card says so.
 *
 * - Given two backends implementing as much, registration order decides; given bubblewrap
 *   refused beside the adaptor, a files-only policy goes to the adaptor and a network cut is
 *   refused, naming why bubblewrap is not in use.
 * - Given bubblewrap refused and the adaptor serving, the card says files are enforced by
 *   Landlock and the network and masked paths are not, discloses bubblewrap's reason under that
 *   with the re-check, greys out No network and Localhost only naming the adaptor, refuses a
 *   save choosing No network, and warns when the saved masked paths make every command refused.
 * - Given both serving, the card names bubblewrap and only Localhost only is greyed out.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { SandboxDimension, SandboxProvider } from "@prismshadow/penguin-core/plugin";
import type { PluginConfigEntry, PluginConfigResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { SandboxService } from "../src/sandbox/index.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const ARGV = ["bash", "-lc", "echo hi"];
const OPTS = { cwd: "/work/project", workspaceDir: "/work/project" };
const BWRAP_DIMENSIONS: SandboxDimension[] = ["fs-write", "network", "mask-paths"];
const REFUSED =
  "'bwrap' is missing or refuses the base profile (setting up uid map: Permission denied)";

/** A backend that prefixes its label; `dimensions` absent = filesystem only. */
function fake(label: string, dimensions?: SandboxDimension[], mechanism?: string) {
  const calls: string[][] = [];
  const provider: SandboxProvider = {
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(mechanism !== undefined ? { mechanism } : {}),
    confine(argv) {
      calls.push([...argv]);
      return {
        argv: [label, ...argv],
        enforcement: "full",
        denialSignatures: [],
        runnerFailureRules: [],
      };
    },
  };
  return { provider, calls };
}

describe("routing between bubblewrap and the DSH adaptor", () => {
  it("between backends implementing as much, registration order decides", async () => {
    const first = fake("first", ["fs-write", "network"]);
    const second = fake("second", ["fs-write", "mask-paths"]);
    const svc = new SandboxService([
      ["first", first.provider],
      ["second", second.provider],
    ]);
    await svc.whenReady();
    svc.configure({ mode: "read-only" });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(["first", ...ARGV]);
    // A requirement only the second covers still reaches it.
    svc.configure({ mode: "read-only", maskPaths: ["/k"] });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(["second", ...ARGV]);
  });

  it("where bubblewrap is refused, the adaptor serves files and a network cut fails closed", async () => {
    const dsh = fake("dsh", undefined, "Landlock");
    const svc = new SandboxService([
      ["penguin-bwrap", () => Promise.reject(new Error(REFUSED))],
      ["dsh-local", dsh.provider],
    ]);
    await svc.whenReady();
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(["dsh", ...ARGV]);
    expect(svc.backends()).toEqual([
      { name: "dsh-local", dimensions: ["fs-write"], mechanism: "Landlock" },
    ]);
    // Never confined less than asked: the network cut is refused, naming why bubblewrap is out.
    svc.configure({ mode: "workspace-write", network: "none" });
    expect(() => svc.confiner()(ARGV, OPTS)).toThrow(
      `sandbox policy requires fs-write + network, but no mounted sandbox backend implements all of it (dsh-local: fs-write); backends not in use: penguin-bwrap (${REFUSED}); refusing to run the command unconfined.`,
    );
    expect(dsh.calls).toHaveLength(1);
  });
});

/** A plugin contributing bubblewrap (refused or serving) and the adaptor, as Linux installs them. */
function linuxBackends(bwrap: "refused" | "serving"): PluginHost {
  const module: ModuleDef = {
    manifest: parseManifest({
      name: "LinuxBackends",
      requires: {},
      provides: {},
      contributes: {
        "SandboxModule.providers": [
          { id: "bwrap.provider", name: "penguin-bwrap", dimensions: BWRAP_DIMENSIONS },
          { id: "dsh.provider", name: "dsh-local", dimensions: ["fs-write"] },
        ],
      },
      children: [],
    }),
    create: () => ({
      api: {},
      bind: {
        "bwrap.provider":
          bwrap === "serving"
            ? fake("bwrap", BWRAP_DIMENSIONS, "bubblewrap").provider
            : () => Promise.reject(new Error(REFUSED)),
        "dsh.provider": fake("dsh", ["fs-write"], "Landlock").provider,
      },
    }),
  };
  const host = new PluginHost();
  host.use({ specifier: "linux-backends", modules: [module], replaces: [] });
  return host;
}

describe("the sandbox card on the Linux floor", () => {
  const apps: TestApp[] = [];
  afterEach(async () => {
    for (const t of apps.splice(0)) await t.cleanup();
  });

  async function boot(bwrap: "refused" | "serving") {
    const t = await createTestApp({ plugins: linuxBackends(bwrap) });
    apps.push(t);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    await t.deps.tree.api<SandboxService>("SandboxModule", "sandbox").whenReady();
    const card = async (): Promise<PluginConfigEntry> =>
      (
        (await (await admin.get("/api/admin/plugin-config")).json()) as PluginConfigResponse
      ).plugins.find((e) => e.name === "sandbox")!;
    const save = (values: Record<string, unknown>) =>
      admin.put("/api/admin/plugin-config", { name: "sandbox", values });
    return { card, save };
  }

  it("says files only, by Landlock, and discloses why bubblewrap is not in use", async () => {
    const { card } = await boot("refused");
    const entry = await card();
    expect(entry.notices).toEqual([
      {
        tone: "muted",
        text: "Enforced here: file writes, by Landlock (dsh-local). Not enforced here: network isolation, localhost-only network and masked paths.",
        textZh:
          "本机实施：文件写入，由 Landlock (dsh-local) 实施。本机不实施：网络隔离、仅本机网络、屏蔽路径。",
        details: `penguin-bwrap is installed but not in use: ${REFUSED}\nSaving this card checks these backends again.`,
        detailsZh: `penguin-bwrap 已安装但未启用：${REFUSED}\n保存此卡片会重新检查这些后端。`,
      },
    ]);
    // A backend for this OS is installed: nothing is offered.
    expect(entry.backend?.installed).toBe(true);
  });

  it("greys out the network limits the adaptor cannot enforce, and refuses saving No network", async () => {
    const { card, save } = await boot("refused");
    expect((await card()).unavailable).toEqual([
      expect.objectContaining({ column: "network", value: "local" }),
      {
        field: "presets",
        column: "network",
        value: "none",
        reason:
          "the sandbox backend in use here (dsh-local) confines files only and does not isolate the network",
        reasonZh: "本机在用的沙盒后端（dsh-local）只封禁文件，不隔离网络",
      },
    ]);
    const refused = await save({ presets: { "workspace-write": { network: "none" } } });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      '"presets.workspace-write.network" cannot be "none" here: the sandbox backend in use here (dsh-local) confines files only',
    );
    // Every built-in preset keeps the network open: the default table saves as it is.
    expect((await save({ enabled: true })).status).toBe(200);
  });

  it("warns that saved masked paths refuse every command", async () => {
    const { card, save } = await boot("refused");
    expect((await save({ enabled: true, maskPaths: ["/k"] })).status).toBe(200);
    expect((await card()).notices?.[0]).toMatchObject({
      tone: "attention",
      text: "The saved mode needs fs-write + mask-paths, and no usable backend implements it: every agent command and hook script is refused until one does.",
    });
  });

  it("names bubblewrap where it serves, and greys out only Localhost only", async () => {
    const { card } = await boot("serving");
    const entry = await card();
    expect(entry.notices?.map((n) => [n.text, n.details])).toEqual([
      [
        "Enforced here: file writes, network isolation and masked paths, by bubblewrap (penguin-bwrap). Not enforced here: localhost-only network.",
        undefined,
      ],
    ]);
    expect(entry.unavailable?.map((u) => u.value)).toEqual(["local"]);
  });
});
