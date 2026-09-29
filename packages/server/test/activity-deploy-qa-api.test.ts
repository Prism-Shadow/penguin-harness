/**
 * Deploy to QA through the routes: all ten stages from a fresh state, the edited configuration
 * exported (an archived ref left out), the activity deploy started with exactly its parameter
 * set, the QA address recorded, and a media file found nowhere failing the media stage by name.
 *
 * git, npm, Jenkins and the clock are fakes behind the deploy ports: nothing here reaches a
 * network, a real remote or a real program. The clones are the WAF checkout's: its
 * activity-data and media repositories are there already, and Prepare clones adds the module.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { DeployGitResult } from "../src/activities/deploy-git.js";
import type { JenkinsFetch } from "../src/activities/deploy-jenkins.js";
import type { DeployRunResponse, DeployStateResponse } from "../src/activities/deploy-types.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const PROJECT = "shipper-work";
const QA_TOKEN = "qa-secret-token";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";

/** A git whose clones are `.git` folders on disk; `tracked` is what the media repository holds. */
function fakeGit(tracked: Set<string>) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  let tagReads = 0;
  const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });
  const read = (dir: string, name: string) =>
    fs.readFile(path.join(dir, ".git", name), "utf8").catch(() => null);
  const runGit = async (args: string[], cwd: string): Promise<DeployGitResult> => {
    calls.push({ args, cwd });
    if (args[0] === "--version") return ok("git version 2.45.0");
    // The workspace asks whether a module's repository exists before cloning it.
    if (args[0] === "ls-remote" && args[2] === "--") return ok("abc\trefs/heads/main\n");
    if (args[0] === "clone") {
      const [remote, dir] = args.slice(args.indexOf("--") + 1);
      await fs.mkdir(path.join(dir!, ".git"), { recursive: true });
      await fs.writeFile(path.join(dir!, ".git", "origin"), remote!);
      await fs.writeFile(
        path.join(dir!, "package.json"),
        JSON.stringify({ name: path.basename(dir!), version: "1.0.0" }),
      );
      return ok();
    }
    const origin = await read(cwd, "origin");
    if (origin === null) return { code: 128, stdout: "", stderr: "not a git repository" };
    const joined = args.join(" ");
    if (joined === "remote get-url origin") return ok(`${origin}\n`);
    if (joined === "rev-parse --abbrev-ref HEAD") return ok("main\n");
    if (joined === "status --porcelain") return ok("");
    if (joined === "rev-list --count @{u}..HEAD") return ok("0\n");
    if (joined === "rev-parse HEAD") return ok("c0ffee\n");
    if (args[0] === "rev-parse" && args[1] === "--verify")
      return args[3] === "refs/heads/main" || args[3] === "refs/remotes/origin/main"
        ? ok("abc\n")
        : { code: 1, stdout: "", stderr: "" };
    if (args[0] === "ls-remote")
      return ok(args[3] === "refs/heads/main" ? "abc\trefs/heads/main\n" : "");
    if (args[0] === "ls-tree") {
      const reference = args[args.length - 1]!;
      return ok(tracked.has(reference) ? `${reference}\n` : "");
    }
    if (args[0] === "sparse-checkout") {
      const current = ((await read(cwd, "sparse")) ?? "").split("\n").filter(Boolean);
      if (args[1] === "list") return ok(current.join("\n"));
      const next = args[1] === "set" ? args.slice(2) : [...current, ...args.slice(2)];
      await fs.writeFile(path.join(cwd, ".git", "sparse"), next.join("\n"));
      return ok();
    }
    if (args[0] === "tag") return ok(tagReads++ === 0 ? "1.4.0\n" : "1.4.0\n1.5.0\n");
    if (joined === "diff --cached --quiet") return { code: 1, stdout: "", stderr: "" };
    if (["fetch", "checkout", "reset", "clean", "add", "push", "-c"].includes(args[0]!))
      return ok();
    return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
  };
  return { calls, runGit };
}

/** Jenkins: each job has no build until it is started, then one that succeeded. */
function fakeJenkins() {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  const started = new Map<string, URLSearchParams>();
  const respond = (status: number, body: unknown = "") => ({
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const jobOf = (url: string) => decodeURIComponent(/\/job\/([^/]+)\//.exec(url)?.[1] ?? "");
  const request: JenkinsFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body ? { body: init.body } : {}),
      ...(init.headers.Authorization ? { auth: init.headers.Authorization } : {}),
    });
    if (url.endsWith("/buildWithParameters")) {
      started.set(jobOf(url), new URLSearchParams(init.body ?? ""));
      return respond(201);
    }
    if (url.includes("/queue/api/json")) return respond(200, { items: [] });
    const job = jobOf(url);
    const params = started.get(job);
    return respond(200, {
      builds: params
        ? [
            {
              number: 9,
              url: `job/${encodeURIComponent(job)}/9/`,
              building: false,
              result: "SUCCESS",
              actions: [{ parameters: [...params].map(([name, value]) => ({ name, value })) }],
            },
          ]
        : [],
    });
  };
  return { calls, request };
}

describe("activity deploy to QA", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(tracked: string[]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-qa-waf-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    // The checkout's shared clones; its media's sparse set has this product's folder.
    for (const [folder, remote] of [
      ["waf-activity-data", DATA_REMOTE],
      ["media", MEDIA_REMOTE],
    ] as const) {
      await fs.mkdir(path.join(root, folder, ".git"), { recursive: true });
      await fs.writeFile(path.join(root, folder, ".git", "origin"), remote);
    }
    await fs.writeFile(path.join(root, "media", ".git", "sparse"), "loom/words");
    vi.stubEnv("WAF_ROOT_DIR", root);

    const git = fakeGit(new Set(tracked));
    const jenkins = fakeJenkins();
    const t = await createTestApp({
      deployPorts: {
        runGit: git.runGit,
        jenkinsFetch: jenkins.request,
        runProcess: async () => ({ code: 0, tail: "" }),
        now: () => Date.UTC(2026, 8, 28, 9, 0, 0),
        sleep: async () => {},
      },
      wafWorkspacePorts: { runGit: git.runGit },
    });
    cleanups.push(async () => {
      await t.cleanup();
    });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const owner = await provisionUser(t.app, "shipper");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const create = async (refNum: number) =>
      (await (
        await client.post(base, { productCode: "words", refNum, title: `Words ${refNum}` })
      ).json()) as ActivityDetail;
    const activity = await create(1);
    const applied = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
      expectedRevision: activity.draft.contentRevision,
      spec: { ...activitySpec, title: "Words", moduleFolder: "waf-module-words" },
    });
    expect(applied.status).toBe(200);
    const { contentRevision } = (await applied.json()) as { contentRevision: string };
    // An author's edit of the configuration: what the export must write.
    const edited = await client.put(`${base}/${activity.id}/module-documents/configuration`, {
      value: { words: { "en-US": { greeting: "{{MEDIA}}/loom/words/hello.mp3", edited: true } } },
      expectedRevision: contentRevision,
    });
    expect(edited.status).toBe(200);
    // A second ref, archived: it is not deployed.
    const archived = await create(2);
    expect((await client.delete(`${base}/${archived.id}`)).status).toBe(204);
    expect(
      (
        await admin.put("/api/admin/activity-deploy/settings", {
          qa: {
            jenkinsUrl: "https://jenkins.example.org",
            username: "robot",
            token: QA_TOKEN,
            frameworkVersion: "4.2.1",
            activityBaseUrl: "https://qa.example.org/play",
          },
          git: { userName: "Deploy", userEmail: "deploy@example.org" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.put("/api/admin/waf-workspace/settings", {
          repos: { activityData: { remote: DATA_REMOTE }, media: { remote: MEDIA_REMOTE } },
          moduleRemote: "git@github.com:org/{module}.git",
        })
      ).status,
    ).toBe(200);
    const endpoint = `${base}/${activity.id}`;
    expect((await client.post(`${endpoint}/deploy/clones`)).status).toBe(200);
    const state = async () => {
      const res = await client.get(`${endpoint}/deploy`);
      expect(res.status).toBe(200);
      return (await res.json()) as DeployStateResponse;
    };
    return { t, root, git, jenkins, client, endpoint, state };
  }

  it("deploys to QA from a fresh state: ten stages, the edited data, the deploy job and the QA address", async () => {
    const { root, git, jenkins, client, endpoint, state } = await setup(["loom/words/hello.mp3"]);
    const res = await client.post(`${endpoint}/deploy`, { stage: "qa" });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as DeployRunResponse;
    expect(run.selection).toBe("qa");
    expect(run.stages).toHaveLength(10);
    await vi.waitFor(async () => expect((await state()).run?.status).not.toBe("running"));
    const found = await state();
    expect(found.run?.stages.filter((stage) => stage.error)).toEqual([]);
    expect(found.run?.status).toBe("succeeded");
    expect(found.stages.map((stage) => stage.status)).toEqual(Array(10).fill("done"));
    expect(found.run!.metadata).toMatchObject({
      resolvedModuleVersion: "1.5.0",
      deployedRefNums: [1],
      qaActivityUrl:
        "https://qa.example.org/play?productCode=words&refNum=1&frameworkVersion=4.2.1",
      qaDeployedAt: "2026-09-28T09:00:00.000Z",
      activityDeployUrl: "https://jenkins.example.org/job/WAF%20Activity%20Deploy/9/",
    });
    expect(found.run!.metadata.contentRevision).toBeTruthy();

    const data = path.join(root, "waf-activity-data");
    const configuration = JSON.parse(
      await fs.readFile(path.join(data, "data/configurations/loom/words-1.json"), "utf8"),
    );
    expect(configuration).toEqual({
      words: { "en-US": { greeting: "{{MEDIA}}/loom/words/hello.mp3", edited: true } },
    });
    await expect(
      fs.stat(path.join(data, "data/configurations/loom/words-2.json")),
    ).rejects.toThrow();
    const template = JSON.parse(
      await fs.readFile(path.join(data, "data/templates/loom/words.json"), "utf8"),
    );
    expect(template.sources).toEqual([
      { description: "Ref 1", configurations: ["loom/words-1.json"], refNums: [1] },
    ]);
    expect(template.layout.compartments).toEqual({
      main: { module: "words@^1.5.0", theme: "park" },
      navBar: { module: "navbar@^3.0.0", theme: "park" },
    });
    expect(await fs.readFile(path.join(data, "deployLists/loom-words.txt"), "utf8")).toBe(
      "data/templates/loom/words.json\n",
    );

    const deploy = jenkins.calls.find(
      (call) => call.url.endsWith("/buildWithParameters") && call.url.includes("Activity"),
    )!;
    expect(Object.fromEntries(new URLSearchParams(deploy.body))).toEqual({
      branch: "loom/words-activity-data",
      framework_version: "4.2.1",
      tier: "qa",
      deploy_environment: "loom",
      add_activities_to_catalog: "false",
      template_names: "words",
    });
    const pushes = git.calls
      .filter((call) => call.args[0] === "push")
      .map((call) => call.args.join(" "));
    expect(pushes).toContain("push -u origin loom/words-activity-data");
    // The module was cloned where the checkout keeps modules, and its stages ran there.
    const module = path.join(root, "modules", "waf-module-words");
    expect(git.calls.find((call) => call.args[0] === "clone")?.args.slice(-2)).toEqual([
      "git@github.com:org/waf-module-words.git",
      module,
    ]);
    expect(git.calls.some((call) => call.cwd === module && call.args[0] === "push")).toBe(true);
  });

  it("fails the media stage naming a file found nowhere, and runs nothing after it", async () => {
    const { client, endpoint, state, jenkins } = await setup([]);
    expect((await client.post(`${endpoint}/deploy`, { stage: "qa" })).status).toBe(202);
    await vi.waitFor(async () => expect((await state()).run?.status).toBe("failed"));
    const found = await state();
    const media = found.run!.stages.find((stage) => stage.stage === "verify_media_assets")!;
    expect(media).toMatchObject({
      status: "failed",
      error: { code: "media_missing", paths: ["media/loom/words/hello.mp3"], count: 1 },
    });
    expect(found.stages.find((stage) => stage.stage === "publish_activity_data")).toMatchObject({
      status: "pending",
      blocker: { code: "previous_stage", stage: "verify_media_assets" },
    });
    expect(
      jenkins.calls.some(
        (call) => call.url.endsWith("/buildWithParameters") && call.url.includes("Activity"),
      ),
    ).toBe(false);
  });
});
