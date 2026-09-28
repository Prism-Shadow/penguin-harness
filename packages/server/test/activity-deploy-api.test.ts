/**
 * The deploy routes: the settings are an admin's (403 for anyone else) and never hand a token
 * back; the connection test is one GET with the stored credentials; the activity's deploy
 * context is a member's to read, and Prepare clones is the owner's. The clones go under
 * PENGUIN_HOME and a second press leaves correct clones alone.
 *
 * git and Jenkins are fakes: nothing here reaches a network or a real remote.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { DeployGitResult } from "../src/activities/deploy-git.js";
import type { JenkinsRequest } from "../src/activities/deploy-service.js";
import type {
  DeployConnectionTestResponse,
  DeployContextResponse,
  DeploySettingsResponse,
} from "../src/activities/deploy-types.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "deployer-work";
const MODULE_REMOTE = "git@github.com:org/waf-module-words.git";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";

/**
 * A git that keeps its repositories on disk as a `.git` folder holding the origin and the
 * sparse paths, so the service's own disk checks see what a clone left behind.
 */
function fakeGit(options: { failClone?: string } = {}) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });
  const read = (dir: string, name: string) =>
    fs.readFile(path.join(dir, ".git", name), "utf8").catch(() => null);
  const runGit = async (args: string[], cwd: string): Promise<DeployGitResult> => {
    calls.push({ args, cwd });
    if (args[0] === "--version") return ok("git version 2.45.0");
    if (args[0] === "clone") {
      const [remote, dir] = args.slice(args.indexOf("--") + 1);
      if (remote === options.failClone)
        return { code: 128, stdout: "", stderr: "Cloning...\nfatal: repository not found" };
      await fs.mkdir(path.join(dir!, ".git"), { recursive: true });
      await fs.writeFile(path.join(dir!, ".git", "origin"), remote!);
      return ok();
    }
    const origin = await read(cwd, "origin");
    if (origin === null) return { code: 128, stdout: "", stderr: "not a git repository" };
    const joined = args.join(" ");
    if (joined === "remote get-url origin") return ok(`${origin}\n`);
    if (joined === "rev-parse --abbrev-ref HEAD") return ok("main\n");
    if (joined === "status --porcelain") return ok("");
    if (joined === "rev-list --count @{u}..HEAD") return ok("0\n");
    if (args[0] === "rev-parse" && args[1] === "--verify")
      return args[3] === "refs/heads/main" ? ok("abc\n") : { code: 1, stdout: "", stderr: "" };
    if (args[0] === "ls-remote")
      return ok(args[3] === "refs/heads/main" ? "abc\trefs/heads/main\n" : "");
    if (args[0] === "sparse-checkout") {
      const current = ((await read(cwd, "sparse")) ?? "").split("\n").filter(Boolean);
      if (args[1] === "list") return ok(current.join("\n"));
      const next = args[1] === "set" ? args.slice(2) : [...current, ...args.slice(2)];
      await fs.writeFile(path.join(cwd, ".git", "sparse"), next.join("\n"));
      return ok();
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
  };
  return { calls, runGit };
}

describe("activity deploy routes", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A WAF checkout whose module names its repository, read only. */
  async function checkout(
    repository: unknown = { type: "git", url: `git+https://github.com/org/waf-module-words.git` },
  ) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-deploy-waf-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "media"), { recursive: true });
    await fs.mkdir(path.join(root, "modules", "waf-module-words"), { recursive: true });
    await fs.writeFile(
      path.join(root, "modules", "waf-module-words", "package.json"),
      JSON.stringify({ name: "waf-module-words", repository }),
    );
    vi.stubEnv("WAF_ROOT_DIR", root);
    return root;
  }

  async function setup(gitOptions: { failClone?: string } = {}) {
    const git = fakeGit(gitOptions);
    const jenkins: JenkinsRequest[] = [];
    const t = await createTestApp({
      deployPorts: {
        runGit: git.runGit,
        getJenkins: async (request) => {
          jenkins.push(request);
          return { status: 200 };
        },
      },
    });
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const owner = await provisionUser(t.app, "deployer");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const created = await client.post(base, { productCode: "words", refNum: 1, title: "Words" });
    expect(created.status).toBe(201);
    const activity = (await created.json()) as ActivityDetail;
    const applied = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
      expectedRevision: activity.draft.contentRevision,
      spec: { ...activitySpec, moduleFolder: "waf-module-words" },
    });
    expect(applied.status).toBe(200);
    const endpoint = `${base}/${activity.id}`;
    const context = async (query = "") => {
      const res = await client.get(`${endpoint}/deploy/context${query}`);
      expect(res.status).toBe(200);
      return ((await res.json()) as DeployContextResponse).context;
    };
    return { t, git, jenkins, admin, client, owner, base, activity, endpoint, context };
  }

  async function fillSettings(admin: ReturnType<typeof apiClient>) {
    const res = await admin.put("/api/admin/activity-deploy/settings", {
      qa: {
        jenkinsUrl: "https://jenkins.example.org",
        username: "robot",
        token: "qa-secret-token",
        frameworkVersion: "4.2.1",
        activityBaseUrl: "https://qa.example.org",
      },
      prod: { jenkinsUrl: "https://jenkins-prod.example.org", username: "robot" },
      repos: { activityDataRemote: DATA_REMOTE, mediaRemote: MEDIA_REMOTE },
      git: { userName: "Deploy", userEmail: "deploy@example.org" },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as DeploySettingsResponse).settings;
  }

  it("keeps the settings to admins", async () => {
    const { client } = await setup();
    for (const res of [
      await client.get("/api/admin/activity-deploy/settings"),
      await client.put("/api/admin/activity-deploy/settings", { qa: { username: "x" } }),
      await client.post("/api/admin/activity-deploy/settings/test/qa"),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "admin_required" } });
    }
  });

  it("masks tokens, keeps one left empty, and clears one set to null", async () => {
    const { admin, t } = await setup();
    const saved = await fillSettings(admin);
    expect(saved.qa.token).toEqual({ set: true });
    expect(saved.prod.token).toEqual({ set: false });
    const read = await admin.get("/api/admin/activity-deploy/settings");
    const text = await read.text();
    expect(text).not.toContain("qa-secret-token");
    // Saving another field with the token field empty keeps it.
    const kept = await admin.put("/api/admin/activity-deploy/settings", {
      qa: { token: "", tier: "qa2" },
    });
    expect(((await kept.json()) as DeploySettingsResponse).settings.qa).toMatchObject({
      tier: "qa2",
      token: { set: true },
    });
    const cleared = await admin.put("/api/admin/activity-deploy/settings", { qa: { token: null } });
    expect(((await cleared.json()) as DeploySettingsResponse).settings.qa.token).toEqual({
      set: false,
    });
    // A refused field is named and nothing is written.
    const refused = await admin.put("/api/admin/activity-deploy/settings", {
      qa: { tier: "qa3", jenkinsUrl: "http://jenkins.example.org" },
    });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: {
        code: "invalid_deploy_setting",
        detail: { field: "qa.jenkinsUrl", reason: "https_required" },
      },
    });
    const after = (await (
      await admin.get("/api/admin/activity-deploy/settings")
    ).json()) as DeploySettingsResponse;
    expect(after.settings.qa.tier).toBe("qa2");
    expect(await fs.readdir(t.root)).toContain("secrets");
  });

  it("tests a connection with the stored credentials and reports only the status", async () => {
    const { admin, jenkins } = await setup();
    const missing = await admin.post("/api/admin/activity-deploy/settings/test/qa");
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: { code: "deploy_settings_missing", detail: { field: "qa.jenkinsUrl" } },
    });
    await fillSettings(admin);
    const res = await admin.post("/api/admin/activity-deploy/settings/test/qa");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text) as DeployConnectionTestResponse).toEqual({
      test: { ok: true, status: 200 },
    });
    expect(text).not.toContain("qa-secret-token");
    expect(jenkins).toHaveLength(1);
    expect(jenkins[0]!.url).toBe("https://jenkins.example.org/api/json");
    expect(jenkins[0]!.headers.Authorization).toBe(
      `Basic ${Buffer.from("robot:qa-secret-token").toString("base64")}`,
    );
    // PROD has a URL but no token: the GET goes without credentials.
    await admin.post("/api/admin/activity-deploy/settings/test/prod");
    expect(jenkins[1]!.headers.Authorization).toBeUndefined();
    expect((await admin.post("/api/admin/activity-deploy/settings/test/dev")).status).toBe(404);
  });

  it("lists what a deploy still needs, in codes", async () => {
    const { context } = await setup();
    const found = await context();
    expect(found.ready).toBe(false);
    expect(found.problems).toEqual(
      expect.arrayContaining([
        { code: "settings_missing", field: "qa.jenkinsUrl" },
        { code: "settings_missing", field: "qa.token" },
        { code: "module_remote_missing" },
        { code: "clone_missing", repo: "module" },
        { code: "clone_missing", repo: "activityData" },
        { code: "clone_missing", repo: "media" },
      ]),
    );
  });

  it("refuses a ref that is not the canonical one", async () => {
    const { client, base, admin } = await setup();
    await checkout();
    await fillSettings(admin);
    const second = (await (
      await client.post(base, { productCode: "words", refNum: 2, title: "Words 2" })
    ).json()) as ActivityDetail;
    const res = await client.get(`${base}/${second.id}/deploy/context`);
    const context = ((await res.json()) as DeployContextResponse).context;
    expect(context.problems).toContainEqual({ code: "not_canonical" });
    const prepare = await client.post(`${base}/${second.id}/deploy/clones`);
    expect(prepare.status).toBe(409);
    expect(await prepare.json()).toMatchObject({ error: { code: "deploy_not_canonical" } });
  });

  it("prepares the three clones under PENGUIN_HOME, and a second press changes nothing", async () => {
    const { t, git, admin, client, endpoint, context } = await setup();
    const waf = await checkout();
    await fillSettings(admin);
    const prepared = await client.post(`${endpoint}/deploy/clones`);
    expect(prepared.status).toBe(200);
    const after = ((await prepared.json()) as DeployContextResponse).context;
    expect(after.problems).toEqual([]);
    expect(after.ready).toBe(true);
    const repos = path.join(t.root, "activity-deploy", "repos");
    const clones = git.calls.filter((call) => call.args[0] === "clone");
    expect(clones.map((call) => call.args)).toEqual([
      ["clone", "--", MODULE_REMOTE, path.join(repos, "modules", "waf-module-words")],
      ["clone", "--", DATA_REMOTE, path.join(repos, "activity-data")],
      ["clone", "--filter=blob:none", "--sparse", "--", MEDIA_REMOTE, path.join(repos, "media")],
    ]);
    expect(
      git.calls.find((call) => call.args[0] === "sparse-checkout" && call.args[1] === "set")?.args,
    ).toEqual(["sparse-checkout", "set", "media/loom/words"]);
    // Nothing was written into the checkout.
    expect(await fs.readdir(path.join(waf, "modules", "waf-module-words"))).toEqual([
      "package.json",
    ]);
    for (const call of git.calls) expect(call.cwd.startsWith(waf)).toBe(false);

    const before = git.calls.length;
    const again = await client.post(`${endpoint}/deploy/clones`);
    expect(again.status).toBe(200);
    const second = git.calls.slice(before);
    expect(second.some((call) => call.args[0] === "clone")).toBe(false);
    expect(
      second.some((call) => call.args[0] === "sparse-checkout" && call.args[1] !== "list"),
    ).toBe(false);
    expect((await context()).ready).toBe(true);
    expect(git.calls.some((call) => call.args[0] === "ls-remote")).toBe(false);
    // Check remote asks the remote, and only the owner may.
    const checked = await context("?checkRemote=1");
    expect(checked.remoteChecked).toBe(true);
    expect(git.calls.some((call) => call.args[0] === "ls-remote")).toBe(true);
  });

  it("names a shared media clone that lacks this product's folder, and Prepare clones adds it", async () => {
    const { t, git, admin, client, endpoint, context } = await setup();
    await checkout();
    await fillSettings(admin);
    expect((await client.post(`${endpoint}/deploy/clones`)).status).toBe(200);
    // Another product prepared the media clone for its own folder only.
    const media = path.join(t.root, "activity-deploy", "repos", "media");
    await fs.writeFile(path.join(media, ".git", "sparse"), "media/loom/other");
    const found = await context();
    expect(found.ready).toBe(false);
    expect(found.problems).toEqual([{ code: "media_path_missing", path: "media/loom/words" }]);
    const before = git.calls.length;
    const fixed = await client.post(`${endpoint}/deploy/clones`);
    expect(fixed.status).toBe(200);
    expect(((await fixed.json()) as DeployContextResponse).context.ready).toBe(true);
    expect(
      git.calls
        .slice(before)
        .find((call) => call.args[0] === "sparse-checkout" && call.args[1] === "add")?.args,
    ).toEqual(["sparse-checkout", "add", "media/loom/words"]);
  });

  it("refuses to clone a module from a remote no clone may be made from", async () => {
    const { git, admin, client, endpoint, context } = await setup();
    await checkout({ type: "git", url: "file:///srv/modules/words.git" });
    await fillSettings(admin);
    expect((await context()).problems).toContainEqual({ code: "module_remote_invalid" });
    const res = await client.post(`${endpoint}/deploy/clones`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "deploy_module_remote_invalid" } });
    expect(git.calls.some((call) => call.args[0] === "clone")).toBe(false);
  });

  it("reports a failed clone as its repository, its reason and git's own output", async () => {
    const { admin, client, endpoint } = await setup({ failClone: DATA_REMOTE });
    await checkout();
    await fillSettings(admin);
    const res = await client.post(`${endpoint}/deploy/clones`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: {
        code: "deploy_clone_failed",
        detail: {
          repo: "activityData",
          reason: "git_failed",
          output: "Cloning... fatal: repository not found",
        },
      },
    });
  });

  it("leaves a path that exists and is not the expected clone alone", async () => {
    const { t, admin, client, endpoint, git } = await setup();
    await checkout();
    await fillSettings(admin);
    const taken = path.join(t.root, "activity-deploy", "repos", "activity-data");
    await fs.mkdir(taken, { recursive: true });
    await fs.writeFile(path.join(taken, "notes.txt"), "mine");
    const res = await client.post(`${endpoint}/deploy/clones`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "deploy_clone_path_taken", detail: { repo: "activityData" } },
    });
    expect(await fs.readFile(path.join(taken, "notes.txt"), "utf8")).toBe("mine");
    expect(
      git.calls.some((call) => call.args[0] === "clone" && call.args.includes(DATA_REMOTE)),
    ).toBe(false);
  });

  it("lets a project member read the context but not ask the remote or prepare clones", async () => {
    const { t, client, endpoint } = await setup();
    const member = await provisionUser(t.app, "deploy_reader");
    expect(
      (await client.post(`/api/projects/${PROJECT}/members`, { userId: "deploy_reader" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    expect((await reader.get(`${endpoint}/deploy/context`)).status).toBe(200);
    expect((await reader.get(`${endpoint}/deploy/context?checkRemote=1`)).status).toBe(403);
    expect((await reader.post(`${endpoint}/deploy/clones`)).status).toBe(403);
  });
});
