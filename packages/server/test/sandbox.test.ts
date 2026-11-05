/**
 * Behavior tests for the sandbox service: the built-in interface's optional
 * dimensions, capability routing across backends, fail-closed refusal, and the
 * settings' ride on the parked platform context.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { boot, initialDoc, parseManifest } from "@prismshadow/penguin-core/kernel";
import type { Json } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "@prismshadow/penguin-hmr";
import { PENGUIN_FAMILY, HMR_INTERFACES_RESOURCE_ID } from "../src/hmr/capabilities.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import { PluginHost, PLUGINS_RESOURCE_ID } from "../src/plugin/host.js";
import { SandboxService } from "../src/sandbox/index.js";
import type {
  SandboxDimension,
  SandboxPolicy,
  SandboxProvider,
  SandboxProviderSource,
} from "@prismshadow/penguin-core/plugin";

const ARGV = ["bash", "-lc", "echo hi"] as const;
const OPTS = { cwd: "/work/project/sub", workspaceDir: "/work/project" };

/** A recording backend; `dimensions` absent = an undeclared (filesystem-only) backend. */
function fake(label: string, dimensions?: readonly SandboxDimension[]) {
  const calls: SandboxPolicy[] = [];
  const provider: SandboxProvider = {
    ...(dimensions !== undefined ? { dimensions } : {}),
    confine(argv, policy) {
      calls.push(policy);
      return {
        argv: [label, "--", ...argv],
        enforcement: "full",
        denialSignatures: ["permission denied"],
        runnerFailureRules: [{ fatalSignatures: [`${label}: `] }],
      };
    },
  };
  return { provider, calls };
}

const tmpDirs: string[] = [];
/** A fresh directory on disk, for the cases where the confiner touches the scratchpad. */
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-sandbox-svc-"));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

async function service(entries: Array<[string, SandboxProviderSource]>): Promise<SandboxService> {
  const svc = new SandboxService(entries);
  await svc.whenReady();
  return svc;
}

describe("sandbox service — the built-in interface and its optional dimensions", () => {
  it("default settings are danger-full-access: argv passes through, no backend is consulted", async () => {
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual([...ARGV]);
    expect(dsh.calls).toHaveLength(0);
  });

  it("a confining mode with no backend mounted fails closed", async () => {
    const svc = await service([]);
    svc.configure({ mode: "workspace-write" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(/no sandbox backend is mounted/);
  });

  it("a backend that fails to load is named in the fail-closed message", async () => {
    const svc = await service([
      ["dsh-local", Promise.reject(new Error("Cannot find module 'landlock-run'"))],
    ]);
    svc.configure({ mode: "read-only" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(
      /not in use: dsh-local \(Cannot find module 'landlock-run'\)/,
    );
  });

  it("separates a backend that declines this host from one that failed on it", async () => {
    const svc = await service([
      ["quiet", Promise.resolve(null)],
      ["loud", Promise.reject(new Error("'bwrap' is missing"))],
    ]);
    expect(svc.backends()).toEqual([]);
    expect(svc.declined()).toEqual(["quiet"]);
    expect(svc.failures()).toEqual([{ name: "loud", reason: "'bwrap' is missing" }]);
    svc.configure({ mode: "read-only" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(
      /loud \('bwrap' is missing\); quiet \(not for this host\)/,
    );
  });

  it("a failed loader loads again on retry and mounts in its routing place; a failed promise cannot", async () => {
    const bwrap = fake("bwrap", ["fs-write", "network"]);
    const dsh = fake("dsh");
    let runner = "/opt/bwarp";
    const loader = vi.fn(async () => {
      if (runner !== "bwrap") throw new Error(`'${runner}' is missing`);
      return bwrap.provider;
    });
    const svc = await service([
      ["bwrap", loader],
      ["gone", Promise.reject(new Error("MODULE_NOT_FOUND"))],
      ["dsh-local", dsh.provider],
    ]);
    expect(svc.failures().map((f) => f.name)).toEqual(["bwrap", "gone"]);
    runner = "bwrap";
    await svc.retryFailed();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(svc.failures()).toEqual([{ name: "gone", reason: "MODULE_NOT_FOUND" }]);
    // Registration order is routing order: the recovered backend comes before dsh-local.
    expect(svc.backends().map((b) => b.name)).toEqual(["bwrap", "dsh-local"]);
    svc.configure({ mode: "read-only" });
    expect(svc.confiner()([...ARGV], OPTS).argv[0]).toBe("bwrap");
    // A mounted backend is not loaded again.
    await svc.retryFailed();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("of two retries in flight, the later one's outcome stands even if it settles first", async () => {
    const good = fake("bwrap");
    const pending: Array<(p: SandboxProvider | null) => void> = [];
    const rejecting: Array<(e: Error) => void> = [];
    let calls = 0;
    const svc = await service([
      [
        "bwrap",
        () => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error("'/opt/bwarp' is missing"));
          return new Promise<SandboxProvider | null>((resolve, reject) => {
            pending.push(resolve);
            rejecting.push(reject);
          });
        },
      ],
    ]);
    const older = svc.retryFailed();
    const newer = svc.retryFailed();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!(good.provider);
    await newer;
    rejecting[0]!(new Error("'/opt/bwarp' is missing"));
    await older;
    expect(svc.failures()).toEqual([]);
    expect(svc.backends().map((b) => b.name)).toEqual(["bwrap"]);
  });

  it("an installation missing a backend package keeps the platform usable, sandbox aside", async () => {
    // The deployed-machine shape (see scripts/deploy.mjs): the load fails, the default
    // settings keep working, and only a confining mode fails.
    const svc = await service([["dsh-local", Promise.reject(new Error("MODULE_NOT_FOUND"))]]);
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual([...ARGV]);
    svc.configure({ mode: "workspace-write" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(/MODULE_NOT_FOUND/);
  });

  it("an undeclared backend is filesystem-only, and a filesystem policy routes to it", async () => {
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["dsh", "--", ...ARGV]);
    // workspaceRoot is the Workspace, never the per-command cwd.
    expect(dsh.calls[0]).toMatchObject({ mode: "workspace-write", workspaceRoot: "/work/project" });
    expect(svc.backends()).toEqual([{ name: "dsh-local", dimensions: ["fs-write"] }]);
  });

  it("the Session's scratchpad reaches the backend as a further writable root, and without one no such field does", async () => {
    const scratchpad = path.join(tmp(), "scratchpad", "session-1");
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    const confine = svc.confinerFor(() => ({ mode: "workspace-write" }));
    confine([...ARGV], { ...OPTS, scratchpadDir: scratchpad });
    confine([...ARGV], OPTS);
    expect(dsh.calls[0]).toMatchObject({
      workspaceRoot: "/work/project",
      writableRoots: [scratchpad],
    });
    expect(dsh.calls[1]).not.toHaveProperty("writableRoots");
  });

  it("a scratchpad missing on disk is created before the backend sees it, and an existing one is left as it is", async () => {
    // bwrap refuses to start on a missing bind source; a command may delete it mid-Session.
    const scratchpad = path.join(tmp(), "scratchpad", "session-1");
    const existed: boolean[] = [];
    const dsh = fake("dsh");
    const svc = await service([
      [
        "dsh-local",
        {
          confine(argv, policy) {
            existed.push(fs.existsSync(policy.writableRoots![0]!));
            return dsh.provider.confine(argv, policy);
          },
        },
      ],
    ]);
    const confine = () =>
      svc.confinerFor(() => ({ mode: "workspace-write" }))([...ARGV], {
        ...OPTS,
        scratchpadDir: scratchpad,
      });
    confine();
    fs.writeFileSync(path.join(scratchpad, "plan.md"), "keep me");
    confine();
    expect(fs.readFileSync(path.join(scratchpad, "plan.md"), "utf8")).toBe("keep me");
    fs.rmSync(scratchpad, { recursive: true });
    confine();
    expect(existed).toEqual([true, true, true]);
  });

  it("a scratchpad that cannot be created fails closed, naming it, instead of confining without it", async () => {
    // A file where a parent directory belongs fails mkdir for every user, root included.
    const blocker = path.join(tmp(), "scratchpad");
    fs.writeFileSync(blocker, "");
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    const confine = svc.confinerFor(() => ({ mode: "workspace-write" }));
    expect(() =>
      confine([...ARGV], { ...OPTS, scratchpadDir: path.join(blocker, "session-1") }),
    ).toThrow(/cannot prepare the Session scratchpad .*session-1 for the sandbox \(E[A-Z]+:/);
    expect(dsh.calls).toHaveLength(0);
  });

  it("outside workspace-write the scratchpad is neither bound nor created", async () => {
    const scratchpad = path.join(tmp(), "scratchpad", "session-1");
    const bwrap = fake("bwrap", ["fs-write", "network"]);
    const svc = await service([["penguin-bwrap", bwrap.provider]]);
    for (const policy of [
      { mode: "read-only" },
      { mode: "danger-full-access", network: "none" },
    ] as const)
      svc.confinerFor(() => policy)([...ARGV], { ...OPTS, scratchpadDir: scratchpad });
    expect(bwrap.calls).toHaveLength(2);
    for (const call of bwrap.calls) expect(call).not.toHaveProperty("writableRoots");
    expect(fs.existsSync(scratchpad)).toBe(false);
  });

  it("requiring a dimension nothing implements is refused, naming what each backend does", async () => {
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    svc.configure({ mode: "workspace-write", network: "none" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(
      /requires fs-write \+ network, but no mounted sandbox backend implements all of it \(dsh-local: fs-write\)/,
    );
    // Never silently dropped: the backend was not consulted at all.
    expect(dsh.calls).toHaveLength(0);
  });
});

describe("sandbox service — capability routing across backends", () => {
  const entries = () => {
    const dsh = fake("dsh");
    const bwrap = fake("bwrap", ["fs-write", "network", "mask-paths"]);
    return { dsh, bwrap };
  };

  it("a filesystem-only policy goes to the backend implementing more, whatever the registration order", async () => {
    for (const order of ["dsh first", "bwrap first"]) {
      const { dsh, bwrap } = entries();
      const both: Array<[string, SandboxProviderSource]> = [
        ["dsh-local", dsh.provider],
        ["penguin-bwrap", bwrap.provider],
      ];
      const svc = await service(order === "dsh first" ? both : both.reverse());
      svc.configure({ mode: "workspace-write" });
      expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["bwrap", "--", ...ARGV]);
      expect(dsh.calls).toHaveLength(0);
      // The card reads them in the same preference.
      expect(svc.backends().map((b) => b.name)).toEqual(["penguin-bwrap", "dsh-local"]);
    }
  });

  it("a policy requiring network or mask-paths routes past it to the backend implementing them", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    svc.configure({ mode: "workspace-write", network: "none", maskPaths: ["/home/u/.ssh"] });
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["bwrap", "--", ...ARGV]);
    expect(dsh.calls).toHaveLength(0);
    expect(bwrap.calls[0]).toMatchObject({ network: "none", maskPaths: ["/home/u/.ssh"] });
  });

  it("full access still routes to a backend when it cuts the network (never dropped)", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    // Full access + no network is genuinely unconfined: it passes through.
    svc.configure({ mode: "danger-full-access" });
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual([...ARGV]);
    expect(bwrap.calls).toHaveLength(0);
    // But full access that ALSO cuts the network must reach a backend that can cut it — the
    // filesystem stays unrestricted, the network does not.
    svc.configure({ mode: "danger-full-access", network: "none" });
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["bwrap", "--", ...ARGV]);
    expect(bwrap.calls[0]).toMatchObject({ mode: "danger-full-access", network: "none" });
  });

  it("the local network level routes only to a backend declaring network-local", async () => {
    const { dsh, bwrap } = entries();
    const seatbelt = fake("seatbelt", ["fs-write", "network", "network-local", "mask-paths"]);
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
      ["penguin-seatbelt", seatbelt.provider],
    ]);
    svc.configure({ mode: "workspace-write", network: "local" });
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["seatbelt", "--", ...ARGV]);
    expect(bwrap.calls).toHaveLength(0);
    expect(seatbelt.calls[0]).toMatchObject({ network: "local" });
    // Full access with the local level still needs that backend: nothing is dropped.
    svc.configure({ mode: "danger-full-access", network: "local" });
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["seatbelt", "--", ...ARGV]);
  });

  it("the local network level fails closed where no backend declares it", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    svc.configure({ mode: "workspace-write", network: "local" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(/requires fs-write \+ network-local/);
    // Never read as "no network" or "open network" by a backend that cannot do it.
    expect(bwrap.calls).toHaveLength(0);
  });

  it("an empty maskPaths list does not require the dimension", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    svc.configure({ mode: "read-only", maskPaths: [] });
    // Either backend serves it: the one implementing more does.
    expect(svc.confiner()([...ARGV], OPTS).argv).toEqual(["bwrap", "--", ...ARGV]);
  });

  it("a backend throw (unusable runner, etc.) propagates — fail-closed end to end", async () => {
    const svc = await service([
      [
        "boom",
        {
          confine() {
            throw new Error("penguin-bwrap cannot confine on this host");
          },
        },
      ],
    ]);
    svc.configure({ mode: "workspace-write" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(/cannot confine on this host/);
  });
});

describe("sandbox settings ride the parked context across a swap", () => {
  /**
   * Boots the packaged platform over a fresh registry carrying one observer plugin, and
   * returns what a plugin sees at "create" — the surface an actual consumer has. The
   * confiner itself is same-generation wiring into buildAppDeps (no caps published here,
   * so no business surface boots); enforcement is covered by the service tests above.
   */
  async function bootObserved(doc: Json) {
    const resources = new HotResources();
    // A bare-kernel declaration — right family, no capabilities offered — is what makes a
    // terminals-only boot legal (see capabilities.ts's HmrClaim). The sandbox floor is
    // business-independent, so this is all these tests need behind the platform.
    resources.register(HMR_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
    // The observer is itself a plugin module requiring the sandbox — the surface an
    // actual consumer has.
    let seen: SandboxService | null = null;
    const host = new PluginHost();
    host.use({
      specifier: "observer",
      replaces: [],
      modules: [
        {
          manifest: parseManifest({
            name: "observer",
            requires: {
              sandbox: { iface: "@prismshadow/penguin-server#Sandbox", from: "SandboxModule" },
            },
            provides: {},
            contributes: {},
            children: [],
          }),
          create({ use }) {
            seen = use.sandbox as SandboxService;
            return { api: {} };
          },
        },
      ],
    });
    resources.register(PLUGINS_RESOURCE_ID, host);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const inst = await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, doc),
      resources,
    ).finally(() => warn.mockRestore());
    return { inst, ctx: () => ({ sandbox: { settings: () => seen!.currentSettings() } }) };
  }

  it("a confining mode survives park -> fresh boot instead of resetting to unconfined", async () => {
    // The settings live in the sandbox module's own parked document (platform v2).
    const a = await bootObserved({
      motd: "m",
      modules: { SandboxModule: { v: 1, self: { settings: { mode: "read-only" } } } },
    });
    try {
      expect(a.ctx().sandbox.settings()).toEqual({ mode: "read-only" });

      const parked = (await a.inst.api.park()) as {
        motd: string;
        modules: { SandboxModule?: { self: { settings?: { mode: string } } | null } };
      };
      expect(parked.modules.SandboxModule?.self).toEqual({ settings: { mode: "read-only" } });

      const b = await bootObserved(parked);
      try {
        expect(b.ctx().sandbox.settings()).toEqual({ mode: "read-only" });
      } finally {
        b.inst.dispose();
      }
    } finally {
      a.inst.dispose();
    }
  });

  it("the document stays readable across generations: a first-generation doc boots, and what parks is a first-generation doc", async () => {
    // The first platforms parked the settings as a top-level `sandbox` field, with no `modules`.
    const a = await bootObserved({ motd: "gen-1", sandbox: { mode: "read-only" } });
    try {
      expect(a.ctx().sandbox.settings()).toEqual({ mode: "read-only" });
      const parked = (await a.inst.api.park()) as {
        motd: string;
        sandbox?: unknown;
        modules: { SandboxModule?: { self: unknown }; sandbox?: unknown };
      };
      // Parked both ways: under the node for this generation, top-level for the first one —
      // so a rollback to a first-generation platform still confines.
      expect(parked.modules.SandboxModule?.self).toEqual({ settings: { mode: "read-only" } });
      expect(parked.sandbox).toEqual({ mode: "read-only" });
      // A document parked under the node's earlier hand-written name reads the same.
      const b = await bootObserved({
        motd: "gen-2",
        modules: { sandbox: { v: 1, self: { settings: { mode: "read-only" } } } },
      });
      try {
        expect(b.ctx().sandbox.settings()).toEqual({ mode: "read-only" });
      } finally {
        b.inst.dispose();
      }
    } finally {
      a.inst.dispose();
    }
  });

  it("a document parked before the sandbox field existed restores as the default (off)", async () => {
    const a = await bootObserved({ motd: "old-doc" });
    try {
      expect(a.ctx().sandbox.settings()).toEqual({ mode: "danger-full-access" });
      // Pristine settings park as nothing, not as present-and-default.
      const parked = (await a.inst.api.park()) as {
        motd: string;
        modules: { SandboxModule?: { self: unknown } };
      };
      expect(parked.modules.SandboxModule?.self ?? null).toBeNull();
      expect(parked.motd).toBe("old-doc");
    } finally {
      a.inst.dispose();
    }
  });
});
