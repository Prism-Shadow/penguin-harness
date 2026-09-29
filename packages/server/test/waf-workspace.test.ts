/**
 * The WAF workspace: an admin reads and changes its settings (403 for anyone else), Prepare
 * clones the shared repositories under PENGUIN_HOME/waf and installs the framework's and
 * navbar's dependencies, media arrives partial and sparse, and a product module is cloned on
 * first use — or started empty with origin set when its repository does not exist yet.
 *
 * git and npm are fakes: nothing here reaches a network or a real remote.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeployGitOptions, DeployGitResult } from "../src/activities/deploy-git.js";
import {
  normalizeWafWorkspaceSettings,
  type WafWorkspace,
  type WafWorkspaceSettings,
  defaultWafWorkspaceSettings,
  type WafWorkspaceStatus,
} from "../src/activities/waf-workspace.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });

/** A git that keeps each repository as a `.git` folder holding its origin and sparse paths. */
function fakeGit(existing: ReadonlySet<string> = new Set()) {
  const calls: Array<{ args: string[]; cwd: string; env?: Record<string, string> }> = [];
  const read = (dir: string, name: string) =>
    fs.readFile(path.join(dir, ".git", name), "utf8").catch(() => null);
  const runGit = async (
    args: string[],
    cwd: string,
    opts?: DeployGitOptions,
  ): Promise<DeployGitResult> => {
    calls.push({ args, cwd, ...(opts?.env ? { env: opts.env } : {}) });
    const joined = args.join(" ");
    if (args[0] === "clone") {
      const [remote, dir] = args.slice(args.indexOf("--") + 1);
      await fs.mkdir(path.join(dir!, ".git"), { recursive: true });
      await fs.writeFile(path.join(dir!, ".git", "origin"), remote!);
      return ok();
    }
    if (args[0] === "ls-remote") {
      const remote = args[args.length - 1]!;
      return existing.has(remote)
        ? ok("abc\trefs/heads/main\n")
        : { code: 128, stdout: "", stderr: "ERROR: Repository not found." };
    }
    if (args[0] === "init") {
      await fs.mkdir(path.join(cwd, ".git"), { recursive: true });
      return ok();
    }
    if (joined.startsWith("remote add origin ")) {
      await fs.writeFile(path.join(cwd, ".git", "origin"), args[3]!);
      return ok();
    }
    const origin = await read(cwd, "origin");
    if (origin === null) return { code: 128, stdout: "", stderr: "not a git repository" };
    if (joined === "remote get-url origin") return ok(`${origin}\n`);
    if (joined === "branch --show-current") return ok("main\n");
    if (joined === "status --porcelain") return ok("");
    if (joined === "lfs install --local") return ok();
    if (args[0] === "lfs" && args[1] === "pull") return ok();
    if (args[0] === "sparse-checkout") {
      const current = ((await read(cwd, "sparse")) ?? "").split("\n").filter(Boolean);
      if (args[1] === "list") return ok(current.join("\n"));
      const next = [...current, ...args.slice(args.indexOf("--") + 1)];
      await fs.writeFile(path.join(cwd, ".git", "sparse"), next.join("\n"));
      return ok();
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
  };
  return { calls, runGit };
}

describe("WAF workspace", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(existing?: ReadonlySet<string>, options: { autoPrepare?: boolean } = {}) {
    vi.stubEnv("WAF_ROOT_DIR", "");
    const git = fakeGit(existing);
    const installs: string[] = [];
    const t = await createTestApp({
      wafCheckout: false,
      wafWorkspacePorts: {
        ...(options.autoPrepare ? { autoPrepare: true } : {}),
        runGit: git.runGit,
        runProcess: async (_command, _args, options) => {
          installs.push(options.cwd);
          await fs.mkdir(path.join(options.cwd, "node_modules"), { recursive: true });
          return { code: 0, tail: "" };
        },
      },
    });
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const workspace = t.deps.tree.api<WafWorkspace>("ActivitiesModule", "WafWorkspace");
    return { t, git, installs, admin, workspace };
  }

  async function prepared(s: Awaited<ReturnType<typeof setup>>) {
    expect((await s.admin.post("/api/admin/waf-workspace/prepare", {})).status).toBe(200);
    for (;;) {
      const { status } = (await (await s.admin.get("/api/admin/waf-workspace")).json()) as {
        status: WafWorkspaceStatus;
      };
      if (!status.preparing) return status;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it("is an admin's to read and change", async () => {
    const s = await setup();
    const member = apiClient(s.t.app, (await provisionUser(s.t.app, "member")).cookie);
    expect((await member.get("/api/admin/waf-workspace")).status).toBe(403);
    expect((await member.post("/api/admin/waf-workspace/prepare", {})).status).toBe(403);
    const saved = await s.admin.put("/api/admin/waf-workspace/settings", {
      repos: { framework: { branch: "v3" } },
    });
    expect(saved.status).toBe(200);
    const read = (await (await s.admin.get("/api/admin/waf-workspace/settings")).json()) as {
      settings: WafWorkspaceSettings;
    };
    expect(read.settings.repos.framework).toEqual({
      remote: "git@github.com:waterfordresearchinstitute/waf-framework.git",
      branch: "v3",
    });
    const bad = await s.admin.put("/api/admin/waf-workspace/settings", {
      moduleRemote: "git@github.com:org/fixed.git",
    });
    expect(bad.status).toBe(400);
  });

  it("prepares itself in the background when the server starts and it is not ready", async () => {
    const s = await setup(undefined, { autoPrepare: true });
    let status: WafWorkspaceStatus;
    for (;;) {
      status = (
        (await (await s.admin.get("/api/admin/waf-workspace")).json()) as {
          status: WafWorkspaceStatus;
        }
      ).status;
      if (!status.preparing && status.ready) break;
      if (!status.preparing && status.lastError) throw new Error(status.lastError);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(s.git.calls.filter((call) => call.args[0] === "clone")).toHaveLength(4);
    expect(await s.workspace.root()).toBe(status.root);
  });

  it("says it is not prepared, and why the last try failed, when there is no root", async () => {
    const s = await setup();
    await expect(s.workspace.requireRoot()).rejects.toMatchObject({
      status: 409,
      code: "waf_workspace_not_ready",
    });
    const dir = path.join(s.t.root, "waf", "framework", ".git");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "origin"), "git@github.com:someone/else.git");
    await prepared(s);
    await expect(s.workspace.requireRoot()).rejects.toThrow(/someone\/else/);
  });

  it("is not ready, and has no root, until it is prepared", async () => {
    const s = await setup();
    expect(await s.workspace.root()).toBeNull();
    const status = await prepared(s);
    expect(status.ready).toBe(true);
    expect(status.lastError).toBeNull();
    expect(status.root).toBe(path.join(s.t.root, "waf"));
    expect(await s.workspace.root()).toBe(status.root);
  });

  it("clones the four shared repositories, media sparse without LFS, and installs two", async () => {
    const s = await setup();
    await prepared(s);
    const clones = s.git.calls.filter((call) => call.args[0] === "clone");
    expect(clones.map((call) => call.args.slice(-1)[0]!.replace(s.t.root, "~"))).toEqual([
      path.join("~", "waf", "framework"),
      path.join("~", "waf", "modules", "navbar"),
      path.join("~", "waf", "media"),
      path.join("~", "waf", "waf-activity-data"),
    ]);
    expect(clones[0]!.args).toContain("v2");
    const media = clones[2]!;
    expect(media.args).toEqual(expect.arrayContaining(["--filter=blob:none", "--sparse"]));
    expect(media.env).toEqual({ GIT_LFS_SKIP_SMUDGE: "1" });
    expect(s.installs.map((dir) => path.relative(s.t.root, dir))).toEqual([
      path.join("waf", "framework"),
      path.join("waf", "modules", "navbar"),
    ]);
  });

  it("leaves correct clones alone when prepared again", async () => {
    const s = await setup();
    await prepared(s);
    const before = s.git.calls.length;
    await prepared(s);
    expect(s.git.calls.slice(before).some((call) => call.args[0] === "clone")).toBe(false);
  });

  it("refuses to reuse a clone of another remote", async () => {
    const s = await setup();
    const dir = path.join(s.t.root, "waf", "framework", ".git");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "origin"), "git@github.com:someone/else.git");
    const status = await prepared(s);
    expect(status.ready).toBe(false);
    expect(status.lastError).toMatch(/someone\/else/);
  });

  it("adds a product's media folder once, smudging its LFS files without a pull", async () => {
    const s = await setup();
    await prepared(s);
    await s.workspace.ensureMedia(["loom/words"]);
    await s.workspace.ensureMedia(["loom/words"]);
    const adds = s.git.calls.filter((call) =>
      call.args.join(" ").startsWith("sparse-checkout add"),
    );
    expect(adds).toHaveLength(1);
    expect(adds[0]!.env?.GIT_LFS_SKIP_SMUDGE).toBeUndefined();
    expect(s.git.calls.some((call) => call.args[0] === "lfs" && call.args[1] === "pull")).toBe(
      false,
    );
    await expect(s.workspace.ensureMedia(["../escape"])).rejects.toThrow(/media folder/);
  });

  it("clones a product's module when its repository exists, else starts one", async () => {
    const remote = "git@github.com:waterfordresearchinstitute/waf-module-old.git";
    const s = await setup(new Set([remote]));
    await prepared(s);
    const old = await s.workspace.ensureModule("waf-module-old");
    expect(await fs.readFile(path.join(old, ".git", "origin"), "utf8")).toBe(remote);
    const fresh = await s.workspace.ensureModule("waf-module-new");
    expect(await fs.readFile(path.join(fresh, ".git", "origin"), "utf8")).toBe(
      "git@github.com:waterfordresearchinstitute/waf-module-new.git",
    );
    expect(s.git.calls.some((call) => call.args.join(" ") === "init --initial-branch=main")).toBe(
      true,
    );
    await expect(s.workspace.ensureModule("../x")).rejects.toThrow(/module folder/);
  });

  it("uses an existing checkout as it is, and never clones into it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-waf-external-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    await fs.mkdir(path.join(root, "media"), { recursive: true });
    const s = await setup();
    expect(
      (await s.admin.put("/api/admin/waf-workspace/settings", { externalRoot: root })).status,
    ).toBe(200);
    const status = await prepared(s);
    expect(status.managed).toBe(false);
    expect(status.ready).toBe(true);
    expect(await s.workspace.root()).toBe(await fs.realpath(root));
    expect(s.git.calls.some((call) => call.args[0] === "clone")).toBe(false);
  });
});

describe("WAF workspace settings", () => {
  it("rejects a relative checkout, a bad branch, and a password in a remote", () => {
    const base = defaultWafWorkspaceSettings();
    expect(() => normalizeWafWorkspaceSettings(base, { externalRoot: "waf" })).toThrow();
    expect(() =>
      normalizeWafWorkspaceSettings(base, { repos: { media: { branch: "a..b" } } }),
    ).toThrow();
    expect(() =>
      normalizeWafWorkspaceSettings(base, {
        repos: { media: { remote: "https://me:secret@github.com/org/media.git" } },
      }),
    ).toThrow();
    expect(normalizeWafWorkspaceSettings(base, {})).toEqual(base);
  });
});
