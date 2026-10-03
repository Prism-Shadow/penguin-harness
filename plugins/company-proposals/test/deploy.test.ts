/**
 * Deploys over a fake organization scope, a fake `gh` and a fake process: who may register a
 * script, what a deploy hands the script (the PR head in its environment, the extra arguments
 * after the registered command, the shared workspace as its directory), how a run ends, what
 * output is kept, and the refusals — a moved head, a busy script, a mirror, a proposal
 * without an impl PR. One test starts a real process to hold the spawner to the same contract.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OrgActor, OrgView } from "@prismshadow/penguin-server/plugin";
import type {
  ProposalDeployRun,
  ProposalDeployRunResponse,
  ProposalDeployStartResponse,
} from "@prismshadow/penguin-server/api";
import {
  DEPLOY_SCRIPTS_FILE,
  DeployService,
  OUTPUT_LIMIT,
  ProposalError,
  startProcess,
} from "../src/index.js";
import type { DeployProcess, DeployScope, StartProcess } from "../src/index.js";
import { deployRoutes } from "../src/deploy-routes.js";
import type { RunGh } from "../src/pr-status.js";

const PROJECT = "proj";
const ORG = "acme";
const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const BOSS: OrgActor = { userId: "boss" };
const DEV: OrgActor = { userId: "boss", agentId: "acme_dev" };

class FakeProcess implements DeployProcess {
  private readonly outputs: Array<(text: string) => void> = [];
  private readonly exits: Array<(code: number | null, error: string | null) => void> = [];
  readonly signals: string[] = [];
  constructor(
    readonly argv: readonly string[],
    readonly cwd: string,
    readonly env: NodeJS.ProcessEnv,
  ) {}
  onOutput(l: (text: string) => void): void {
    this.outputs.push(l);
  }
  onExit(l: (code: number | null, error: string | null) => void): void {
    this.exits.push(l);
  }
  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    if (signal === "SIGTERM") this.exit(null, "killed by SIGTERM");
  }
  write(text: string): void {
    for (const l of this.outputs) l(text);
  }
  exit(code: number | null, error: string | null = null): void {
    for (const l of this.exits) l(code, error);
  }
}

let root: string;
let started: FakeProcess[];
let ghCalls: string[][];
let heads: Record<string, string>;
let org: OrgView;
let implPrs: Record<number, string | null>;
/** Proposals whose impl is a declared head branch (resolved), with the PR on it if any. */
let implBranches: Record<number, { head: { repo: string; branch: string }; pr: string | null }>;
let tips: Record<string, string>;
let deliveryRepo: string | null;
let logs: string[];

const start: StartProcess = (argv, opts) => {
  const p = new FakeProcess(argv, opts.cwd, opts.env);
  started.push(p);
  return p;
};

const gh: RunGh = async (args) => {
  ghCalls.push([...args]);
  const tip = /^repos\/([^/]+\/[^/]+)\/branches\/(.+)$/.exec(args[1] ?? "");
  if (tip !== null) {
    const sha = tips[`${tip[1]}:${tip[2]}`];
    if (sha === undefined) throw new Error("HTTP 404: Branch not found");
    return JSON.stringify(sha);
  }
  const m = /^repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(args[1] ?? "");
  const head = m === null ? undefined : heads[`${m[1]}#${m[2]}`];
  if (head === undefined) throw new Error("HTTP 404: Not Found");
  return JSON.stringify({
    head: { sha: head, ref: "feat/thing" },
    html_url: `https://github.com/${m![1]}/pull/${m![2]}`,
  });
};

function scope(_projectId: string, _orgId: string, actor: OrgActor): Promise<DeployScope> {
  return Promise.resolve({
    org,
    principal: actor.agentId !== undefined ? `agent:${actor.agentId}` : `user:${actor.userId}`,
    person: actor.agentId === undefined,
    impl: (n: number) => {
      if (n in implBranches) return Promise.resolve(implBranches[n]!);
      if (!(n in implPrs)) throw new ProposalError(404, "proposal_not_found", `#${n}`);
      const pr = implPrs[n]!;
      return Promise.resolve(pr === null ? null : { head: null, pr });
    },
    deliveryRepo: () => Promise.resolve(deliveryRepo),
  });
}

function service(extra: { timeoutMs?: number; start?: StartProcess } = {}): DeployService {
  return new DeployService({
    scope,
    root,
    log: (line) => logs.push(line),
    gh,
    start: extra.start ?? start,
    ...(extra.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
  });
}

async function refusal(p: Promise<unknown>): Promise<{ status: number; code: string }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProposalError) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

const runOf = (res: ProposalDeployStartResponse): ProposalDeployRun => {
  if (!("run" in res)) throw new Error("expected a run");
  return res.run;
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "deploy-test-"));
  started = [];
  ghCalls = [];
  heads = { "acme/site#11": HEAD, "acme/site#12": OTHER };
  org = {
    projectId: PROJECT,
    orgId: ORG,
    name: "Acme",
    status: "active",
    language: "en",
    workspace: path.join(root, "workspace"),
    employees: [],
    userIds: ["boss"],
    machineId: null,
  };
  implPrs = { 1: "https://github.com/acme/site/pull/11", 2: null };
  implBranches = {};
  tips = {};
  deliveryRepo = "acme/site";
  logs = [];
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("deploy scripts", () => {
  it("only a person who is a server admin registers or removes one", async () => {
    const d = service();
    const input = { id: "staging", command: ["bash", "scripts/deploy.sh"], description: "staging" };
    expect(await refusal(d.register(PROJECT, ORG, DEV, true, input))).toEqual({
      status: 403,
      code: "admin_required",
    });
    expect(await refusal(d.register(PROJECT, ORG, BOSS, false, input))).toEqual({
      status: 403,
      code: "admin_required",
    });
    const script = await d.register(PROJECT, ORG, BOSS, true, input);
    expect(script).toMatchObject({
      id: "staging",
      command: ["bash", "scripts/deploy.sh"],
      by: "user:boss",
    });
    expect(await d.scripts(PROJECT, ORG, DEV)).toEqual([script]);
    const file = path.join(root, PROJECT, "organizations", ORG, DEPLOY_SCRIPTS_FILE);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ scripts: [script] });

    expect(await refusal(d.register(PROJECT, ORG, BOSS, true, input))).toMatchObject({
      status: 409,
      code: "deploy_script_exists",
    });
    expect(await refusal(d.remove(PROJECT, ORG, DEV, true, "staging"))).toMatchObject({
      status: 403,
    });
    await d.remove(PROJECT, ORG, BOSS, true, "staging");
    expect(await d.scripts(PROJECT, ORG, BOSS)).toEqual([]);
    expect(await refusal(d.remove(PROJECT, ORG, BOSS, true, "staging"))).toMatchObject({
      status: 404,
      code: "deploy_script_not_found",
    });
  });

  it("refuses an id or a command it cannot run", async () => {
    const d = service();
    for (const [id, command] of [
      ["Staging", ["x"]],
      ["../x", ["x"]],
      ["ok", []],
      ["ok", "bash deploy.sh"],
      ["ok", [""]],
      ["ok", ["x", 3]],
    ] as Array<[string, unknown]>) {
      expect(await refusal(d.register(PROJECT, ORG, BOSS, true, { id, command }))).toMatchObject({
        status: 400,
      });
    }
  });

  it("two registrations at once both land", async () => {
    const d = service();
    await Promise.all([
      d.register(PROJECT, ORG, BOSS, true, { id: "a", command: ["a"] }),
      d.register(PROJECT, ORG, BOSS, true, { id: "b", command: ["b"] }),
    ]);
    expect((await d.scripts(PROJECT, ORG, BOSS)).map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
});

describe("a deploy", () => {
  async function registered(): Promise<DeployService> {
    const d = service();
    await d.register(PROJECT, ORG, BOSS, true, {
      id: "staging",
      command: ["bash", "scripts/deploy.sh", "--fast"],
    });
    return d;
  }

  it("runs the script in the shared workspace with the impl PR head and the extra arguments", async () => {
    const d = await registered();
    const run = runOf(
      await d.start(PROJECT, ORG, DEV, {
        script: "staging",
        proposal: 1,
        args: ["--extra-args", "x y"],
      }),
    );
    expect(ghCalls).toEqual([["api", "repos/acme/site/pulls/11"]]);
    expect(run).toMatchObject({
      script: "staging",
      repo: "acme/site",
      pr: 11,
      head: HEAD,
      branch: "feat/thing",
      proposal: 1,
      status: "running",
      by: "agent:acme_dev",
      argv: ["bash", "scripts/deploy.sh", "--fast", "--extra-args", "x y"],
    });
    const [p] = started;
    expect(p!.argv).toEqual(run.argv);
    expect(p!.cwd).toBe(org.workspace);
    expect(p!.env).toMatchObject({
      PENGUIN_DEPLOY_ID: "staging",
      PENGUIN_DEPLOY_RUN: run.id,
      PENGUIN_DEPLOY_REPO: "acme/site",
      PENGUIN_DEPLOY_PR: "11",
      PENGUIN_DEPLOY_PR_URL: "https://github.com/acme/site/pull/11",
      PENGUIN_DEPLOY_BRANCH: "feat/thing",
      PENGUIN_DEPLOY_HEAD: HEAD,
      PENGUIN_DEPLOY_PROPOSAL: "1",
      PENGUIN_DEPLOY_BY: "agent:acme_dev",
    });

    p!.write("building\n");
    p!.write("pushed\n");
    const mid = await d.get(PROJECT, ORG, BOSS, run.id, 0);
    expect(mid).toMatchObject({ output: "building\npushed\n", from: 0, next: 16 });
    expect(mid.run.status).toBe("running");
    p!.exit(0);
    const done = await d.get(PROJECT, ORG, BOSS, run.id, 9);
    expect(done).toMatchObject({ output: "pushed\n", from: 9, next: 16 });
    expect(done.run).toMatchObject({ status: "succeeded", exitCode: 0, error: null });
    expect(done.run.finishedAt).not.toBeNull();
    expect(logs.join("\n")).toMatch(
      /deploy \w+ staging acme\/site#11@aaaaaaaaaaaa succeeded \(exit 0\)/,
    );
  });

  it("deploys a PR of the delivery repository, refusing a head that moved", async () => {
    const d = await registered();
    expect(
      await refusal(
        d.start(PROJECT, ORG, BOSS, { script: "staging", pr: 12, head: HEAD.slice(0, 9) }),
      ),
    ).toEqual({ status: 409, code: "head_moved" });
    expect(started).toHaveLength(0);
    const run = runOf(
      await d.start(PROJECT, ORG, BOSS, { script: "staging", pr: 12, head: OTHER }),
    );
    expect(run).toMatchObject({ pr: 12, head: OTHER, proposal: null });
    expect(started[0]!.env.PENGUIN_DEPLOY_PROPOSAL).toBe("");
    deliveryRepo = null;
    expect(await refusal(d.start(PROJECT, ORG, BOSS, { script: "staging", pr: 12 }))).toEqual({
      status: 409,
      code: "graph_not_configured",
    });
  });

  it("a dry run answers the plan and starts nothing", async () => {
    const d = await registered();
    const res = await d.start(PROJECT, ORG, BOSS, {
      script: "staging",
      proposal: 1,
      args: ["--x"],
      dryRun: true,
    });
    expect(res).toEqual({
      plan: {
        script: "staging",
        repo: "acme/site",
        pr: 11,
        prUrl: "https://github.com/acme/site/pull/11",
        branch: "feat/thing",
        head: HEAD,
        proposal: 1,
        argv: ["bash", "scripts/deploy.sh", "--fast", "--x"],
      },
    });
    expect(started).toHaveLength(0);
  });

  it("deploys an impl branch at its head branch's tip now, with the PR variables empty while it has no PR", async () => {
    const d = await registered();
    implBranches = {
      3: { head: { repo: "me/site", branch: "feat/x" }, pr: null },
      4: {
        head: { repo: "acme/site", branch: "feat/y" },
        pr: "https://github.com/acme/site/pull/12",
      },
      5: { head: { repo: "acme/site", branch: "gone" }, pr: null },
    };
    tips = { "me/site:feat/x": OTHER, "acme/site:feat/y": HEAD };
    const run = runOf(await d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 3 }));
    expect(ghCalls).toEqual([
      ["api", "repos/me/site/branches/feat/x", "--jq", ".commit.sha | tojson"],
    ]);
    expect(run).toMatchObject({
      repo: "me/site",
      pr: null,
      prUrl: null,
      branch: "feat/x",
      head: OTHER,
      proposal: 3,
    });
    expect(started[0]!.env).toMatchObject({
      PENGUIN_DEPLOY_REPO: "me/site",
      PENGUIN_DEPLOY_PR: "",
      PENGUIN_DEPLOY_PR_URL: "",
      PENGUIN_DEPLOY_BRANCH: "feat/x",
      PENGUIN_DEPLOY_HEAD: OTHER,
      PENGUIN_DEPLOY_PROPOSAL: "3",
    });
    started[0]!.exit(0);
    // With a PR attached, the head branch is still what is deployed; the PR rides along.
    const plan = await d.start(PROJECT, ORG, BOSS, {
      script: "staging",
      proposal: 4,
      dryRun: true,
    });
    expect(plan).toMatchObject({
      plan: {
        repo: "acme/site",
        pr: 12,
        prUrl: "https://github.com/acme/site/pull/12",
        branch: "feat/y",
        head: HEAD,
      },
    });
    // A head that moved since it was looked at is refused, as for a PR.
    expect(
      await refusal(d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 3, head: HEAD })),
    ).toEqual({ status: 409, code: "head_moved" });
    expect(await refusal(d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 5 }))).toEqual({
      status: 502,
      code: "branch_unreadable",
    });
  });

  it("refuses what it cannot deploy, before anything starts", async () => {
    const d = await registered();
    const cases: Array<[Parameters<DeployService["start"]>[3], number, string]> = [
      [{ script: "staging", proposal: 2 }, 409, "no_impl"],
      [{ script: "staging", proposal: 9 }, 404, "proposal_not_found"],
      [{ script: "nope", proposal: 1 }, 404, "deploy_script_not_found"],
      [{ script: "staging" }, 400, "bad_request"],
      [{ script: "staging", proposal: 1, pr: 11 }, 400, "bad_request"],
      [{ script: "staging", proposal: 1, args: "--x" }, 400, "bad_request"],
      [{ script: "staging", pr: 404 }, 502, "pr_unreadable"],
    ];
    for (const [req, status, code] of cases) {
      expect(await refusal(d.start(PROJECT, ORG, BOSS, req))).toEqual({ status, code });
    }
    org = { ...org, machineId: "m1" };
    expect(await refusal(d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 1 }))).toEqual({
      status: 409,
      code: "org_elsewhere",
    });
    expect(started).toHaveLength(0);
  });

  it("one run per script at a time", async () => {
    const d = await registered();
    await d.register(PROJECT, ORG, BOSS, true, { id: "prod", command: ["deploy-prod"] });
    const first = runOf(await d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 1 }));
    expect(await refusal(d.start(PROJECT, ORG, BOSS, { script: "staging", pr: 12 }))).toEqual({
      status: 409,
      code: "deploy_busy",
    });
    runOf(await d.start(PROJECT, ORG, BOSS, { script: "prod", proposal: 1 }));
    started[0]!.exit(1);
    expect((await d.get(PROJECT, ORG, BOSS, first.id, 0)).run).toMatchObject({
      status: "failed",
      exitCode: 1,
    });
    runOf(await d.start(PROJECT, ORG, BOSS, { script: "staging", pr: 12 }));
  });

  it("a script that does not start, or runs too long, ends the run", async () => {
    const d = service({ timeoutMs: 20 });
    await d.register(PROJECT, ORG, BOSS, true, { id: "staging", command: ["x"] });
    const missing = runOf(await d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 1 }));
    started[0]!.exit(null, "x not found");
    expect((await d.get(PROJECT, ORG, BOSS, missing.id, 0)).run).toMatchObject({
      status: "failed",
      exitCode: null,
      error: "x not found",
    });
    const slow = runOf(await d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 1 }));
    await new Promise((r) => setTimeout(r, 60));
    expect(started[1]!.signals).toContain("SIGTERM");
    expect((await d.get(PROJECT, ORG, BOSS, slow.id, 0)).run).toMatchObject({
      status: "timed_out",
    });
    expect((await d.get(PROJECT, ORG, BOSS, slow.id, 0)).run.error).toMatch(/^stopped after /);
  });

  it("keeps the tail of a long output and says where it starts", async () => {
    const d = await registered();
    const run = runOf(await d.start(PROJECT, ORG, BOSS, { script: "staging", proposal: 1 }));
    started[0]!.write("x".repeat(OUTPUT_LIMIT));
    started[0]!.write("tail");
    const res: ProposalDeployRunResponse = await d.get(PROJECT, ORG, BOSS, run.id, 0);
    expect(res.from).toBe(4);
    expect(res.next).toBe(OUTPUT_LIMIT + 4);
    expect(res.output.endsWith("tail")).toBe(true);
    expect(res.output).toHaveLength(OUTPUT_LIMIT);
    expect((await d.get(PROJECT, ORG, BOSS, run.id, res.next)).output).toBe("");
    expect(await refusal(d.get(PROJECT, "other", BOSS, run.id, 0))).toMatchObject({ status: 404 });
  });
});

describe("the deploy routes", () => {
  function app(isAdmin: boolean, d: DeployService): Hono {
    const a = new Hono();
    a.onError((err, c) =>
      err instanceof ProposalError
        ? c.json({ error: { code: err.code } }, err.status as 400)
        : c.json({ error: { code: "internal" } }, 500),
    );
    a.use(async (c, next) => {
      c.set("user" as never, { userId: "boss", isAdmin } as never);
      c.set("sessionVia" as never, "token" as never);
      await next();
    });
    a.route("/p/:projectId/o/:orgId/proposals", deployRoutes(d));
    return a;
  }
  const call = (a: Hono, method: string, suffix: string, body?: unknown) =>
    a.request(`/p/${PROJECT}/o/${ORG}/proposals${suffix}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  it("registers only for an admin, then runs and reports", async () => {
    const d = service();
    const body = { id: "staging", command: ["bash", "deploy.sh"] };
    expect((await call(app(false, d), "POST", "/deploy-scripts", body)).status).toBe(403);
    const a = app(true, d);
    expect((await call(a, "POST", "/deploy-scripts", body)).status).toBe(201);
    expect(
      (await call(a, "POST", "/deploy-scripts", { ...body, id: "x", agentId: "acme_dev" })).status,
    ).toBe(403);
    expect(await (await call(a, "GET", "/deploy-scripts")).json()).toMatchObject({
      scripts: [{ id: "staging" }],
    });
    const dry = await call(a, "POST", "/deploys", { script: "staging", proposal: 1, dryRun: true });
    expect(dry.status).toBe(200);
    const res = await call(a, "POST", "/deploys", {
      script: "staging",
      proposal: 1,
      args: ["--extra-args"],
    });
    expect(res.status).toBe(202);
    const { run } = (await res.json()) as { run: ProposalDeployRun };
    expect(run.argv).toEqual(["bash", "deploy.sh", "--extra-args"]);
    started[0]!.write("ok\n");
    started[0]!.exit(0);
    expect(await (await call(a, "GET", `/deploys/${run.id}?from=0`)).json()).toMatchObject({
      output: "ok\n",
      run: { status: "succeeded" },
    });
    expect((await call(a, "POST", "/deploys", { script: "staging", proposal: 0 })).status).toBe(
      400,
    );
    expect((await call(a, "DELETE", "/deploy-scripts/staging")).status).toBe(204);
  });
});

describe("startProcess", () => {
  it("runs the vector without a shell, merges the output and reports the exit", async () => {
    const p = startProcess(
      [
        process.execPath,
        "-e",
        "console.log(process.env.PENGUIN_DEPLOY_HEAD, process.argv[1]); console.error('on-stderr'); process.exit(3)",
        "$HOME",
      ],
      { cwd: os.tmpdir(), env: { ...process.env, PENGUIN_DEPLOY_HEAD: HEAD } },
    );
    let out = "";
    p.onOutput((t) => (out += t));
    const code = await new Promise<number | null>((resolve) => p.onExit((c) => resolve(c)));
    expect(code).toBe(3);
    expect(out).toContain(`${HEAD} $HOME`);
    expect(out).toContain("on-stderr");
  });

  it("names a program that is not there", async () => {
    const p = startProcess(["penguin-deploy-no-such-program"], {
      cwd: os.tmpdir(),
      env: process.env,
    });
    const error = await new Promise<string | null>((resolve) => p.onExit((_c, e) => resolve(e)));
    expect(error).toBe("penguin-deploy-no-such-program not found");
  });
});
