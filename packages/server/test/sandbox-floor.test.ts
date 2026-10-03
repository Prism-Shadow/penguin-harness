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
 * - Given a policy closing temp, only a backend declaring closed-temp serves it (the adaptor
 *   never does); with the adaptor alone the card greys out turning temp off and refuses saving
 *   it, while bubblewrap lets it be saved. The composer is told which backends are in use.
 * - A runner's informational lines reach the spawn, which drops them from the command's stderr.
 * - The headline names each backend adding a dimension, and discloses the serving backends'
 *   limits before why the others are not in use.
 */
import { afterEach, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { SandboxDimension, SandboxProvider } from "@prismshadow/penguin-core/plugin";
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
        text: "Enforced here: file writes, by Landlock (dsh-local). Not enforced here: network isolation, localhost-only network, masked paths and closing the temporary directory.",
        textZh:
          "本机实施：文件写入，由 Landlock (dsh-local) 实施。本机不实施：网络隔离、仅本机网络、屏蔽路径、关闭临时目录。",
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
      // Temp cannot be closed either: its off position is greyed out (below).
      expect.objectContaining({ field: "writableTemp", value: "false" }),
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
        "Enforced here: file writes, network isolation, masked paths and closing the temporary directory, by bubblewrap (penguin-bwrap). Not enforced here: localhost-only network.",
        undefined,
      ],
    ]);
    expect(entry.unavailable?.map((u) => u.value)).toEqual(["local"]);
  });
});

describe("closing the temporary directory", () => {
  it("is routed only to a backend declaring closed-temp, and refused where none does", async () => {
    const dsh = fake("dsh", undefined, "Landlock");
    const svc = new SandboxService([["dsh-local", dsh.provider]]);
    await svc.whenReady();
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
    const both = new SandboxService([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    await both.whenReady();
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
    const svc = new SandboxService([["dsh-local", landlock]]);
    await svc.whenReady();
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()(ARGV, OPTS)).toEqual({
      argv: ["landlock-run", "--", ...ARGV],
      runnerLines: [LINE],
    });
    // A runner that reports nothing adds no field.
    const plain = new SandboxService([["dsh-local", fake("dsh").provider]]);
    await plain.whenReady();
    plain.configure({ mode: "workspace-write" });
    expect(plain.confiner()(ARGV, OPTS)).toEqual({ argv: ["dsh", ...ARGV] });
  });
});

describe("the sandbox card names what serves and what it leaves open", () => {
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
    return { admin, card, save };
  }

  it("greys out closing temp where only the adaptor serves, and refuses saving it", async () => {
    const { card, save } = await boot("refused");
    expect((await card()).unavailable).toContainEqual({
      field: "writableTemp",
      value: "false",
      reason:
        "the sandbox backend in use here (dsh-local) cannot close the temporary directory: it stays writable",
      reasonZh: "本机在用的沙盒后端（dsh-local）无法关闭临时目录：它始终可写",
    });
    const refused = await save({ writableTemp: false });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(
      '"writableTemp" cannot be "false" here',
    );
    // Turning it on (where a backend went away since it was saved off) is never refused.
    expect((await save({ writableTemp: true })).status).toBe(200);
  });

  it("lets temp be closed where bubblewrap serves", async () => {
    const { card, save } = await boot("serving");
    expect((await card()).unavailable?.some((u) => u.field === "writableTemp")).toBe(false);
    expect((await save({ writableTemp: false })).status).toBe(200);
  });

  it("tells the composer which backends are in use, so it can name them", async () => {
    const { admin } = await boot("refused");
    // The seeded admin owns default_project.
    const defaults = (await (
      await admin.get("/api/projects/default_project/chat-defaults")
    ).json()) as { sandbox: { backendsInUse?: string[] } };
    expect(defaults.sandbox.backendsInUse).toEqual(["dsh-local"]);
  });
});

describe("the enforcement headline", () => {
  const backend = (
    name: string,
    dimensions: SandboxDimension[],
    mechanism?: string,
    limits?: Array<{ text: string; textZh?: string }>,
  ) => ({
    name,
    dimensions,
    ...(mechanism !== undefined ? { mechanism } : {}),
    ...(limits !== undefined ? { limits } : {}),
  });

  it("names every backend that adds a dimension, and only those", () => {
    const notice = enforcementNotice(
      [
        backend("penguin-bwrap", BWRAP_DIMENSIONS, "bubblewrap"),
        backend("dsh-local", ["fs-write"], "Landlock"),
        backend("local-net", ["fs-write", "network-local"]),
      ],
      [],
    );
    expect(notice.text).toBe(
      "Enforced here: file writes, network isolation, localhost-only network, masked paths and closing the temporary directory, by bubblewrap (penguin-bwrap) and local-net.",
    );
    expect(notice.textZh).toContain("由 bubblewrap (penguin-bwrap)、local-net 实施");
  });

  it("discloses the serving backend's limits, before why others are not in use", () => {
    const notice = enforcementNotice(
      [
        backend("dsh-local", ["fs-write"], "Landlock (partial)", [
          { text: "scratchpad not writable", textZh: "scratchpad 不可写" },
        ]),
      ],
      [{ name: "penguin-bwrap", reason: "refused" }],
    );
    expect(notice.details).toBe(
      "scratchpad not writable\npenguin-bwrap is installed but not in use: refused\nSaving this card checks these backends again.",
    );
    expect(notice.detailsZh?.split("\n")[0]).toBe("scratchpad 不可写");
    // With no backend failing, the limits stand alone, and nothing is checked again.
    expect(
      enforcementNotice([backend("dsh-local", ["fs-write"], "Landlock", [{ text: "x" }])], [])
        .details,
    ).toBe("x");
  });
});
