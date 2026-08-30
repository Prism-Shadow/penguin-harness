/**
 * The pull request a Workspace is on (services/pull-request-service.ts).
 *
 * Two things are worth pinning. The COMMANDS, because they are what runs against somebody's
 * checkout and they must not prompt: a `gh` that decides to ask for a login would hang a
 * request that has no terminal to answer it. And the ANSWER RULE, because the chip is a link
 * a reader will click: it must be the open PR for this very branch, never one `gh` resolved
 * through a tracking branch, and never a closed one left over on a recycled branch name.
 */
import { describe, expect, it } from "vitest";
import {
  PullRequestService,
  cliEnv,
  currentBranchArgs,
  pullRequestFrom,
  prViewArgs,
  type RunCli,
} from "../src/services/pull-request-service.js";

const view = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    number: 554,
    title: "fix(web): a Workspace file's address follows the Session",
    url: "https://github.com/o/r/pull/554",
    state: "OPEN",
    headRefName: "feat/x",
    ...over,
  });

/** A runner over canned answers, recording what it was asked to run and where. */
function fakeCli(answers: Record<string, string | null>): {
  run: RunCli;
  calls: { file: string; args: string[]; cwd: string }[];
} {
  const calls: { file: string; args: string[]; cwd: string }[] = [];
  const run: RunCli = (file, args, cwd) => {
    calls.push({ file, args, cwd });
    return Promise.resolve(answers[file] ?? null);
  };
  return { run, calls };
}

describe("the commands", () => {
  it("asks gh for exactly the fields the chip and the branch check need", () => {
    expect(prViewArgs()).toEqual(["pr", "view", "--json", "number,title,url,state,headRefName"]);
    expect(currentBranchArgs()).toEqual(["rev-parse", "--abbrev-ref", "HEAD"]);
  });

  it("runs them with prompting disabled, keeping the rest of the environment", () => {
    // A prompt is not a slow answer, it is a request that never returns.
    const env = cliEnv({ PATH: "/usr/bin", GH_TOKEN: "t" });
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GH_PROMPT_DISABLED).toBe("1");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.GH_TOKEN).toBe("t");
  });
});

describe("which pull request counts", () => {
  it("takes an open PR whose head is this branch", () => {
    expect(pullRequestFrom(view(), "feat/x")).toEqual({
      number: 554,
      title: "fix(web): a Workspace file's address follows the Session",
      url: "https://github.com/o/r/pull/554",
    });
  });

  it("refuses a PR whose head is another branch", () => {
    // `gh pr view` resolves through the branch's remote tracking, so a branch that tracks
    // main answers with main's PR. Showing it would send the reader somewhere else entirely.
    expect(pullRequestFrom(view({ headRefName: "main" }), "feat/x")).toBeNull();
  });

  it("refuses anything that is not open", () => {
    for (const state of ["MERGED", "CLOSED", "DRAFT_UNKNOWN", ""]) {
      expect(pullRequestFrom(view({ state }), "feat/x")).toBeNull();
    }
  });

  it("survives a gh that answers something unexpected", () => {
    expect(pullRequestFrom("not json", "feat/x")).toBeNull();
    expect(pullRequestFrom("null", "feat/x")).toBeNull();
    expect(pullRequestFrom(view({ number: "554" }), "feat/x")).toBeNull();
    expect(pullRequestFrom(view({ url: "" }), "feat/x")).toBeNull();
    // A field that went missing costs its own value, not the whole chip.
    expect(pullRequestFrom(view({ title: 42 }), "feat/x")?.title).toBe("");
  });
});

describe("forWorkspace", () => {
  it("asks git for the branch first, then gh, both in the Workspace", async () => {
    const { run, calls } = fakeCli({ git: "feat/x\n", gh: view() });
    const pr = await new PullRequestService(run).forWorkspace("/w");
    expect(pr?.number).toBe(554);
    expect(calls.map((c) => c.file)).toEqual(["git", "gh"]);
    expect(calls.every((c) => c.cwd === "/w")).toBe(true);
  });

  it("says nothing, and never runs gh, when there is no branch to look up", async () => {
    for (const branch of ["HEAD\n", "", null]) {
      const { run, calls } = fakeCli({ git: branch, gh: view() });
      expect(await new PullRequestService(run).forWorkspace("/w")).toBeNull();
      // A detached HEAD or a directory that is not a repository is the ordinary case for a
      // Workspace; spawning gh to be told so again would be a process per conversation open.
      expect(calls.map((c) => c.file)).toEqual(["git"]);
    }
  });

  it("says nothing when gh fails — missing, signed out, offline are one answer", async () => {
    const { run } = fakeCli({ git: "feat/x\n", gh: null });
    expect(await new PullRequestService(run).forWorkspace("/w")).toBeNull();
  });

  it("reuses an answer for the same branch, and asks again once it is stale", async () => {
    const { run, calls } = fakeCli({ git: "feat/x\n", gh: view() });
    let now = 1_000;
    const service = new PullRequestService(run, () => now);
    await service.forWorkspace("/w");
    await service.forWorkspace("/w");
    expect(calls.filter((c) => c.file === "gh")).toHaveLength(1);
    now += 30_001;
    await service.forWorkspace("/w");
    expect(calls.filter((c) => c.file === "gh")).toHaveLength(2);
  });

  it("does not serve one branch's answer to another", async () => {
    const calls: string[] = [];
    let branch = "feat/x";
    const run: RunCli = (file) => {
      calls.push(file);
      return Promise.resolve(file === "git" ? `${branch}\n` : view({ headRefName: branch }));
    };
    const service = new PullRequestService(run, () => 1_000);
    expect((await service.forWorkspace("/w"))?.number).toBe(554);
    // Switching branch inside the TTL must not keep showing the old branch's PR.
    branch = "feat/y";
    expect((await service.forWorkspace("/w"))?.number).toBe(554);
    expect(calls.filter((f) => f === "gh")).toHaveLength(2);
  });
});
