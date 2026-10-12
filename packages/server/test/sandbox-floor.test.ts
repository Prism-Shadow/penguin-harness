/**
 * The Linux floor: where bubblewrap is refused (a default Ubuntu 23.10+), the DSH adaptor confines
 * files through Landlock, the service routes only what it implements, and the card says so.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type {
  SandboxDimension,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";
import type { PluginConfigEntry, PluginConfigResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import { SandboxService } from "../src/sandbox/index.js";
import { enforcementNotice } from "../src/sandbox/settings-status.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const ARGV = ["bash", "-lc", "echo hi"];
const OPTS = { cwd: "/work/project", workspaceDir: "/work/project" };
const BWRAP_DIMENSIONS: SandboxDimension[] = ["fs-write", "network", "mask-paths", "closed-temp"];
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

async function service(...entries: Array<[string, SandboxProviderSource]>) {
  const svc = new SandboxService(entries);
  await svc.whenReady();
  return svc;
}

describe("routing between bubblewrap and the DSH adaptor", () => {
  it("between backends implementing as much, registration order decides", async () => {
    const first = fake("first", ["fs-write", "network"]);
    const second = fake("second", ["fs-write", "mask-paths"]);
    const svc = await service(["first", first.provider], ["second", second.provider]);
    svc.configure({ mode: "read-only" });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(["first", ...ARGV]);
    // A requirement only the second covers still reaches it.
    svc.configure({ mode: "read-only", maskPaths: ["/k"] });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(["second", ...ARGV]);
  });

  it("where bubblewrap is refused, the adaptor serves files and a network cut fails closed", async () => {
    const dsh = fake("dsh", undefined, "Landlock");
    const svc = await service(
      ["penguin-bwrap", () => Promise.reject(new Error(REFUSED))],
      ["dsh-local", dsh.provider],
    );
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(["dsh", ...ARGV]);
    expect(svc.backends()).toEqual([
      { name: "dsh-local", dimensions: ["fs-write"], mechanism: "Landlock" },
    ]);
    svc.configure({ mode: "workspace-write", network: "none" });
    expect(() => svc.confiner()(ARGV, OPTS)).toThrow(
      `requires fs-write + network, but no mounted sandbox backend implements all of it (dsh-local: fs-write); backends not in use: penguin-bwrap (${REFUSED})`,
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
    const refusal = async (values: Record<string, unknown>) => {
      const res = await save(values);
      expect(res.status).toBe(400);
      return ((await res.json()) as { error: { message: string } }).error.message;
    };
    return { admin, card, save, refusal };
  }

  it("says files only, by Landlock, discloses why bubblewrap is not in use, and tells the composer", async () => {
    const { admin, card } = await boot("refused");
    const entry = await card();
    expect(entry.notices).toEqual([
      expect.objectContaining({
        tone: "muted",
        text: "Enforced here: file writes, by Landlock (dsh-local). Not enforced here: network isolation, localhost-only network, masked paths and closing the temporary directory.",
        details: `penguin-bwrap is installed but not in use: ${REFUSED}\nSaving this card checks these backends again.`,
        detailsZh: `penguin-bwrap 已安装但未启用：${REFUSED}\n保存此卡片会重新检查这些后端。`,
      }),
    ]);
    // A backend for this OS is installed: nothing is offered.
    expect(entry.backend?.installed).toBe(true);
    const defaults = (await (
      await admin.get("/api/projects/default_project/chat-defaults")
    ).json()) as { sandbox: { backendsInUse?: string[] } };
    expect(defaults.sandbox.backendsInUse).toEqual(["dsh-local"]);
  });

  it("greys out what the adaptor cannot enforce and refuses saving it", async () => {
    const { card, save, refusal } = await boot("refused");
    expect((await card()).unavailable).toEqual([
      expect.objectContaining({ column: "network", value: "local" }),
      expect.objectContaining({
        column: "network",
        value: "none",
        reason:
          "the sandbox backend in use here (dsh-local) confines files only and does not isolate the network",
      }),
      expect.objectContaining({
        field: "writableTemp",
        value: "false",
        reason:
          "the sandbox backend in use here (dsh-local) cannot close the temporary directory: it stays writable",
      }),
    ]);
    expect(await refusal({ presets: { "workspace-write": { network: "none" } } })).toContain(
      '"presets.workspace-write.network" cannot be "none" here',
    );
    expect(await refusal({ writableTemp: false })).toContain(
      '"writableTemp" cannot be "false" here',
    );
    // The default table keeps the network open, and turning temp on is never refused.
    expect((await save({ enabled: true, writableTemp: true })).status).toBe(200);
  });

  it("warns that saved masked paths refuse every command", async () => {
    const { card, save } = await boot("refused");
    expect((await save({ enabled: true, maskPaths: ["/k"] })).status).toBe(200);
    expect((await card()).notices?.[0]).toMatchObject({
      tone: "attention",
      text: expect.stringContaining("every agent command and hook script is refused"),
    });
  });

  it("names bubblewrap where it serves, greys out only Localhost only, and lets temp be closed", async () => {
    const { card, save } = await boot("serving");
    const entry = await card();
    expect(entry.notices?.map((n) => [n.text, n.details])).toEqual([
      [
        "Enforced here: file writes, network isolation, masked paths and closing the temporary directory, by bubblewrap (penguin-bwrap). Not enforced here: localhost-only network.",
        undefined,
      ],
    ]);
    expect(entry.unavailable?.map((u) => u.value)).toEqual(["local"]);
    expect((await save({ writableTemp: false })).status).toBe(200);
  });
});

describe("closing the temporary directory", () => {
  it("is routed only to a backend declaring closed-temp, and refused where none does", async () => {
    const dsh = fake("dsh", undefined, "Landlock");
    const svc = await service(["dsh-local", dsh.provider]);
    // The adaptor grants temp whatever the policy says: never handed one closing it.
    for (const mode of ["workspace-write", "read-only"] as const) {
      svc.configure({ mode, writableTemp: false });
      expect(() => svc.confiner()(ARGV, OPTS)).toThrow(
        "sandbox policy requires fs-write + closed-temp, but no mounted sandbox backend implements all of it (dsh-local: fs-write)",
      );
    }
    // Full access writes everywhere anyway: nothing to close, no backend asked.
    svc.configure({ mode: "danger-full-access", writableTemp: false });
    expect(svc.confiner()(ARGV, OPTS).argv).toEqual(ARGV);
    expect(dsh.calls).toHaveLength(0);

    const bwrap = fake("bwrap", BWRAP_DIMENSIONS, "bubblewrap");
    const both = await service(["dsh-local", dsh.provider], ["penguin-bwrap", bwrap.provider]);
    both.configure({ mode: "workspace-write", writableTemp: false });
    expect(both.confiner()(ARGV, OPTS).argv).toEqual(["bwrap", ...ARGV]);
  });
});

describe("the runner's informational lines", () => {
  it("reach the spawn as runnerLines, so it drops them from the command's stderr", async () => {
    const LINE = "landlock-run: partial enforcement (older Landlock ABI)";
    const landlock: SandboxProvider = {
      confine: (argv) => ({
        argv: ["landlock-run", "--", ...argv],
        enforcement: "partial",
        denialSignatures: [],
        runnerFailureRules: [{ fatalSignatures: ["landlock-run: "], informationalLines: [LINE] }],
      }),
    };
    const svc = await service(["dsh-local", landlock]);
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()(ARGV, OPTS)).toEqual({
      argv: ["landlock-run", "--", ...ARGV],
      runnerLines: [LINE],
    });
    // A runner that reports nothing adds no field.
    const plain = await service(["dsh-local", fake("dsh").provider]);
    plain.configure({ mode: "workspace-write" });
    expect(plain.confiner()(ARGV, OPTS)).toEqual({ argv: ["dsh", ...ARGV] });
  });
});

describe("the enforcement headline", () => {
  const dsh = { name: "dsh-local", dimensions: ["fs-write"] as SandboxDimension[] };

  it("names every backend that adds a dimension, and only those", () => {
    const notice = enforcementNotice(
      [
        { name: "penguin-bwrap", dimensions: BWRAP_DIMENSIONS, mechanism: "bubblewrap" },
        { ...dsh, mechanism: "Landlock" },
        { name: "local-net", dimensions: ["fs-write", "network-local"] },
      ],
      [],
    );
    expect(notice.text).toBe(
      "Enforced here: file writes, network isolation, localhost-only network, masked paths and closing the temporary directory, by bubblewrap (penguin-bwrap) and local-net.",
    );
    expect(notice.textZh).toContain("由 bubblewrap (penguin-bwrap)、local-net 实施");
  });

  it("discloses the serving backend's limits, before why others are not in use", () => {
    const limited = {
      ...dsh,
      limits: [{ text: "scratchpad not writable", textZh: "scratchpad 不可写" }],
    };
    const notice = enforcementNotice([limited], [{ name: "penguin-bwrap", reason: "refused" }]);
    expect(notice.details).toBe(
      "scratchpad not writable\npenguin-bwrap is installed but not in use: refused\nSaving this card checks these backends again.",
    );
    expect(notice.detailsZh?.split("\n")[0]).toBe("scratchpad 不可写");
    // With no backend failing, the limits stand alone, and nothing is checked again.
    expect(enforcementNotice([limited], []).details).toBe("scratchpad not writable");
  });
});
