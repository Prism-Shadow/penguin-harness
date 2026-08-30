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
  pullRequestFromApi,
  pullsApiUrl,
  prViewArgs,
  githubRepoFrom,
  ghUnusable,
  apiToken,
  type CliResult,
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

/** stdout for a command that worked. */
const ok = (stdout: string): CliResult => ({ ok: true, stdout });
/** A command that is not installed at all. */
const missing = (): CliResult => ({ ok: false, missing: true, output: "spawn ENOENT" });
/** A command that ran and failed, saying `output`. */
const failed = (output: string): CliResult => ({ ok: false, missing: false, output });

const NO_PR = failed('no pull requests found for branch "feat/x"');

/** A runner over canned answers, recording what it was asked to run and where. */
function fakeCli(answers: Record<string, CliResult>): {
  run: RunCli;
  calls: { file: string; args: string[]; cwd: string }[];
} {
  const calls: { file: string; args: string[]; cwd: string }[] = [];
  const run: RunCli = (file, args, cwd) => {
    calls.push({ file, args, cwd });
    return Promise.resolve(answers[file] ?? failed("unexpected command"));
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
    const { run, calls } = fakeCli({ git: ok("feat/x\n"), gh: ok(view()) });
    const pr = await new PullRequestService(run).forWorkspace("/w");
    expect(pr?.number).toBe(554);
    expect(calls.map((c) => c.file)).toEqual(["git", "gh"]);
    expect(calls.every((c) => c.cwd === "/w")).toBe(true);
  });

  it("says nothing, and never runs gh, when there is no branch to look up", async () => {
    for (const branch of [ok("HEAD\n"), ok(""), missing()]) {
      const { run, calls } = fakeCli({ git: branch, gh: ok(view()) });
      expect(await new PullRequestService(run).forWorkspace("/w")).toBeNull();
      // A detached HEAD or a directory that is not a repository is the ordinary case for a
      // Workspace; spawning gh to be told so again would be a process per conversation open.
      expect(calls.map((c) => c.file)).toEqual(["git"]);
    }
  });

  it("takes gh at its word when it says the branch has no pull request", async () => {
    const { run } = fakeCli({ git: ok("feat/x\n"), gh: NO_PR });
    expect(await new PullRequestService(run).forWorkspace("/w")).toBeNull();
  });

  it("reuses an answer for the same branch, and asks again once it is stale", async () => {
    const { run, calls } = fakeCli({ git: ok("feat/x\n"), gh: ok(view()) });
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
      return Promise.resolve(ok(file === "git" ? `${branch}\n` : view({ headRefName: branch })));
    };
    const service = new PullRequestService(run, () => 1_000);
    expect((await service.forWorkspace("/w"))?.number).toBe(554);
    // Switching branch inside the TTL must not keep showing the old branch's PR.
    branch = "feat/y";
    expect((await service.forWorkspace("/w"))?.number).toBe(554);
    expect(calls.filter((f) => f === "gh")).toHaveLength(2);
  });
});

describe("when gh cannot answer, GitHub can", () => {
  const apiList = (over: Record<string, unknown> = {}): unknown[] => [
    {
      number: 555,
      title: "feat: the header names the pull request",
      html_url: "https://github.com/o/r/pull/555",
      state: "open",
      head: { ref: "feat/x" },
      ...over,
    },
  ];

  it("tells a gh that is absent or signed out apart from one that answered", () => {
    // The distinction the fallback turns on: only the first two mean "ask somebody else".
    expect(ghUnusable(missing())).toBe(true);
    expect(ghUnusable(failed("gh auth login required"))).toBe(true);
    expect(ghUnusable(failed("HTTP 401: Bad credentials"))).toBe(true);
    expect(ghUnusable(NO_PR)).toBe(false);
    expect(ghUnusable(ok(view()))).toBe(false);
  });

  it("reads owner and repo out of every spelling git writes, and only for github.com", () => {
    for (const url of [
      "git@github.com:Prism-Shadow/penguin-harness.git",
      "https://github.com/Prism-Shadow/penguin-harness.git",
      "https://github.com/Prism-Shadow/penguin-harness",
      "ssh://git@github.com/Prism-Shadow/penguin-harness.git",
      "  git@github.com:Prism-Shadow/penguin-harness.git\n",
    ]) {
      expect(githubRepoFrom(url)).toEqual({ owner: "Prism-Shadow", repo: "penguin-harness" });
    }
    // Another forge is not a repository this can answer about; showing nothing beats guessing.
    expect(githubRepoFrom("git@gitlab.com:o/r.git")).toBeNull();
    expect(githubRepoFrom("https://example.com/o/r.git")).toBeNull();
    expect(githubRepoFrom("")).toBeNull();
  });

  it("asks for the open pull requests whose head is this branch", () => {
    expect(pullsApiUrl("o", "r", "feat/x")).toBe(
      "https://api.github.com/repos/o/r/pulls?state=open&head=o%3Afeat%2Fx&per_page=10",
    );
  });

  it("applies the same rule to the REST answer as to gh's", () => {
    expect(pullRequestFromApi(apiList(), "feat/x")).toEqual({
      number: 555,
      title: "feat: the header names the pull request",
      url: "https://github.com/o/r/pull/555",
    });
    expect(pullRequestFromApi(apiList({ head: { ref: "main" } }), "feat/x")).toBeNull();
    expect(pullRequestFromApi(apiList({ state: "closed" }), "feat/x")).toBeNull();
    expect(pullRequestFromApi([], "feat/x")).toBeNull();
    expect(pullRequestFromApi({ message: "Not Found" }, "feat/x")).toBeNull();
  });

  it("falls back to the API when gh is not installed, carrying a token when there is one", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const { run } = fakeCli({
      git: ok("feat/x\n"),
      gh: missing(),
    });
    // The second git call (the remote) shares the stub, so it answers the branch string; the
    // remote parse rejects it, which is why this case pins the URL through a dedicated stub.
    const runBoth: RunCli = (file, args, cwd) => {
      if (file === "git" && args.includes("--get")) {
        return Promise.resolve(ok("git@github.com:o/r.git\n"));
      }
      return run(file, args, cwd);
    };
    const service = new PullRequestService(
      runBoth,
      () => 1_000,
      (url, headers) => {
        seen.push({ url, headers });
        return Promise.resolve(apiList());
      },
      { GH_TOKEN: "secret" },
    );
    expect((await service.forWorkspace("/w"))?.number).toBe(555);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain("head=o%3Afeat%2Fx");
    expect(seen[0]?.headers.authorization).toBe("Bearer secret");
  });

  it("asks anonymously with no token, and says nothing when the call fails", async () => {
    const runBoth: RunCli = (file, args) =>
      Promise.resolve(
        file === "gh"
          ? missing()
          : ok(args.includes("--get") ? "git@github.com:o/r.git\n" : "feat/x\n"),
      );
    const anonymous = new PullRequestService(
      runBoth,
      () => 1_000,
      (_url, headers) => {
        expect(headers.authorization).toBeUndefined();
        return Promise.resolve(apiList());
      },
      {},
    );
    expect((await anonymous.forWorkspace("/w"))?.number).toBe(555);

    // Private without a token, rate-limited, offline: one more way to have nothing to show.
    const failing = new PullRequestService(
      runBoth,
      () => 1_000,
      () => Promise.reject(new Error("404")),
      {},
    );
    expect(await failing.forWorkspace("/w")).toBeNull();
  });

  it("never reaches the network when gh answered that there is no pull request", async () => {
    let called = 0;
    const service = new PullRequestService(
      fakeCli({ git: ok("feat/x\n"), gh: NO_PR }).run,
      () => 1_000,
      () => {
        called += 1;
        return Promise.resolve(apiList());
      },
      {},
    );
    expect(await service.forWorkspace("/w")).toBeNull();
    expect(called).toBe(0);
  });
});

describe("apiToken", () => {
  it("takes GH_TOKEN, then GITHUB_TOKEN, and treats blank as absent", () => {
    expect(apiToken({ GH_TOKEN: "a", GITHUB_TOKEN: "b" })).toBe("a");
    expect(apiToken({ GITHUB_TOKEN: "b" })).toBe("b");
    expect(apiToken({ GH_TOKEN: "   " })).toBeNull();
    expect(apiToken({})).toBeNull();
  });
});
