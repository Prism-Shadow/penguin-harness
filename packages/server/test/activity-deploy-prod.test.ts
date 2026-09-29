/**
 * Deploy to PROD through the routes: refused before QA has the activity as it is now, with a
 * wrong confirmation, and for an owner who is not an admin; once QA is current, the PROD
 * Jenkins gets the activity deploy job with PROD's parameters and PROD's token, the deploy is
 * recorded, and the deployed hook fires once for QA and once for PROD.
 *
 * git, npm, Jenkins and the clock are fakes behind the deploy ports: nothing here reaches a
 * network, a real remote or a real program.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import type { ActivityDeployEvents } from "../src/activities/deploy-events.js";
import type { DeployGitResult } from "../src/activities/deploy-git.js";
import type { JenkinsFetch } from "../src/activities/deploy-jenkins.js";
import type {
  DeployRunResponse,
  DeployStateResponse,
  DeployedEvent,
} from "../src/activities/deploy-types.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";

const QA_JENKINS = "https://jenkins.example.org";
const PROD_JENKINS = "https://jenkins-prod.example.org";
const DATA_REMOTE = "git@github.com:org/data.git";
const MEDIA_REMOTE = "git@github.com:org/media.git";

/**
 * A git whose clones are `.git` folders on disk; the media repository holds every file, and
 * each module build started makes one newer release tag.
 */
function fakeGit(moduleBuilds: () => number) {
  const ok = (stdout = ""): DeployGitResult => ({ code: 0, stdout, stderr: "" });
  const read = (dir: string, name: string) =>
    fs.readFile(path.join(dir, ".git", name), "utf8").catch(() => null);
  return async (args: string[], cwd: string): Promise<DeployGitResult> => {
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
    if (args[0] === "ls-tree") return ok(`${args[args.length - 1]}\n`);
    if (args[0] === "sparse-checkout") {
      const current = ((await read(cwd, "sparse")) ?? "").split("\n").filter(Boolean);
      if (args[1] === "list") return ok(current.join("\n"));
      const next = args[1] === "set" ? args.slice(2) : [...current, ...args.slice(2)];
      await fs.writeFile(path.join(cwd, ".git", "sparse"), next.join("\n"));
      return ok();
    }
    if (args[0] === "tag")
      return ok(
        Array.from({ length: moduleBuilds() + 1 }, (_, index) => `1.${4 + index}.0\n`).join(""),
      );
    if (joined === "diff --cached --quiet") return { code: 1, stdout: "", stderr: "" };
    if (["fetch", "checkout", "reset", "clean", "add", "push", "-c"].includes(args[0]!))
      return ok();
    return { code: 1, stdout: "", stderr: `unexpected: ${joined}` };
  };
}

/**
 * Two Jenkins servers: each job has no build until it is started, then its newest start as a
 * build that succeeded, numbered on from 9.
 */
function fakeJenkins() {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  const started = new Map<string, { params: URLSearchParams; count: number }>();
  const respond = (status: number, body: unknown = "") => ({
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
  const keyOf = (url: string) =>
    `${new URL(url).origin} ${decodeURIComponent(/\/job\/([^/]+)\//.exec(url)?.[1] ?? "")}`;
  const request: JenkinsFetch = async (url, init) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body ? { body: init.body } : {}),
      ...(init.headers.Authorization ? { auth: init.headers.Authorization } : {}),
    });
    if (url.endsWith("/buildWithParameters")) {
      const key = keyOf(url);
      started.set(key, {
        params: new URLSearchParams(init.body ?? ""),
        count: (started.get(key)?.count ?? 0) + 1,
      });
      return respond(201);
    }
    if (url.includes("/queue/api/json")) return respond(200, { items: [] });
    const build = started.get(keyOf(url));
    const job = keyOf(url).split(" ").slice(1).join(" ");
    const number = 8 + (build?.count ?? 0);
    return respond(200, {
      builds: build
        ? [
            {
              number,
              url: `job/${encodeURIComponent(job)}/${number}/`,
              building: false,
              result: "SUCCESS",
              actions: [
                { parameters: [...build.params].map(([name, value]) => ({ name, value })) },
              ],
            },
          ]
        : [],
    });
  };
  const moduleBuilds = () =>
    calls.filter(
      (call) => call.url.endsWith("/buildWithParameters") && call.url.includes("Modules"),
    ).length;
  return { calls, request, moduleBuilds };
}

const basic = (user: string, token: string) =>
  `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;

describe("activity deploy to PROD", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A product ready to deploy, its project owned by the admin or by an owner who is not one. */
  async function setup(owner: "admin" | "member") {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-prod-waf-"));
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"), { recursive: true });
    // The checkout's clones, the product's module among them (its owner cloned it, and
    // Penguin writes the product's files into it); its media's sparse set has this
    // product's folder.
    for (const [folder, remote] of [
      ["waf-activity-data", DATA_REMOTE],
      ["media", MEDIA_REMOTE],
      ["modules/waf-module-words", "git@github.com:org/waf-module-words.git"],
    ] as const) {
      await fs.mkdir(path.join(root, folder, ".git"), { recursive: true });
      await fs.writeFile(path.join(root, folder, ".git", "origin"), remote);
    }
    await fs.writeFile(
      path.join(root, "modules", "waf-module-words", "package.json"),
      JSON.stringify({ name: "waf-module-words", version: "1.0.0" }),
    );
    await fs.writeFile(path.join(root, "media", ".git", "sparse"), "loom/words");
    vi.stubEnv("WAF_ROOT_DIR", root);

    const jenkins = fakeJenkins();
    const clock = { at: Date.UTC(2026, 8, 28, 9, 0, 0) };
    const runGit = fakeGit(() => jenkins.moduleBuilds());
    const t = await createTestApp({
      deployPorts: {
        runGit,
        jenkinsFetch: jenkins.request,
        runProcess: async () => ({ code: 0, tail: "" }),
        now: () => clock.at,
        sleep: async () => {},
      },
      wafWorkspacePorts: { runGit },
    });
    cleanups.push(async () => {
      await t.cleanup();
    });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const client =
      owner === "admin" ? admin : apiClient(t.app, (await provisionUser(t.app, "shipper")).cookie);
    const projectId = owner === "admin" ? "launch" : "shipper-work";
    expect((await client.post("/api/projects", { projectId })).status).toBe(201);
    const base = `/api/projects/${projectId}/activities`;
    const activity = (await (
      await client.post(base, { productCode: "words", refNum: 1, title: "Words 1" })
    ).json()) as ActivityDetail;
    const applied = await client.post(`${base}/${activity.id}/apply-generated-spec`, {
      expectedRevision: activity.draft.contentRevision,
      spec: { ...activitySpec, title: "Words", moduleFolder: "waf-module-words" },
    });
    expect(applied.status).toBe(200);
    const { contentRevision } = (await applied.json()) as { contentRevision: string };
    const edited = await client.put(`${base}/${activity.id}/module-documents/configuration`, {
      value: { words: { "en-US": { greeting: "{{MEDIA}}/loom/words/hello.mp3" } } },
      expectedRevision: contentRevision,
    });
    expect(edited.status).toBe(200);
    expect(
      (
        await admin.put("/api/admin/activity-deploy/settings", {
          qa: {
            jenkinsUrl: QA_JENKINS,
            username: "robot",
            token: "qa-secret-token",
            frameworkVersion: "4.2.1",
            activityBaseUrl: "https://qa.example.org/play",
          },
          prod: {
            jenkinsUrl: PROD_JENKINS,
            username: "prod-robot",
            token: "prod-secret-token",
            frameworkVersion: "4.1.0",
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
    const settle = () =>
      vi.waitFor(async () => expect((await state()).run?.status).not.toBe("running"));
    const events: DeployedEvent[] = [];
    const hub = t.deps.tree.api<ActivityDeployEvents>("ActivitiesModule", "ActivityDeployEvents");
    const listener = (event: DeployedEvent) => events.push(event);
    hub.subscribe(listener);
    cleanups.unshift(async () => hub.unsubscribe(listener));
    const deployQa = async () => {
      expect((await client.post(`${endpoint}/deploy`, { stage: "qa" })).status).toBe(202);
      await settle();
      expect((await state()).run?.status).toBe("succeeded");
    };
    return {
      t,
      client,
      endpoint,
      base,
      activity,
      state,
      settle,
      jenkins,
      events,
      deployQa,
      clock,
    };
  }

  it("refuses PROD before QA is current, with a wrong confirmation, and for a mismatched target", async () => {
    const { client, endpoint, state, deployQa, base, activity } = await setup("admin");
    const before = await state();
    expect(before.production.blocker).toEqual({
      code: "previous_stage",
      stage: "await_activity_deploy",
    });
    expect(before.production.last).toBeNull();
    expect(before.stages).toHaveLength(10);
    expect(before.production.stages.map((stage) => stage.stage)).toEqual([
      "trigger_production_deploy",
      "await_production_deploy",
    ]);

    const early = await client.post(`${endpoint}/deploy`, { stage: "prod", confirm: "words" });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({
      error: {
        code: "deploy_blocked",
        detail: {
          stage: "trigger_production_deploy",
          blocker: "previous_stage",
          previous: "await_activity_deploy",
        },
      },
    });

    const mismatch = await client.post(`${endpoint}/deploy`, { stage: "qa", target: "prod" });
    expect(mismatch.status).toBe(400);

    await deployQa();
    expect((await state()).production.blocker).toBeNull();

    const wrong = await client.post(`${endpoint}/deploy`, { stage: "prod", confirm: "Words" });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: { code: "confirmation_mismatch" } });
    const none = await client.post(`${endpoint}/deploy`, { stage: "prod" });
    expect(none.status).toBe(400);

    // The draft changes after QA got it: QA no longer has the activity as it is now.
    const current = (await (await client.get(`${base}/${activity.id}`)).json()) as ActivityDetail;
    expect(
      (
        await client.put(`${endpoint}/module-documents/configuration`, {
          value: { words: { "en-US": { greeting: "{{MEDIA}}/loom/words/hello.mp3", v: 2 } } },
          expectedRevision: current.draft.contentRevision,
        })
      ).status,
    ).toBe(200);
    expect((await state()).production.blocker).toEqual({ code: "qa_outdated" });
    const outdated = await client.post(`${endpoint}/deploy`, { stage: "prod", confirm: "words" });
    expect(outdated.status).toBe(409);
    expect(await outdated.json()).toMatchObject({
      error: {
        code: "deploy_blocked",
        detail: { stage: "trigger_production_deploy", blocker: "qa_outdated" },
      },
    });
  });

  // QA exports every ref of the product, so a sibling's change leaves QA behind as well.
  it("counts a sibling ref's change after QA as the product changing", async () => {
    const { client, state, deployQa, base } = await setup("admin");
    const sibling = (await (
      await client.post(base, { productCode: "words", refNum: 2, title: "Words 2" })
    ).json()) as ActivityDetail;
    const applied = await client.post(`${base}/${sibling.id}/apply-generated-spec`, {
      expectedRevision: sibling.draft.contentRevision,
      spec: { ...activitySpec, title: "Words", moduleFolder: "waf-module-words" },
    });
    expect(applied.status).toBe(200);
    const configure = async (value: unknown, expectedRevision: string) => {
      const res = await client.put(`${base}/${sibling.id}/module-documents/configuration`, {
        value,
        expectedRevision,
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { contentRevision: string }).contentRevision;
    };
    const greeting = { greeting: "{{MEDIA}}/loom/words/hello.mp3" };
    const configured = await configure(
      { words: { "en-US": greeting } },
      ((await applied.json()) as { contentRevision: string }).contentRevision,
    );
    await deployQa();
    expect((await state()).production.blocker).toBeNull();

    await configure({ words: { "en-US": { ...greeting, v: 2 } } }, configured);
    expect((await state()).production.blocker).toEqual({ code: "qa_outdated" });
  });

  it("counts a ref added after QA as the product changing", async () => {
    const { client, state, deployQa, base } = await setup("admin");
    await deployQa();
    expect((await state()).production.blocker).toBeNull();
    expect(
      (await client.post(base, { productCode: "words", refNum: 2, title: "Words 2" })).status,
    ).toBe(201);
    expect((await state()).production.blocker).toEqual({ code: "qa_outdated" });
  });

  it("refuses an owner who is not an admin", async () => {
    const { client, endpoint, deployQa } = await setup("member");
    await deployQa();
    const res = await client.post(`${endpoint}/deploy`, { stage: "prod", confirm: "words" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "prod_requires_admin" } });
    const stage = await client.post(`${endpoint}/deploy`, {
      stage: "await_production_deploy",
      confirm: "words",
    });
    expect(stage.status).toBe(403);
  });

  it("deploys to PROD with PROD's job parameters, records it, and fires the hook once per target", async () => {
    const { client, endpoint, state, settle, jenkins, events, deployQa, clock } =
      await setup("admin");
    await deployQa();
    expect(events.map((event) => event.target)).toEqual(["qa"]);
    const qaRevision = (await state()).stages.find(
      (stage) => stage.stage === "await_activity_deploy",
    )!.metadata.contentRevision;
    expect(qaRevision).toBeTruthy();
    expect(events[0]).toMatchObject({
      revision: qaRevision,
      deployedAt: "2026-09-28T09:00:00.000Z",
    });

    // The confirmation is the product code exactly: spaces around it do not match.
    const spaced = await client.post(`${endpoint}/deploy`, { stage: "prod", confirm: " words " });
    expect(spaced.status).toBe(400);
    expect(await spaced.json()).toMatchObject({ error: { code: "confirmation_mismatch" } });
    const res = await client.post(`${endpoint}/deploy`, { stage: "prod", confirm: "words" });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as DeployRunResponse;
    expect(run).toMatchObject({ target: "prod", selection: "prod" });
    expect(run.stages.map((stage) => stage.stage)).toEqual([
      "trigger_production_deploy",
      "await_production_deploy",
    ]);
    await settle();
    const found = await state();
    expect(found.run?.stages.filter((stage) => stage.error)).toEqual([]);
    expect(found.run?.status).toBe("succeeded");
    expect(found.production.stages.map((stage) => stage.status)).toEqual(["done", "done"]);
    // QA's stages stay done: PROD comes after them.
    expect(found.stages.every((stage) => stage.status === "done")).toBe(true);
    expect(found.production.last).toEqual({
      runId: run.runId,
      deployedAt: "2026-09-28T09:00:00.000Z",
      contentRevision: qaRevision,
      frameworkVersion: "4.1.0",
      url: `${PROD_JENKINS}/job/WAF%20Activity%20Deploy/9/`,
    });

    const prodTriggers = jenkins.calls.filter(
      (call) => call.url.startsWith(PROD_JENKINS) && call.url.endsWith("/buildWithParameters"),
    );
    expect(prodTriggers).toHaveLength(1);
    expect(prodTriggers[0]!.url).toBe(
      `${PROD_JENKINS}/job/WAF%20Activity%20Deploy/buildWithParameters`,
    );
    expect(prodTriggers[0]!.auth).toBe(basic("prod-robot", "prod-secret-token"));
    expect(Object.fromEntries(new URLSearchParams(prodTriggers[0]!.body))).toEqual({
      branch: "loom/words-activity-data",
      framework_version: "4.1.0",
      tier: "prod",
      deploy_environment: "DEFAULT",
      add_activities_to_catalog: "false",
      template_names: "words",
    });
    // Every PROD request carried PROD's credentials; QA's token never went to PROD.
    for (const call of jenkins.calls.filter((entry) => entry.url.startsWith(PROD_JENKINS)))
      expect(call.auth).toBe(basic("prod-robot", "prod-secret-token"));

    expect(events.map((event) => event.target)).toEqual(["qa", "prod"]);
    expect(events[1]).toMatchObject({
      target: "prod",
      runId: run.runId,
      revision: qaRevision,
      deployedAt: "2026-09-28T09:00:00.000Z",
    });

    // Waiting again on its own finds the same finished build: nothing new is recorded or told.
    clock.at = Date.UTC(2026, 8, 28, 10, 0, 0);
    const again = await client.post(`${endpoint}/deploy`, {
      stage: "await_production_deploy",
      confirm: "words",
    });
    expect(again.status).toBe(202);
    await settle();
    const followed = await state();
    expect(followed.run?.status).toBe("succeeded");
    expect(followed.production.last?.deployedAt).toBe("2026-09-28T09:00:00.000Z");
    expect(events.map((event) => event.target)).toEqual(["qa", "prod"]);

    // A later QA deploy sets PROD's stages back, and the PROD record stays.
    await deployQa();
    const after = await state();
    expect(after.production.stages.map((stage) => stage.status)).toEqual(["pending", "pending"]);
    expect(after.production.last?.deployedAt).toBe("2026-09-28T09:00:00.000Z");
    expect(events.map((event) => event.target)).toEqual(["qa", "prod", "qa"]);
  });
});
