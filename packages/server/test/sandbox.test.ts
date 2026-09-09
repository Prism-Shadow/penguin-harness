/**
 * Behavior tests for the sandbox service: the built-in interface's optional
 * dimensions, capability routing across backends, fail-closed refusal, and the
 * settings' ride on the parked platform context.
 */
import { describe, expect, it, vi } from "vitest";
import { boot, initialDoc, parseManifest } from "@prismshadow/penguin-core/kernel";
import type { Json } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { PENGUIN_FAMILY, RUNTIME_INTERFACES_RESOURCE_ID } from "../src/hmr/capabilities.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import { PluginHost, PLUGINS_RESOURCE_ID } from "../src/plugin/host.js";
import { SandboxService } from "../src/sandbox/index.js";
import type {
  SandboxDimension,
  SandboxPolicy,
  SandboxProvider,
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

async function service(
  entries: Array<[string, SandboxProvider | PromiseLike<SandboxProvider | null> | null]>,
): Promise<SandboxService> {
  const svc = new SandboxService(entries);
  await svc.whenReady();
  return svc;
}

describe("sandbox service — the built-in interface and its optional dimensions", () => {
  it("default settings are danger-full-access: argv passes through, no backend is consulted", async () => {
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    expect(svc.confiner()([...ARGV], OPTS)).toEqual([...ARGV]);
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
      /failed to load: dsh-local \(Cannot find module 'landlock-run'\)/,
    );
  });

  it("an installation missing a backend package keeps the platform usable, sandbox aside", async () => {
    // The deployed-machine shape (see scripts/deploy.mjs): the load fails, the default
    // settings keep working, and only a confining mode fails.
    const svc = await service([["dsh-local", Promise.reject(new Error("MODULE_NOT_FOUND"))]]);
    expect(svc.confiner()([...ARGV], OPTS)).toEqual([...ARGV]);
    svc.configure({ mode: "workspace-write" });
    expect(() => svc.confiner()([...ARGV], OPTS)).toThrow(/MODULE_NOT_FOUND/);
  });

  it("an undeclared backend is filesystem-only, and a filesystem policy routes to it", async () => {
    const dsh = fake("dsh");
    const svc = await service([["dsh-local", dsh.provider]]);
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()([...ARGV], OPTS)).toEqual(["dsh", "--", ...ARGV]);
    // workspaceRoot is the Workspace, never the per-command cwd.
    expect(dsh.calls[0]).toMatchObject({ mode: "workspace-write", workspaceRoot: "/work/project" });
    expect(svc.backends()).toEqual([{ name: "dsh-local", dimensions: ["fs-write"] }]);
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

  it("a filesystem-only policy takes the first backend covering it (the portable one)", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    svc.configure({ mode: "workspace-write" });
    expect(svc.confiner()([...ARGV], OPTS)).toEqual(["dsh", "--", ...ARGV]);
    expect(bwrap.calls).toHaveLength(0);
  });

  it("a policy requiring network or mask-paths routes past it to the backend implementing them", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    svc.configure({ mode: "workspace-write", network: "none", maskPaths: ["/home/u/.ssh"] });
    expect(svc.confiner()([...ARGV], OPTS)).toEqual(["bwrap", "--", ...ARGV]);
    expect(dsh.calls).toHaveLength(0);
    expect(bwrap.calls[0]).toMatchObject({ network: "none", maskPaths: ["/home/u/.ssh"] });
  });

  it("an empty maskPaths list does not require the dimension", async () => {
    const { dsh, bwrap } = entries();
    const svc = await service([
      ["dsh-local", dsh.provider],
      ["penguin-bwrap", bwrap.provider],
    ]);
    svc.configure({ mode: "read-only", maskPaths: [] });
    expect(svc.confiner()([...ARGV], OPTS)).toEqual(["dsh", "--", ...ARGV]);
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
    // terminals-only boot legal (see capabilities.ts's RuntimeClaim). The sandbox floor is
    // business-independent, so this is all these tests need behind the platform.
    resources.register(RUNTIME_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
    // The observer is itself a plugin module requiring the sandbox — the surface an
    // actual consumer has.
    let seen: SandboxService | null = null;
    const host = new PluginHost();
    host.use({
      specifier: "observer",
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
