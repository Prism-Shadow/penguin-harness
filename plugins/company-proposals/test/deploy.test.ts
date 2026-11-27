/**
 * What the plugin lends a company module's deploy Action: the environment a deploy's process
 * gets from its run's commit, the default guard (one run at a time), the extra arguments, how a
 * run's process ending becomes its result or its failure; how a subject's commit is resolved
 * from the forge (a proposal's impl branch or PR, a change request, a branch); and how a run's
 * process is followed — its output tail kept, stopped after the timeout. One test starts a real
 * process to hold the spawner to the same contract.
 */
import os from "node:os";
import { describe, expect, it } from "vitest";
import type { OrgView } from "@prismshadow/penguin-server/plugin";
import {
  ActionFailure,
  DEPLOY_PARAMS,
  OUTPUT_LIMIT,
  argsOf,
  branchCommit,
  changeRequestHead,
  compileParams,
  deployEnv,
  deployGuard,
  deployProcess,
  proposalHead,
  startProcess,
  type HeadScope,
  type ProcessEnd,
  type ProcessOptions,
  type RunContext,
  type SubjectCommit,
  type DeployProcess,
  type StartProcess,
} from "../src/index.js";
import { runProcess, type LiveRun } from "../src/action-live.js";
import type { RunGh } from "../src/pr-status.js";

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);

const ORG: OrgView = {
  projectId: "proj",
  orgId: "acme",
  name: "Acme",
  status: "active",
  language: "en",
  workspace: "/tmp/acme",
  employees: [],
  userIds: ["boss"],
  machineId: null,
};

const COMMIT: SubjectCommit = {
  sha: HEAD,
  repo: "acme/site",
  branch: "feat/thing",
  pr: 12,
  prUrl: "https://github.com/acme/site/pull/12",
  proposal: 3,
};

function refusal(run: () => unknown): { status: number; code: string } | null {
  try {
    run();
    return null;
  } catch (err) {
    const e = err as { status: number; code: string };
    return { status: e.status, code: e.code };
  }
}

async function rejection(
  run: Promise<unknown>,
): Promise<{ status: number; code: string; name: string }> {
  try {
    await run;
  } catch (err) {
    const e = err as { status: number; code: string; name: string };
    return { status: e.status, code: e.code, name: e.name };
  }
  throw new Error("expected a rejection");
}

/** A run context whose process() answers `end` and records what it was started with. */
function context(
  end: ProcessEnd,
  fields: Partial<RunContext> = {},
): { ctx: RunContext; started: Array<{ argv: readonly string[]; opts?: ProcessOptions }> } {
  const started: Array<{ argv: readonly string[]; opts?: ProcessOptions }> = [];
  const ctx: RunContext = {
    runId: "run1",
    key: "deploy.desktop",
    org: ORG,
    actor: { userId: "boss", agentId: "acme_dev" },
    caller: { principal: "agent:acme_dev", agentId: "acme_dev", userId: "boss" },
    subject: { kind: "proposal", id: "3", text: "proposal:3" },
    params: {},
    commit: COMMIT,
    act: { guard: () => undefined },
    process: async (argv, opts) => {
      started.push({ argv, ...(opts !== undefined ? { opts } : {}) });
      return end;
    },
    ...fields,
  };
  return { ctx, started };
}

describe("a deploy Action", () => {
  it("hands the process the run's commit in its environment", () => {
    expect(
      deployEnv({
        key: "deploy.desktop",
        runId: "run1",
        commit: COMMIT,
        caller: { principal: "user:boss", agentId: null, userId: "boss" },
      }),
    ).toEqual({
      PENGUIN_DEPLOY_ID: "desktop",
      PENGUIN_DEPLOY_RUN: "run1",
      PENGUIN_DEPLOY_REPO: "acme/site",
      PENGUIN_DEPLOY_PR: "12",
      PENGUIN_DEPLOY_PR_URL: "https://github.com/acme/site/pull/12",
      PENGUIN_DEPLOY_BRANCH: "feat/thing",
      PENGUIN_DEPLOY_HEAD: HEAD,
      PENGUIN_DEPLOY_PROPOSAL: "3",
      PENGUIN_DEPLOY_BY: "user:boss",
    });
    // A branch head with no PR and no proposal: those variables are empty.
    expect(
      deployEnv({
        key: "deploy.dev1",
        runId: "run2",
        commit: { ...COMMIT, pr: null, prUrl: null, proposal: null },
        caller: { principal: "agent:acme_dev", agentId: "acme_dev", userId: "boss" },
      }),
    ).toMatchObject({
      PENGUIN_DEPLOY_ID: "dev1",
      PENGUIN_DEPLOY_PR: "",
      PENGUIN_DEPLOY_PR_URL: "",
      PENGUIN_DEPLOY_PROPOSAL: "",
      PENGUIN_DEPLOY_BY: "agent:acme_dev",
    });
  });

  it("runs one at a time by default", () => {
    const input = {
      caller: { principal: "user:boss", agentId: null, userId: "boss" },
      subject: { kind: "proposal" as const, id: "3", text: "proposal:3" },
      state: null,
      params: {},
    };
    expect(refusal(() => deployGuard({ ...input, running: 0 }))).toBeNull();
    expect(refusal(() => deployGuard({ ...input, running: 1 }))).toEqual({
      status: 409,
      code: "deploy_busy",
    });
  });

  it("declares its parameters, and checks the extra arguments", () => {
    const params = compileParams(DEPLOY_PARAMS);
    expect(params({ expectedHead: HEAD, args: ["--compat"] })).toEqual({
      expectedHead: HEAD,
      args: ["--compat"],
    });
    expect(refusal(() => params({ args: "no" }))).toEqual({ status: 400, code: "bad_params" });
    expect(argsOf(undefined)).toEqual([]);
    expect(argsOf(["a", "b"])).toEqual(["a", "b"]);
    expect(refusal(() => argsOf(["a\0b"]))).toEqual({ status: 400, code: "bad_params" });
    expect(refusal(() => argsOf(Array.from({ length: 65 }, () => "x")))).toEqual({
      status: 400,
      code: "bad_params",
    });
  });

  it("starts the argument vector then the extra arguments, with the commit in its environment", async () => {
    const { ctx, started } = context(
      { exitCode: 0, error: null, timedOut: false },
      { params: { args: ["--compat"] } },
    );
    expect(await deployProcess(ctx, "deploy.desktop", ["deploy-from-ui.sh", "53531"])).toEqual({
      exitCode: 0,
      head: HEAD,
    });
    expect(started).toEqual([
      {
        argv: ["deploy-from-ui.sh", "53531", "--compat"],
        opts: { env: expect.objectContaining({ PENGUIN_DEPLOY_HEAD: HEAD }) },
      },
    ]);
  });

  it("fails a run whose process exits otherwise, never starts, or runs too long", async () => {
    const exit3 = context({ exitCode: 3, error: null, timedOut: false }).ctx;
    expect(await rejection(deployProcess(exit3, "deploy.desktop", ["x"]))).toEqual({
      status: 500,
      code: "deploy_failed",
      name: "ActionFailure",
    });
    const missing = context({ exitCode: null, error: "x not found", timedOut: false }).ctx;
    await expect(deployProcess(missing, "deploy.desktop", ["x"])).rejects.toThrow(/x not found/);
    const slow = context({
      exitCode: null,
      error: "stopped after the 1 s limit",
      timedOut: true,
    }).ctx;
    const failed = await deployProcess(slow, "deploy.desktop", ["x"]).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ActionFailure);
    expect(failed).toMatchObject({ code: "deploy_timed_out" });
    // No commit, nothing started.
    const none = context({ exitCode: 0, error: null, timedOut: false }, { commit: null });
    expect(await rejection(deployProcess(none.ctx, "deploy.desktop", ["x"]))).toMatchObject({
      status: 409,
      code: "no_commit",
    });
    expect(none.started).toHaveLength(0);
  });
});

describe("a subject's commit", () => {
  let ghCalls: string[][] = [];
  const heads: Record<string, string> = { "acme/site#12": HEAD, "acme/site#7": OTHER };
  const tips: Record<string, string> = { "me/site:feat/x": OTHER, "acme/site:feat/y": HEAD };
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
  const scope = (fields: Partial<HeadScope> = {}): HeadScope => ({
    impl: async (n) =>
      n === 3
        ? { head: { repo: "me/site", branch: "feat/x" }, pr: null }
        : n === 4
          ? { head: null, pr: "https://github.com/acme/site/pull/12" }
          : null,
    remotes: async () => [{ name: "origin", repo: "acme/site" }],
    deliveryRepo: async () => "acme/site",
    ...fields,
  });

  it("is a proposal's impl branch tip, or its PR's head when the impl is a PR alone", async () => {
    ghCalls = [];
    expect(await proposalHead(scope(), 3, gh)).toEqual({
      sha: OTHER,
      repo: "me/site",
      branch: "feat/x",
      pr: null,
      prUrl: null,
      proposal: 3,
    });
    expect(ghCalls).toEqual([
      ["api", "repos/me/site/branches/feat/x", "--jq", ".commit.sha | tojson"],
    ]);
    expect(await proposalHead(scope(), 4, gh)).toEqual({
      sha: HEAD,
      repo: "acme/site",
      branch: "feat/thing",
      pr: 12,
      prUrl: "https://github.com/acme/site/pull/12",
      proposal: 4,
    });
    expect(await rejection(proposalHead(scope(), 5, gh))).toMatchObject({
      status: 409,
      code: "no_impl",
    });
  });

  it("is a change request's head, named in full or by its number on the delivery repository", async () => {
    expect(await changeRequestHead(scope(), "acme/site#7", gh)).toMatchObject({
      sha: OTHER,
      pr: 7,
      proposal: null,
    });
    expect(await changeRequestHead(scope(), "12", gh)).toMatchObject({ sha: HEAD, pr: 12 });
    expect(
      await rejection(changeRequestHead(scope({ deliveryRepo: async () => null }), "12", gh)),
    ).toMatchObject({ status: 409, code: "graph_not_configured" });
    expect(await rejection(changeRequestHead(scope(), "acme/site#99", gh))).toMatchObject({
      status: 502,
      code: "pr_unreadable",
    });
  });

  it("is a branch's tip, through a remote of the shared workspace or as owner/repo/branch", async () => {
    expect(await branchCommit(scope(), "origin/feat/y", gh)).toMatchObject({
      sha: HEAD,
      repo: "acme/site",
      branch: "feat/y",
      pr: null,
      proposal: null,
    });
    expect(await branchCommit(scope(), "me/site/feat/x", gh)).toMatchObject({
      sha: OTHER,
      repo: "me/site",
      branch: "feat/x",
    });
    expect(await rejection(branchCommit(scope(), "origin/gone", gh))).toMatchObject({
      status: 502,
      code: "branch_unreadable",
    });
  });
});

class FakeProcess implements DeployProcess {
  private readonly outputs: Array<(text: string) => void> = [];
  private readonly exits: Array<(code: number | null, error: string | null) => void> = [];
  readonly signals: string[] = [];
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

function live(): LiveRun {
  return {
    start: {
      id: "run1",
      key: "deploy.desktop",
      contribution: "x",
      subjectKind: "proposal",
      subject: "proposal:3",
      commit: HEAD,
      params: {},
      by: "user:boss",
      via: "web",
      sessionId: null,
      requestId: null,
      startedAt: "",
    },
    orgKey: "proj/acme",
    output: "",
    dropped: 0,
    hasProcess: false,
  };
}

describe("a run's process", () => {
  it("is started in the given directory and environment, and its exit is the run's", async () => {
    const procs: Array<{
      p: FakeProcess;
      argv: readonly string[];
      cwd: string;
      env: NodeJS.ProcessEnv;
    }> = [];
    const start: StartProcess = (argv, opts) => {
      const p = new FakeProcess();
      procs.push({ p, argv, cwd: opts.cwd, env: opts.env });
      return p;
    };
    const run = live();
    const ended = runProcess(run, ["deploy.sh", "1"], { cwd: "/tmp/acme", env: { A: "1" }, start });
    expect(run.hasProcess).toBe(true);
    expect(procs[0]).toMatchObject({ argv: ["deploy.sh", "1"], cwd: "/tmp/acme", env: { A: "1" } });
    procs[0]!.p.write("hello\n");
    procs[0]!.p.exit(0);
    expect(await ended).toEqual({ exitCode: 0, error: null, timedOut: false });
    expect(run.output).toBe("hello\n");
    expect(await runProcess(live(), [], { cwd: "/", env: {}, start })).toMatchObject({
      exitCode: null,
      error: "no program to run",
    });
  });

  it("keeps the tail of a long output and counts what it dropped", async () => {
    let p!: FakeProcess;
    const start: StartProcess = () => (p = new FakeProcess());
    const run = live();
    const ended = runProcess(run, ["x"], { cwd: "/", env: {}, start });
    p.write("a".repeat(OUTPUT_LIMIT));
    p.write("b".repeat(10));
    p.exit(0);
    await ended;
    expect(run.output).toHaveLength(OUTPUT_LIMIT);
    expect(run.dropped).toBe(10);
    expect(run.output.endsWith("b".repeat(10))).toBe(true);
  });

  it("is stopped after the timeout", async () => {
    let p!: FakeProcess;
    const start: StartProcess = () => (p = new FakeProcess());
    const ended = await runProcess(live(), ["x"], { cwd: "/", env: {}, start, timeoutMs: 20 });
    expect(p.signals).toContain("SIGTERM");
    expect(ended).toEqual({ exitCode: null, error: "stopped after the 0 s limit", timedOut: true });
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
